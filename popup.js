const $ = sel => document.querySelector(sel);

async function send(type, payload={}) {
  return new Promise(res => chrome.runtime.sendMessage({ type, ...payload }, res));
}

function itemRow(name, count, ts) {
  const div = document.createElement('div');
  div.className = 'item';
  const left = document.createElement('div');
  left.innerHTML = `<strong>${name}</strong><br><small class="muted">${count} Tabs • ${new Date(ts).toLocaleString()}</small>`;
  const actions = document.createElement('div');
  const open = document.createElement('button'); open.textContent = 'Öffnen';
  const del = document.createElement('button'); del.textContent = 'Löschen';
  actions.append(open, del);
  div.append(left, actions);

  open.onclick = async () => {
    const r = await send('RESTORE_SESSION', { name });
    if (!r.ok) alert('Fehler: ' + r.error);
  };
  del.onclick = async () => {
    if (!confirm(`Session "${name}" löschen?`)) return;
    const r = await send('DELETE_SESSION', { name });
    if (r.ok) render(); else alert('Fehler: ' + r.error);
  };
  return div;
}

async function render() {
  const sessionsDiv = $('#sessions');
  sessionsDiv.innerHTML = '';
  const { ok, data } = await send('GET_SESSIONS');
  if (!ok) return sessionsDiv.textContent = 'Laden fehlgeschlagen.';
  const names = Object.keys(data).sort((a,b) => (data[b].createdAt||0)-(data[a].createdAt||0));
  if (!names.length) sessionsDiv.textContent = 'Noch keine Sessions gespeichert.';
  for (const n of names) {
    const s = data[n];
    sessionsDiv.appendChild(itemRow(s.name, s.items.length, s.createdAt));
  }
  // Focus-Status
  const set = await send('GET_SETTINGS');
  $('#focusState').textContent = set?.data?.focusMode ? 'Focus an' : 'Focus aus';
}

$('#saveSession').onclick = async () => {
  const name = $('#sessionName').value.trim() || null;
  const r = await send('CAPTURE_SESSION', { name });
  if (!r.ok) return alert('Fehler: ' + r.error);
  $('#sessionName').value = '';
  render();
};

$('#restoreLast').onclick = async () => {
  const r = await send('RESTORE_SESSION', { name: 'Schnellspeicher' });
  if (!r.ok) alert('Hinweis: ' + (r.error || 'Schnellspeicher nicht vorhanden.'));
};

$('#cleanDupes').onclick = async () => {
  const r = await send('CLOSE_DUPLICATES');
  if (!r.ok) alert('Fehler: ' + r.error);
};

$('#focusNow').onclick = async () => {
  const r = await send('ENFORCE_FOCUS_NOW');
  if (!r.ok) alert('Fehler: ' + r.error);
  render();
};

function openOptions(){ chrome.runtime.openOptionsPage(); }
window.openOptions = openOptions;

render();
