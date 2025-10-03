/* Tabfix — Background (MV3)
   Kernlogik: Sessions, Duplicates, Focus, Export/Import, Auto-Restore
*/

const STORAGE_KEYS = {
  SESSIONS: 'tabfix:sessions',       // Array aus Sessions
  SETTINGS: 'tabfix:settings'        // { autoRestore: bool, keepPinned: bool, focusScope: 'window'|'domain' }
};

// ---------- Helpers ----------

async function getAllWindowsAndTabs() {
  const windows = await chrome.windows.getAll({ populate: true });
  return windows.map(w => ({
    id: w.id,
    focused: w.focused,
    tabs: (w.tabs || []).map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      pinned: t.pinned,
      active: t.active
    }))
  }));
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    // gleiche Seite behandeln wir als duplikat, wenn Origin + Pfad gleich sind (Query/Hash ignorieren)
    return `${url.origin}${url.pathname}`;
  } catch {
    return u || '';
  }
}

async function load(key, fallback) {
  const res = await chrome.storage.local.get(key);
  return res[key] ?? fallback;
}

async function save(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---------- Sessions ----------

async function saveSession(name = null) {
  const snapshot = await getAllWindowsAndTabs();
  const createdAt = new Date().toISOString();

  const session = {
    id: crypto.randomUUID(),
    name: name || `Session ${new Date().toLocaleString()}`,
    createdAt,
    windows: snapshot.map(w => ({
      tabs: w.tabs
        // nur „echte“ Seiten (ohne chrome:// etc.)
        .filter(t => /^https?:\/\//.test(t.url))
        .map(t => ({ url: t.url, pinned: t.pinned }))
    }))
  };

  const sessions = await load(STORAGE_KEYS.SESSIONS, []);
  sessions.unshift(session);                  // neueste nach oben
  // optional: nur die letzten 30 behalten
  if (sessions.length > 30) sessions.length = 30;
  await save(STORAGE_KEYS.SESSIONS, sessions);

  return session;
}

async function listSessions() {
  return load(STORAGE_KEYS.SESSIONS, []);
}

async function deleteSession(id) {
  const sessions = await load(STORAGE_KEYS.SESSIONS, []);
  const next = sessions.filter(s => s.id !== id);
  await save(STORAGE_KEYS.SESSIONS, next);
  return next;
}

async function openLastSession(inNewWindows = true) {
  const sessions = await load(STORAGE_KEYS.SESSIONS, []);
  if (!sessions.length) throw new Error('Keine gespeicherten Sessions gefunden.');
  return restoreSession(sessions[0], inNewWindows);
}

async function restoreSession(session, inNewWindows = true) {
  if (!session || !session.windows?.length) return;

  if (inNewWindows) {
    // Pro gespeichertes Fenster ein neues Browserfenster öffnen
    for (let i = 0; i < session.windows.length; i++) {
      const w = session.windows[i];
      const urls = w.tabs.map(t => t.url);
      if (!urls.length) continue;

      // Erstes Fenster mit „focused“, weitere ohne Zwang
      await chrome.windows.create({
        url: urls,
        focused: i === 0
      });

      // Pinned-Status nachträglich setzen
      // (MV3: Tabs nach create abfragen und nach Index pinnen)
      const current = await chrome.windows.getCurrent({ populate: true });
      const createdTabs = (current.tabs || []).slice(0, w.tabs.length);
      await Promise.all(
        createdTabs.map((tab, idx) => chrome.tabs.update(tab.id, { pinned: !!w.tabs[idx].pinned }).catch(() => {}))
      );
    }
  } else {
    // In aktuelles Fenster alle Tabs hinten anhängen
    const w = await chrome.windows.getCurrent();
    for (const win of session.windows) {
      for (const t of win.tabs) {
        try {
          const tab = await chrome.tabs.create({ windowId: w.id, url: t.url });
          if (t.pinned) await chrome.tabs.update(tab.id, { pinned: true });
        } catch {}
      }
    }
  }
}

// ---------- Duplicate Handling ----------

async function closeDuplicates({ keepPinned = true } = {}) {
  const windows = await getAllWindowsAndTabs();
  const seen = new Set();
  let closed = 0;

  for (const w of windows) {
    for (const t of w.tabs) {
      if (!/^https?:\/\//.test(t.url)) continue;
      if (keepPinned && t.pinned) continue;
      const key = normalizeUrl(t.url);
      if (seen.has(key)) {
        try {
          await chrome.tabs.remove(t.id);
          closed++;
        } catch {}
      } else {
        seen.add(key);
      }
    }
  }
  return closed;
}

// ---------- Focus Mode ----------

/*
  Varianten:
  - focusScope: 'window'  => nur aktives Fenster behalten, andere Fenster schließen
  - focusScope: 'domain'  => in aktivem Fenster nur Tabs der aktiven Domain behalten
*/
async function focusNow(scope = 'window') {
  const current = await chrome.windows.getCurrent({ populate: true });
  const all = await chrome.windows.getAll({ populate: true });

  if (scope === 'window') {
    // alle anderen Fenster schließen
    for (const w of all) {
      if (w.id !== current.id) {
        try { await chrome.windows.remove(w.id); } catch {}
      }
    }
    return { closedWindows: all.filter(w => w.id !== current.id).length };
  }

  if (scope === 'domain') {
    const activeTab = (current.tabs || []).find(t => t.active);
    if (!activeTab || !/^https?:\/\//.test(activeTab.url)) return { closedTabs: 0 };

    const activeDomain = new URL(activeTab.url).hostname;
    let closedTabs = 0;

    for (const t of (current.tabs || [])) {
      try {
        if (!t.active && /^https?:\/\//.test(t.url)) {
          const host = new URL(t.url).hostname;
          if (host !== activeDomain) {
            await chrome.tabs.remove(t.id);
            closedTabs++;
          }
        }
      } catch {}
    }
    return { closedTabs };
  }

  return {};
}

// ---------- Export / Import ----------

async function exportSessions() {
  const sessions = await load(STORAGE_KEYS.SESSIONS, []);
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  return url; // Popup lädt die URL und triggert Download
}

async function importSessions(jsonString) {
  try {
    const incoming = JSON.parse(jsonString);
    if (!Array.isArray(incoming)) throw new Error('Ungültiges Format');

    const current = await load(STORAGE_KEYS.SESSIONS, []);
    // neue oben einfügen, IDs sicherstellen
    const withIds = incoming.map(s => ({ ...s, id: s.id || crypto.randomUUID() }));
    const merged = [...withIds, ...current];
    await save(STORAGE_KEYS.SESSIONS, merged);
    return merged.length;
  } catch (e) {
    throw new Error('Import fehlgeschlagen: ' + e.message);
  }
}

// ---------- Settings / Auto-Restore ----------

async function getSettings() {
  return load(STORAGE_KEYS.SETTINGS, {
    autoRestore: false,
    keepPinned: true,
    focusScope: 'window'
  });
}

async function updateSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await save(STORAGE_KEYS.SETTINGS, next);
  return next;
}

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings(); // Defaults sicher schreiben
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.autoRestore) {
    try {
      await openLastSession(true);
    } catch (e) {
      console.warn('Auto-Restore fehlgeschlagen:', e);
    }
  }
});

// ---------- Message API (vom Popup/Options aufgerufen) ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'SAVE_SESSION': {
          const session = await saveSession(msg.payload?.name);
          sendResponse({ ok: true, session });
          break;
        }
        case 'LIST_SESSIONS': {
          const sessions = await listSessions();
          sendResponse({ ok: true, sessions });
          break;
        }
        case 'DELETE_SESSION': {
          const sessions = await deleteSession(msg.payload?.id);
          sendResponse({ ok: true, sessions });
          break;
        }
        case 'OPEN_LAST_SESSION': {
          await openLastSession(true);
          sendResponse({ ok: true });
          break;
        }
        case 'RESTORE_SESSION': {
          await restoreSession(msg.payload?.session, true);
          sendResponse({ ok: true });
          break;
        }
        case 'CLOSE_DUPLICATES': {
          const settings = await getSettings();
          const closed = await closeDuplicates({ keepPinned: settings.keepPinned });
          sendResponse({ ok: true, closed });
          break;
        }
        case 'FOCUS_NOW': {
          const settings = await getSettings();
          const result = await focusNow(settings.focusScope || 'window');
          sendResponse({ ok: true, result });
          break;
        }
        case 'EXPORT_SESSIONS': {
          const url = await exportSessions();
          sendResponse({ ok: true, url });
          break;
        }
        case 'IMPORT_SESSIONS': {
          const count = await importSessions(msg.payload?.json || '[]');
          sendResponse({ ok: true, count });
          break;
        }
        case 'GET_SETTINGS': {
          const s = await getSettings();
          sendResponse({ ok: true, settings: s });
          break;
        }
        case 'UPDATE_SETTINGS': {
          const s = await updateSettings(msg.payload || {});
          sendResponse({ ok: true, settings: s });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) {
      console.error('BG error:', e);
      sendResponse({ ok: false, error: e.message });
    }
  })();

  // wichtig für async sendResponse in MV3:
  return true;
});
