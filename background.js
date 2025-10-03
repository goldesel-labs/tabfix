// ======= Konstanten & Utils =======
const KEY = {
  SESSIONS: "tabfix.sessions",          // Array<Session>
  LAST_ID:  "tabfix.lastSessionId",
  CFG:      "tabfix.config"             // {autoRestore:boolean, restoreMode:'last'|'favorite'}
};
const REPO_URL = "https://github.com/goldesel-labs/tabfix";

const defaultConfig = { autoRestore: true, restoreMode: "last" };

async function getCfg() {
  const { [KEY.CFG]: cfg } = await chrome.storage.sync.get(KEY.CFG);
  return { ...defaultConfig, ...(cfg || {}) };
}
async function setCfg(cfg) { await chrome.storage.sync.set({ [KEY.CFG]: cfg }); }

async function getSessions() {
  const { [KEY.SESSIONS]: sessions = [] } = await chrome.storage.local.get(KEY.SESSIONS);
  return sessions;
}
async function saveSessions(s) { await chrome.storage.local.set({ [KEY.SESSIONS]: s }); }

async function setLastId(id) { await chrome.storage.local.set({ [KEY.LAST_ID]: id }); }
async function getLastId() {
  const { [KEY.LAST_ID]: id } = await chrome.storage.local.get(KEY.LAST_ID);
  return id || null;
}
const iso = () => new Date().toISOString();
const byId = (arr, id) => arr.find(x => x.id === id);

// ======= Kernfunktionen =======
async function snapshotCurrentWindow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter(t => t.url && !t.url.startsWith("chrome://"))
    .map(t => ({ url: t.url, pinned: !!t.pinned, title: t.title || "" }));
}

async function saveCurrentSession(name = "") {
  const snap = await snapshotCurrentWindow();
  const sessions = await getSessions();
  const id = crypto.randomUUID();
  const entry = { id, name: name || `Session ${sessions.length + 1}`, createdAt: iso(), favorite: false, tabs: snap };
  sessions.unshift(entry);
  await saveSessions(sessions);
  await setLastId(id);
  setBadge("✓");
  return entry;
}

async function openSession(s) {
  if (!s) throw new Error("Session nicht gefunden");
  const win = await chrome.windows.create({ url: s.tabs.length ? s.tabs.map(t => t.url) : undefined });
  const newTabs = await chrome.tabs.query({ windowId: win.id });
  for (let i = 0; i < Math.min(newTabs.length, s.tabs.length); i++) {
    if (s.tabs[i].pinned) try { await chrome.tabs.update(newTabs[i].id, { pinned: true }); } catch {}
  }
}

async function openById(id) {
  const sessions = await getSessions();
  const s = byId(sessions, id);
  await openSession(s);
  await setLastId(id);
}

async function openLast() {
  const id = await getLastId();
  if (!id) throw new Error("Keine letzte Session gespeichert");
  await openById(id);
}

async function openFavorite() {
  const sessions = await getSessions();
  const fav = sessions.find(x => x.favorite);
  if (!fav) throw new Error("Keine Favoriten-Session gesetzt");
  await openById(fav.id);
}

async function closeDuplicates() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const seen = new Set();
  const toClose = [];
  for (const t of tabs) {
    const url = (t.url || "").replace(/#.*$/, "");
    if (!url || url.startsWith("chrome://")) continue;
    if (seen.has(url)) toClose.push(t.id);
    else seen.add(url);
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  setBadge(toClose.length ? String(toClose.length) : "");
  return toClose.length;
}

async function focusNow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const others = tabs.filter(t => !t.active).map(t => t.id);
  if (others.length) {
    const gid = await chrome.tabs.group({ tabIds: others });
    await chrome.tabGroups.update(gid, { collapsed: true, title: "Tabfix – Focus" });
  }
}

function setBadge(text = "") {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#111" });
}

function openRepo() { chrome.tabs.create({ url: REPO_URL }); }

async function exportSessions() {
  const sessions = await getSessions();
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: "tabfix-sessions.json", saveAs: true });
  URL.revokeObjectURL(url);
}

async function importSessionsFromText(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Ungültiges JSON");
  await saveSessions(parsed);
}

// ======= Kontextmenü & Shortcuts =======
chrome.runtime.onInstalled.addListener(async () => {
  // Kontextmenü
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "tabfix.save",    title: "Tabfix: Aktuelle Session speichern", contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabfix.openlast",title: "Tabfix: Letzte Session öffnen",     contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabfix.focus",   title: "Tabfix: Focus jetzt erzwingen",     contexts: ["action"] });
    chrome.contextMenus.create({ id: "tabfix.dupes",   title: "Tabfix: Duplikate schließen",       contexts: ["action"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === "tabfix.save") await saveCurrentSession();
    if (info.menuItemId === "tabfix.openlast") await openLast();
    if (info.menuItemId === "tabfix.focus") await focusNow();
    if (info.menuItemId === "tabfix.dupes") await closeDuplicates();
  } catch (e) { notify(String(e?.message || e)); }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  try {
    if (cmd === "save_session")    await saveCurrentSession();
    if (cmd === "open_last")       await openLast();
    if (cmd === "focus_now")       await focusNow();
    if (cmd === "close_dupes")     await closeDuplicates();
  } catch (e) { notify(String(e?.message || e)); }
});

// ======= Auto-Restore =======
chrome.runtime.onStartup.addListener(async () => {
  try {
    const cfg = await getCfg();
    if (!cfg.autoRestore) return;
    if (cfg.restoreMode === "favorite") await openFavorite();
    else await openLast();
  } catch { /* still silent */ }
});

// ======= Messaging (Popup/Options) =======
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    try {
      switch (msg.type) {
        case "SAVE_SESSION":      return send({ ok: true, entry: await saveCurrentSession(msg.name) });
        case "OPEN_LAST":         await openLast(); return send({ ok: true });
        case "OPEN_BY_ID":        await openById(msg.id); return send({ ok: true });
        case "CLOSE_DUPES":       return send({ ok: true, closed: await closeDuplicates() });
        case "FOCUS_NOW":         await focusNow(); return send({ ok: true });
        case "OPEN_REPO":         openRepo(); return send({ ok: true });
        case "GET_SESSIONS":      return send({ ok: true, sessions: await getSessions() });
        case "SET_SESSIONS":      await saveSessions(msg.sessions || []); return send({ ok: true });
        case "SET_LAST":          await setLastId(msg.id); return send({ ok: true });
        case "GET_CFG":           return send({ ok: true, cfg: await getCfg() });
        case "SET_CFG":           await setCfg(msg.cfg || defaultConfig); return send({ ok: true });
        case "EXPORT":            await exportSessions(); return send({ ok: true });
        case "IMPORT_TEXT":       await importSessionsFromText(msg.text || ""); return send({ ok: true });
        default:                  return send({ ok: false, error: "Unknown message" });
      }
    } catch (e) { return send({ ok: false, error: String(e?.message || e) }); }
  })();
  return true;
});

function notify(message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "assets/icon-128.png",
    title: "Tabfix",
    message
  }, () => {});
}
