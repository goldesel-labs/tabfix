function send(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (res) => resolve(res || { ok: false, error: 'no response' }));
  });
}

async function refreshList() {
  const list = document.getElementById('list');
  list.innerHTML = '...';

  const res = await send('LIST_SESSIONS');
  if (!res.ok) { list.textContent = 'Fehler beim Laden'; return; }

  const sessions = res.sessions || [];
  if (!sessions.length) { list.textContent = 'Noch keine Sessions gespeichert.'; return; }

  list.innerHTML = '';
  sessions.forEach(s => {
    const el = document.createElement('div');
    el.className = 'session';
    const left = document.createElement('div');
    left.innerHTML = `<div><strong>${s.name}</strong></div><div class="muted">${new Date(s.createdAt).toLocaleString()}</div>`;
    const right = document.createElement('div');
    const btnOpen = document.createElement('button');
    btnOpen.textContent = 'Öffnen';
    btnOpen.onclick = async () => { await send('RESTORE_SESSION', { session: s }); };

    const btnDel = document.createElement('button');
    btnDel.textContent = 'Löschen';
    btnDel.onclick = async () => { await send('DELETE_SESSION', { id: s.id }); await refreshList(); };

    right.appendChild(btnOpen);
    right.appendChild(btnDel);
    el.appendChild(left);
    el.appendChild(right);
    list.appendChild(el);
  });
}

document.getElementById('btnSave').addEventListener('click', async () => {
  const name = prompt('Session-Name (optional):', '');
  await send('SAVE_SESSION', { name });
  await refreshList();
});
document.getElementById('btnOpen').addEventListener('click', async () => {
  await send('OPEN_LAST_SESSION');
});
document.getElementById('btnDup').addEventListener('click', async () => {
  const res = await send('CLOSE_DUPLICATES');
  alert(`Geschlossene Duplikate: ${res.closed ?? 0}`);
});
document.getElementById('btnFocus').addEventListener('click', async () => {
  const res = await send('FOCUS_NOW');
  if (res?.result?.closedWindows != null) alert(`Geschlossene Fenster: ${res.result.closedWindows}`);
  if (res?.result?.closedTabs != null) alert(`Geschlossene Tabs: ${res.result.closedTabs}`);
});
document.getElementById('btnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

document.getElementById('btnExport').addEventListener('click', async () => {
  const res = await send('EXPORT_SESSIONS');
  if (res.ok && res.url) {
    const a = document.createElement('a');
    a.href = res.url;
    a.download = `tabfix-sessions-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(res.url);
  }
});
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const txt = await file.text();
  const res = await send('IMPORT_SESSIONS', { json: txt });
  alert(`Importierte Sessions: ${res.count ?? 0}`);
  await refreshList();
});

refreshList();
