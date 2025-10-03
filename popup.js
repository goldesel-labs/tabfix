const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const ok = (t) => { statusEl.textContent = t; statusEl.style.color = "#1a7f37"; };
const err = (t) => { statusEl.textContent = t; statusEl.style.color = "#b3261e"; };

const send = (type, payload={}) => chrome.runtime.sendMessage({ type, ...payload });

$("save").addEventListener("click", async () => {
  const name = $("sessionName").value.trim();
  const res = await send("SAVE_SESSION", { name });
  res.ok ? ok(`Gespeichert (${res.entry.tabs.length} Tabs)`) : err(res.error || "Fehler");
});

$("openLast").addEventListener("click", async () => {
  const res = await send("OPEN_LAST");
  res.ok ? ok("Letzte Session geöffnet") : err(res.error || "Keine letzte Session");
});

$("closeDupes").addEventListener("click", async () => {
  const res = await send("CLOSE_DUPES");
  res.ok ? ok(`${res.closed} Duplikat(e) geschlossen`) : err(res.error || "Fehler");
});

$("focus").addEventListener("click", async () => {
  const res = await send("FOCUS_NOW");
  res.ok ? ok("Focus aktiviert") : err(res.error || "Fehler");
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("repo").addEventListener("click", async () => {
  const res = await send("OPEN_REPO");
  if (!res.ok) err(res.error || "Fehler");
});
