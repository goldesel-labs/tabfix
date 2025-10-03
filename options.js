const send = (type, payload={}) => chrome.runtime.sendMessage({ type, ...payload });

async function load() {
  const res = await send("GET_SESSIONS");
  const cfgRes = await send("GET_CFG");
  render(res.sessions || []);
  loadCfg(cfgRes.cfg);
}

function loadCfg(cfg) {
  document.getElementById("autoRestore").checked = !!cfg.autoRestore;
  [...document.querySelectorAll("input[name=restoreMode]")].forEach(r => {
    r.checked = (r.value === cfg.restoreMode);
  });
}

function render(sessions) {
  const tbody = document.getElementById("list");
  tbody.innerHTML = "";
  for (const s of sessions) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="radio" name="fav" ${s.favorite ? "checked" : ""} data-id="${s.id}" title="Als Favorit markieren"></td>
      <td><input type="text" value="${escapeHtml(s.name)}" data-id="${s.id}" class="name"></td>
      <td>${new Date(s.createdAt).toLocaleString()}</td>
      <td>${s.tabs?.length || 0}</td>
      <td>
        <button data-open="${s.id}">Öffnen</button>
        <button data-del="${s.id}">Löschen</button>
      </td>`;
    tbody.appendChild(tr);
  }

  tbody.onclick = async (e) => {
    const openId = e.target.dataset.open;
    const delId  = e.target.dataset.del;
    const favFor = e.target.getAttribute("name") === "fav" ? e.target.dataset.id : null;

    if (openId) {
      await send("OPEN_BY_ID", { id: openId });
      await send("SET_LAST", { id: openId });
    } else if (delId) {
      const list = (await send("GET_SESSIONS")).sessions || [];
      await send("SET_SESSIONS", { sessions: list.filter(x => x.id !== delId) });
      render((await send("GET_SESSIONS")).sessions || []);
    } else if (favFor) {
      const list = (await send("GET_SESSIONS")).sessions || [];
      list.forEach(x => x.favorite = (x.id === favFor));
      await send("SET_SESSIONS", { sessions: list });
      render(list);
    }
  };

  tbody.onchange = async (e) => {
    if (e.target.classList.contains("name")) {
      const id = e.target.dataset.id;
      const list = (await send("GET_SESSIONS")).sessions || [];
      const s = list.find(x => x.id === id);
      if (s) s.name = e.target.value.trim() || s.name;
      await send("SET_SESSIONS", { sessions: list });
    }
  };
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

// Einstellungen speichern
document.getElementById("saveCfg").onclick = async () => {
  const autoRestore = document.getElementById("autoRestore").checked;
  const mode = [...document.querySelectorAll("input[name=restoreMode]")].find(r => r.checked)?.value || "last";
  await send("SET_CFG", { cfg: { autoRestore, restoreMode: mode } });
};

// Export/Import
document.getElementById("export").onclick = async () => { await send("EXPORT"); };

document.getElementById("importBtn").onclick = async () => {
  const file = document.getElementById("importFile").files?.[0];
  if (!file) return;
  const text = await file.text();
  const res = await send("IMPORT_TEXT", { text });
  if (res.ok) render((await send("GET_SESSIONS")).sessions || []);
};

load();
