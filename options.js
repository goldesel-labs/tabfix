<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <title>Tabfix – Einstellungen</title>
  <style>
    body { font: 14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; margin:20px; max-width:900px; }
    h1 { margin:0 0 12px; }
    .cfg { margin: 16px 0; padding: 12px; border:1px solid #eee; border-radius:10px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border-bottom: 1px solid #eee; padding: 8px; text-align: left; }
    button { padding:6px 10px; border:1px solid #ddd; border-radius:8px; cursor:pointer; }
    input[type=text] { padding:6px 8px; border:1px solid #ddd; border-radius:8px; width: 100%; }
    .row { display:flex; gap:8px; flex-wrap: wrap; }
  </style>
</head>
<body>
  <h1>Tabfix – Einstellungen & Sessions</h1>

  <div class="cfg">
    <label><input type="checkbox" id="autoRestore"> Auto-Restore beim Browserstart</label>
    <div class="row" style="margin-top:8px">
      <label><input type="radio" name="restoreMode" value="last"> Letzte Session</label>
      <label><input type="radio" name="restoreMode" value="favorite"> Favorit</label>
      <button id="saveCfg">Einstellungen speichern</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="export">Export (JSON)</button>
      <input type="file" id="importFile" accept="application/json">
      <button id="importBtn">Import</button>
    </div>
  </div>

  <h2>Gespeicherte Sessions</h2>
  <table>
    <thead>
      <tr><th>Favorit</th><th>Name</th><th>Erstellt</th><th>Tabs</th><th>Aktion</th></tr>
    </thead>
    <tbody id="list"></tbody>
  </table>

  <script src="options.js"></script>
</body>
</html>
