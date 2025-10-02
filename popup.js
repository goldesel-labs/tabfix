function el(id){ return document.getElementById(id); }
function liSession(s){
  const li = document.createElement('li');
  li.innerHTML = `
    <div class="row">
      <div>
        <strong>${s.name}</strong>
        <div class="sub">${new Date(s.createdAt).toLocaleString()} • ${s.items.length} Tabs</div>
      </div>
      <div class="actions">
        <button data-act="restore" data-id="${s.id}">Wiederherstellen</button>
        <button data-act="delete" data-id="${s.id}" class="danger">Löschen</button>
      </div>
    </div>`;
  return li;
}
async function refresh() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
  const list = el('sessionList'); list.innerHTML = '';
  (res.sessions || []).forEach(s => list.appendChild(liSession(s)));
}
el('saveBtn').addEventListener('click', async () => {
  const name = el('sessionName').value.trim();
  await chrome.runtime.sendMessage({ type: 'SAVE_SESSION', name: name || undefined });
  el('sessionName').value = ''; await refresh();
});
el('openLast').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
  if ((res.sessions||[]).length) {
    await chrome.runtime.sendMessage({ type: 'RESTORE_SESSION', id: res.sessions[0].id });
    window.close();
  }
});
el('closeDups').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLOSE_DUPLICATES' });
  window.close();
});
el('focusNow').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'FOCUS_MODE' });
  window.close();
});
el('openOptions').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  window.close();
});
el('openRepo').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_REPO' });
  window.close();
});
el('sessionList').addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if(!t) return;
  const id = t.dataset.id, act = t.dataset.act;
  if (act === 'restore') { await chrome.runtime.sendMessage({ type: 'RESTORE_SESSION', id }); window.close(); }
  if (act === 'delete')  { await chrome.runtime.sendMessage({ type: 'DELETE_SESSION', id }); await refresh(); }
});
refresh();
