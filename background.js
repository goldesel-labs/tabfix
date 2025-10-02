/* Tabfix Background – Kernlogik: Sessions speichern/wiederherstellen, Fokus-Modus, Duplicates schließen */

const STORAGE_KEY = 'tabfix:sessions';
const SETTINGS_KEY = 'tabfix:settings';

/** Hilfen **/
async function getAllTabsInCurrentWindow() {
  const win = await chrome.windows.getCurrent({ populate: true });
  return (win.tabs || []).filter(t => !t.discarded);
}
async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.sync.get(SETTINGS_KEY);
  return s || { focusKeepPinned: true, focusKeepSameDomain: true, focusCloseAudible: false, sessionsLimit: 20 };
}
async function saveSettings(s) { await chrome.storage.sync.set({ [SETTINGS_KEY]: s }); }
async function loadSessions() {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(raw) ? raw : [];
}
async function persistSessions(list) { await chrome.storage.local.set({ [STORAGE_KEY]: list.slice(0, 50) }); }
function sameDomain(u1, u2) {
  try {
    const a = new URL(u1), b = new URL(u2);
    return a.hostname.replace(/^www\./,'') === b.hostname.replace(/^www\./,'');
  } catch { return false; }
}

async function saveCurrentSession(name = null) {
  const tabs = await getAllTabsInCurrentWindow();
  const items = tabs.map(t => ({ url: t.url, pinned: t.pinned, title: t.title }));
  const sessions = await loadSessions();
  const stamp = new Date().toISOString().replace('T',' ').replace(/\..+/, '');
  sessions.unshift({ id: crypto.randomUUID(), name: name || `Session ${stamp}`, createdAt: Date.now(), items });
  await persistSessions(sessions);
  return sessions[0];
}
async function restoreSession(id) {
  const sessions = await loadSessions();
  const s = sessions.find(x => x.id === id) || sessions[0];
  if (!s) return false;
  const win = await chrome.windows.getCurrent();
  for (const it of s.items) {
    try { await chrome.tabs.create({ windowId: win.id, url: it.url, pinned: !!it.pinned, active: false }); }
    catch {}
  }
  return true;
}
async function deleteSession(id) {
  const sessions = await loadSessions();
  await persistSessions(sessions.filter(s => s.id !== id));
}

async function focusMode() {
  const settings = await getSettings();
  const tabs = await getAllTabsInCurrentWindow();
  const active = tabs.find(t => t.active) || tabs[0];
  if (!active) return;

  const toClose = [];
  for (const t of tabs) {
    if (t.id === active.id) continue;
    if (settings.focusKeepPinned && t.pinned) continue;
    if (settings.focusKeepSameDomain && sameDomain(t.url, active.url)) continue;
    if (!settings.focusCloseAudible && t.audible) continue;
    toClose.push(t.id);
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  return toClose.length;
}

async function closeDuplicates() {
  const tabs = await getAllTabsInCurrentWindow();
  const seen = new Set();
  const toClose = [];
  for (const t of tabs) {
    const key = (t.url || '').split('#')[0]; // gleiche Seite, unabhängig vom Hash
    if (seen.has(key) && !t.pinned) toClose.push(t.id);
    else seen.add(key);
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  return toClose.length;
}

/** Shortcuts **/
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'tabfix_focus_mode') await focusMode();
  if (cmd === 'tabfix_save_session') await saveCurrentSession();
  if (cmd === 'tabfix_restore_last') {
    const sessions = await loadSessions();
    if (sessions.length) await restoreSession(sessions[0].id);
  }
});

/** Messages von Popup / Options **/
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    if (msg?.type === 'SAVE_SESSION') {
      send({ ok: true, session: await saveCurrentSession(msg.name || null) });
    } else if (msg?.type === 'GET_SESSIONS') {
      send({ ok: true, sessions: await loadSessions() });
    } else if (msg?.type === 'RESTORE_SESSION') {
      send({ ok: await restoreSession(msg.id) });
    } else if (msg?.type === 'DELETE_SESSION') {
      await deleteSession(msg.id); send({ ok: true });
    } else if (msg?.type === 'FOCUS_MODE') {
      const n = await focusMode(); send({ ok: true, closed: n });
    } else if (msg?.type === 'CLOSE_DUPLICATES') {
      const n = await closeDuplicates(); send({ ok: true, closed: n });
    } else if (msg?.type === 'OPEN_OPTIONS') {
      await chrome.runtime.openOptionsPage(); send({ ok: true });
    } else if (msg?.type === 'OPEN_REPO') {
      await chrome.tabs.create({ url: 'https://github.com/goldesel-labs/tabfix' }); send({ ok: true });
    } else if (msg?.type === 'GET_SETTINGS') {
      send({ ok: true, settings: await getSettings() });
    } else if (msg?.type === 'SET_SETTINGS') {
      await saveSettings(msg.settings); send({ ok: true });
    }
  })();
  return true; // async response
});
