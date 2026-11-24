# Termed's To-Do-Liste

Web-App fürs iPhone, gebaut wie Termed Fitness. In Safari öffnen, dann Teilen und „Zum Home-Bildschirm“. Danach startet sie ohne Browserleiste.

Die To-dos selbst liegen nicht hier, sondern in einem privaten Repo. Die App liest und schreibt sie über die GitHub-API mit einem eigenen Schlüssel, der nur auf dem Gerät gespeichert ist und nur dieses eine Repo darf.

## Lokal testen

```bash
python3 -m http.server 5181 --bind 127.0.0.1
```

Kein Build-Schritt. `app.js` enthält Anzeige und Sync, `sw.js` sorgt dafür, dass die App auch offline startet.
