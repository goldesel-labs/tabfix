function send(type, payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, res => resolve(res || { ok:false })));
}
async function loadSettings() {
  const res = await send('GET_SETTINGS');
  const s = res.settings || {};
  document.getElementById('autoRestore').checked = !!s.autoRestore;
  document.getElementById('keepPinned').checked = !!s.keepPinned;
  document.getElementById('focusScope').value = s.focusScope || 'window';
}
document.getElementById('save').addEventListener('click', async () => {
  const payload = {
    autoRestore: document.getElementById('autoRestore').checked,
    keepPinned: document.getElementById('keepPinned').checked,
    focusScope: document.getElementById('focusScope').value
  };
  await send('UPDATE_SETTINGS', payload);
  alert('Gespeichert.');
});
loadSettings();
