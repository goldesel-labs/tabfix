/* Tabfix — Background (MV3) */
const S = {
  SESSIONS: 'sessions',
  SETTINGS: 'settings',
  LAST_SESSION: 'lastSessionMeta'
};

// Default-Einstellungen
const DEFAULTS = {
  autoCloseMinutes: 120,          // Tabs nach X Minuten Inaktivität schließen (0 = aus)
  autoClosePinned: false,         // angepinnte Tabs nie schließen
  focusMode: false,               // Focus-Mode aktiv?
  focusAllowlist: [],             // Domains, die im Focus-Mode offen bleiben dürfen
  restoreInNewWindow: true,       // Session in neuem Fenster öffnen
  keepCurrentWindowOnRestore: true
};

// Storage Helper
async function getSettings() {
  const { [S.SETTINGS]: cfg } = await chrome.storage.sync.get(S.SETTINGS);
  return { ...DEFAULTS, ...(cfg || {}) };
}
async function setSettings(patch) {
  const cfg = await getSettings();
  await chrome.storage.sync.set({ [S.SETTINGS]: { ...cfg, ...patch } });
}

async function getSessions() {
  const { [S.SESSIONS]: sessions } = await chrome.storage.local.get(S.SESSIONS);
  return sessions || {}; // { [name]: Session }
}
async function saveSessions(sessions) {
  await chrome.storage.local.set({ [S.SESSIONS]: sessions });
}
async function rememberLastSession(name) {
  await chrome.storage.local.set({ [S.LAST_SESSION]: { name, at: Date.now() } });
}

// Session-Struktur erzeugen
async function captureCurrentSession(label = null) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({});
  const groupMap = {};
  groups.forEach(g => groupMap[g.id] = g);

  const items = tabs.map(t => ({
    url: t.url,
    title: t.title,
    pinned: t.pinned,
    group: t.groupId >= 0 ? (groupMap[t.groupId]?.title || '') : '',
    active: t.active
  }));

  const name = label || new Date().toISOString().replace('T', ' ').slice(0, 19);
  const session = { name, createdAt: Date.now(), windowType: 'normal', items };

  const all = await getSessions();
  all[name] = session;
  await saveSessions(all);
  await rememberLastSession(name);
  return session;
}

async function restoreSession(name) {
  const sessions = await getSessions();
  const session = sessions[name];
  if (!session) throw new Error('Session nicht gefunden');

  let win;
  const settings = await getSettings();
  if (settings.restoreInNewWindow) {
    win = await chrome.windows.create({ focused: true });
  } else {
    const [current] = await chrome.windows.getAll({ populate: false, windowTypes: ['normal'] });
    win = { id: current.id };
  }

  // Tabs in Reihenfolge öffnen
  for (const item of session.items) {
    try {
      await chrome.tabs.create({
        windowId: win.id,
        url: item.url,
        pinned: item.pinned,
        active: false
      });
    } catch (e) {
      console.warn('Tab konnte nicht erstellt werden:', item.url, e);
    }
  }
  await rememberLastSession(name);
}

// Duplikate schließen (gleiche URL im Fenster)
async function closeDuplicates() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const seen = new Set();
  for (const t of tabs) {
    const key = (t.url || '').split('#')[0]; // hash ignorieren
    if (seen.has(key)) {
      await chrome.tabs.remove(t.id);
    } else {
      seen.add(key);
    }
  }
}

// Inaktive Tabs schließen
async function autoCloseInactive() {
  const settings = await getSettings();
  const minutes = Number(settings.autoCloseMinutes);
  if (!minutes || minutes <= 0) return;

  const threshold = Date.now() - minutes * 60 * 1000;
  const tabs = await chrome.tabs.query({ currentWindow: true });

  for (const t of tabs) {
    if (settings.autoClosePinned && t.pinned) continue;
    // nutze lastAccessed (Chrome tracked das)
    if (typeof t.lastAccessed === 'number' && t.lastAccessed < threshold && !t.active) {
      try { await chrome.tabs.remove(t.id); } catch {}
    }
  }
}

// Focus-Mode: Alle Tabs schließen, die nicht auf Allowlist-Domains sind
async function enforceFocusMode() {
  const settings = await getSettings();
  if (!settings.focusMode) return;

  const allow = new Set(settings.focusAllowlist.map(d => d.toLowerCase()));
  const tabs = await chrome.tabs.query({ currentWindow: true });

  for (const t of tabs) {
    try {
      const host = new URL(t.url).hostname.replace(/^www\./, '').toLowerCase();
      if (!allow.has(host) && !t.pinned) {
        await chrome.tabs.remove(t.id);
      }
    } catch { /* ignore non-URL tabs */ }
  }
}

/* -------- Context Menus -------- */
chrome.runtime.onInstalled.addListener(async () => {
  // Periodischer Alarm für Autoclose
  chrome.alarms.create('tabfix:autoClose', { periodInMinutes: 5 });

  chrome.contextMenus.create({
    id: 'tabfix:saveSelectionNote',
    title: 'Auswahl als Tab-Notiz speichern (Tabfix)',
    contexts: ['selection', 'page']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'tabfix:saveSelectionNote') {
    const note = (info.selectionText || '').trim() || '(Seite markiert)';
    const key = `notes:${tab.url}`;
    const { [key]: arr } = await chrome.storage.local.get(key);
    const notes = arr || [];
    notes.push({ at: Date.now(), note });
    await chrome.storage.local.set({ [key]: notes });
  }
});

/* -------- Alarms -------- */
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tabfix:autoClose') autoCloseInactive();
});

/* -------- Commands (Shortcuts) -------- */
chrome.commands.onCommand.addListener(async (cmd) => {
  try {
    if (cmd === 'save_session_quick') {
      await captureCurrentSession('Schnellspeicher');
    } else if (cmd === 'restore_last_session') {
      const { [S.LAST_SESSION]: last } = await chrome.storage.local.get(S.LAST_SESSION);
      if (last?.name) await restoreSession(last.name);
    } else if (cmd === 'toggle_focus_mode') {
      const s = await getSettings();
      await setSettings({ focusMode: !s.focusMode });
      if (!s.focusMode) await enforceFocusMode();
    }
  } catch (e) {
    console.error('Command error:', e);
  }
});

/* -------- Messages (Popup/Options) -------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'CAPTURE_SESSION') {
        const r = await captureCurrentSession(msg.name);
        sendResponse({ ok: true, data: r });
      } else if (msg.type === 'GET_SESSIONS') {
        sendResponse({ ok: true, data: await getSessions() });
      } else if (msg.type === 'RESTORE_SESSION') {
        await restoreSession(msg.name);
        sendResponse({ ok: true });
      } else if (msg.type === 'DELETE_SESSION') {
        const all = await getSessions();
        delete all[msg.name];
        await saveSessions(all);
        sendResponse({ ok: true });
      } else if (msg.type === 'CLOSE_DUPLICATES') {
        await closeDuplicates();
        sendResponse({ ok: true });
      } else if (msg.type === 'ENFORCE_FOCUS_NOW') {
        await enforceFocusMode();
        sendResponse({ ok: true });
      } else if (msg.type === 'GET_SETTINGS') {
        sendResponse({ ok: true, data: await getSettings() });
      } else if (msg.type === 'SET_SETTINGS') {
        await setSettings(msg.patch || {});
        sendResponse({ ok: true });
      } else if (msg.type === 'GET_NOTES') {
        const key = `notes:${msg.url}`;
        const { [key]: arr } = await chrome.storage.local.get(key);
        sendResponse({ ok: true, data: arr || [] });
      } else {
        sendResponse({ ok: false, error: 'unknown_message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async
});
