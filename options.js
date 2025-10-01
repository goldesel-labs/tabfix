async function send(type, payload={}) {
  return new Promise(res => chrome.runtime.sendMessage({ type, ...payload }, res));
}

async function load() {
  const { ok, data } = await send('GET_SETTINGS');
  if (!ok) return;

  document.getElementById('autoCloseMinutes').value = data.autoCloseMinutes;
  document.getElementById('autoClosePinned').checked = !!data.autoClosePinned;
  document.getElementById('restoreInNewWindow').checked = !!data.restoreInNewWindow;
  document.getElementById('keepCurrentWindowOnRestore').checked = !!data.keepCurrentWindowOnRestore;

  document.getElementById('focusMode').checked = !!data.focusMode;
  document.getElementById('focusAllowlist').value = (data.focusAllowlist || []).join(', ');
}

document.getElementById('save').onclick = async () => {
  const patch = {
    autoCloseMinutes: Number(document.getElementById('autoCloseMinutes').value || 0),
    autoClosePinned: document.getElementById('autoClosePinned').checked,
    restoreInNewWindow: document.getElementById('restoreInNewWindow').checked,
    keepCurrentWindowOnRestore: document.getElementById('keepCurrentWindowOnRestore').checked,
    focusMode: document.getElementById('focusMode').checked,
    focusAllowlist: document.getElementById('focusAllowlist').value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  };
  const r = await send('SET_SETTINGS', { patch });
  const status = document.getElementById('status');
  status.textContent = r.ok ? 'Gespeichert.' : 'Fehler.';
  setTimeout(() => status.textContent = '', 1500);
};

load();
