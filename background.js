/* Tabfix — Background (MV3)
   Kernlogik: Sessions, Duplicates, Focus, Export/Import, Auto-Restore, Shortcuts, Kontextmenü
*/
const STORAGE_KEYS = {
  SESSIONS: 'tabfix:sessions',
  SETTINGS: 'tabfix:settings'
};

// -------- Helpers --------
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
  try { const url = new URL(u); return `${url.origin}${url.pathname}`; }
  catch { return u || ''; }
}
async function load(key, fallback) {
  const res = await chrome.storage.local.get(key);
  return res[key] ?? fallback;
}
async function save(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// -------- Sessions --------
async function saveSession(name = null) {
  const snapshot = await getAllWindowsAndTabs();
  const createdAt = new Date().toISOString();

  const session = {
    id: crypto.randomUUID(),
    name: name || `Session ${new Date().toLocaleString()}`,
    createdAt,
    windows: snapshot.map(w => ({
      tabs: w.tabs
        .filter(t => /^https?:\/\//.test(t.url))
        .map(t => ({ url: t.url, pinned: t.pinned }))
    }))
  };

  const sessions = await load(STORAGE_KEYS.SESSIONS, []);
  sessions.unshift(session);
  if (sessions.length > 30) sessions.length = 30;
  await save(STORAGE_KEYS.SESSIONS, sessions);
  return session;
}
async function listSessions() { return load(STORAGE_KEYS.SESSIONS, []); }
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
    for (let i = 0; i < session.windows.length; i++) {
      const w = session.windows[i];
      const urls = w.tabs.map(t => t.url);
      if (!urls.length) continue;
      await chrome.windows.create({ url: urls, focused: i === 0 });
    }
  } else {
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

// -------- Duplicate Handling --------
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
        try { await chrome.tabs.remove(t.id); closed++; } catch {}
      } else { seen.add(key); }
    }
  }
  return closed;
}

// -------- Focus Mode --------
async function focusNow(scope = 'window') {
  const current = await chrome.windows.getCurrent({ populate: true });
  const all = await chrome.windows.getAll({ populate: true });

  if (scope === 'window') {
    for (const w of all) if (w.id !== current.id) { try { await chrome.windows.remove(w.id); } catch {} }
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
          if (host !== activeDomain) { await chrome.tabs.remove(t.id); closedTabs++; }
        }
      } catch {}
    }
    return { closedTabs };
  }
  return {};
}

// -------- Export / Import --------
async function exportSessions() {
  const sessions = await load(STORAGE_KEYS.SESSIONS, []);
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  return url; // Popup lädt und lädt herunter
}
async function importSessions(jsonString) {
  const incoming = JSON.parse(jsonString);
  if (!Array.isArray(incoming)) throw new Error('Ungültiges Format');
  const current = await load(STORAGE_KEYS.SESSIONS, []);
  const withIds = incoming.map(s => ({ ...s, id: s.id || crypto.randomUUID() }));
  const merged = [...withIds, ...current];
  await save(STORAGE_KEYS.SESSIONS, merged);
  return merged.length;
}

// -------- Settings / Auto-Restore --------
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
  await getSettings();
  // Kontextmenü
  chrome.contextMenus.create({
    id: 'tabfix-save',
    title: 'Mit Tabfix: Session speichern',
    contexts: ['action', 'page']
  });
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'tabfix-save') await saveSession();
});
chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings();
  if (s.autoRestore) { try { await openLastSession(true); } catch(e) { console.warn(e); } }
});

// -------- Shortcuts (commands) --------
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'save_session') await saveSession();
    else if (command === 'open_last_session') await openLastSession(true);
    else if (command === 'close_duplicates') {
      const s = await getSettings(); await closeDuplicates({ keepPinned: s.keepPinned });
    } else if (command === 'focus_now') {
      const s = await getSettings(); await focusNow(s.focusScope || 'window');
    }
  } catch (e) { console.error('Command error', e); }
});

// -------- Message API (Popup/Options) --------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'SAVE_SESSION': sendResponse({ ok: true, session: await saveSession(msg.payload?.name) }); break;
        case 'LIST_SESSIONS': sendResponse({ ok: true, sessions: await listSessions() }); break;
        case 'DELETE_SESSION': sendResponse({ ok: true, sessions: await deleteSession(msg.payload?.id) }); break;
        case 'OPEN_LAST_SESSION': await openLastSession(true); sendResponse({ ok: true }); break;
        case 'RESTORE_SESSION': await restoreSession(msg.payload?.session, true); sendResponse({ ok: true }); break;
        case 'CLOSE_DUPLICATES': {
          const s = await getSettings(); const closed = await closeDuplicates({ keepPinned: s.keepPinned });
          sendResponse({ ok: true, closed }); break;
        }
        case 'FOCUS_NOW': {
          const s = await getSettings(); const result = await focusNow(s.focusScope || 'window');
          sendResponse({ ok: true, result }); break;
        }
        case 'EXPORT_SESSIONS': sendResponse({ ok: true, url: await exportSessions() }); break;
        case 'IMPORT_SESSIONS': sendResponse({ ok: true, count: await importSessions(msg.payload?.json || '[]') }); break;
        case 'GET_SETTINGS': sendResponse({ ok: true, settings: await getSettings() }); break;
        case 'UPDATE_SETTINGS': sendResponse({ ok: true, settings: await updateSettings(msg.payload || {}) }); break;
        default: sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) { console.error('BG error:', e); sendResponse({ ok: false, error: e.message }); }
  })();
  return true;
});
