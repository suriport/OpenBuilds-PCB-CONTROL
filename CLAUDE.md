# CLAUDE.md

**PCB-Control** – Electron-Host-Software für CNC-Maschinen mit Grbl / grblHAL / FluidNC
(USB-Seriell oder Telnet/WLAN), für das Fräsen von Leiterplatten.
Basis ist [GrooveControl](https://github.com/ivomirb/GrooveControl) (Remote `groove`), ein aktiv
gepflegter Nachfolger von OpenBuilds CONTROL. Die eigene Maschine läuft mit **Grbl 1.1h** (128-Byte-RX-Puffer).

## Entwicklung

- **Node 26** verwenden (`.nvmrc`; wie im GitHub-Build). Vor dem Arbeiten im Terminal: `nvm use`.
- `npm install` – der `postinstall`-Hook baut native Module (`serialport`) gegen die Electron-Version neu.
- **Start:** `npm run run-local` (= `electron .`). Debug-Ausgaben: `DEBUGCONTROL=true npm run run-local`.
- Webserver-Port: zuerst 3020, Fallback 3000/3200/3220, Override via `GROOVE_WEB_PORT`.
- Es gibt **keine automatisierten Tests** – Änderungen müssen manuell in der App geprüft werden
  (wenn möglich ohne angeschlossene Maschine oder mit gesicherter Maschine / ohne Werkzeug).
- Statische Analyse: ESLint (`eslint.config.mjs`, `eslint_src.bat` / `eslint_app.bat`).
- Die App erlaubt nur **eine Instanz**. Läuft schon eine (auch eine alte), beendet sich ein neuer Start
  sofort und still. Vor dem Testen prüfen, welche Instanz läuft.

## Updates von GrooveControl übernehmen

- `git fetch groove`, dann `git merge groove/master` in einem eigenen Branch, nie direkt auf `master`.
- Vor dem Merge die Änderungen durchsehen und alles markieren, was die Maschinensteuerung berührt
  (siehe Sicherheitsregel). Danach Test an der Maschine.
- Eigene Änderungen möglichst in **eigene Dateien** legen und in GrooveControl-Dateien nur das Nötigste
  ändern, damit Merges konfliktarm bleiben.
- Eigene Abweichungen von GrooveControl: Name „PCB-Control“ (sichtbare Stellen, `package.json`),
  Update-Suche standardmäßig aus (`enableUpdates: false` in `src/core.js`).
  `APP_NAME` in `app/js/main.js` bleibt bewusst „Groove Control“ (Makros prüfen darauf).

## Architektur

```
src/main.js        Electron-Hauptprozess: Fenster, Tray, Menü, Start (Einstieg laut package.json)
src/core.js        globaler Zustand `status`, Konfiguration (persistentConfig), debug_log, Ports
src/server.js      Express-HTTP-Server + Socket.IO-Server (liefert app/ aus)
src/grblPort.js    serielle Schnittstelle / Telnet: connectTo, closePort, Netzwerkscan
src/grblSender.js  Antworten parsen (Statusreport, ok, ALARM, error), Queue + Streaming,
                   runJob, stop, pause/unpause, clearAlarm, resetMachine
src/grblUtilities.js  Jog, Overrides, setZero, gotoZero, setPosition, probe
src/files.js       Datei-Dialoge, zuletzt geöffnete Dateien
src/update.js      Auto-Updater (electron-updater), standardmäßig aus
```

Die UI ist eine **normale Web-App** (jQuery + Metro4 + three.js, keine Build-Pipeline), die nur über
Socket.IO und ein paar HTTP-Endpunkte (`/runjob`, `/saveFile`, `/gcode`) mit dem Hauptprozess spricht –
sie läuft daher auch im Browser auf anderen Geräten im Netz.

- `app/main.html` – Hauptoberfläche, bindet alle Skripte per `<script>` ein (Reihenfolge relevant, globale Variablen).
- `app/js/websocket.js` – Socket.IO-Client, empfängt Status, sendet Befehle.
- `app/js/jog.js`, `app/js/keyboard.js`, `app/js/mobilejog.js`, `app/jog/` – Jog-Buttons, Tastaturkürzel, mobile Jog-Oberfläche.
- `app/js/heightmap/heightmap.js` – Höhenkarte: Antasten im Raster (`G38.2`) und Anpassen der Z-Werte im G-Code.
- `app/js/probe/`, `surfacing/`, `calibration/`, `resume/` – Assistenten.

### Namen der UI-Bereiche (gemeinsame Sprache mit dem Nutzer)

Grundregel: Wo die UI eine Beschriftung hat, genau diese (englisch) verwenden; sonst die deutschen Namen unten.
Von oben nach unten in `app/main.html`:

- **Titelleiste** (`#windowtitlebar`)
- **Menüband** (Ribbon) mit den Reitern **Machine Control**, **Grbl Settings**, **Help & Troubleshooting**;
  Knöpfe werden mit ihrer **Gruppe** benannt, z. B. „Menüband → Control → Pause Job“.
  Gruppen auf Machine Control: Machine Connection, File, Control, Wizards, Settings, **E-Stop** (Unlock Alarm, Abort).
- **Positionsanzeige** (DRO, `.drotable`): eine **Achszeile** pro Achse; Klick darauf öffnet das **Achs-Menü**
  (Set Zero, Goto, Probe); dazu **Koordinatensystem-Knopf** (`#wcsBtn`, G54–G59) und **WCS/MCS-Umschalter** (`#mcsBtn`).
- **Jog-Bereich** (`#jogcell`): **Pfeiltasten**, **Schrittweite** (0.1/1/10/100 mm), **Jog-Modus**
  (Incremental/Continuous), Jog-**Stop**, **Override-Regler** (Jog-, Feed-, Spindle-Override: `#jro`, `#fro`, `#tro`).
- **Arbeitsbereich** (`#controlLogs`) mit den Reitern **3D View**, **Console**, **Macros**, **G-code Editor**.
- **Statusleiste**: Verbindungs-/Maschinenzustand (`#connectStatus`, `#runStatus`), Job Queue, **Fortschrittsbalken**, Restzeit.
- **Assistenten**: Dialogfenster über allem (Probe-, Höhenkarten-, Planfräs-Assistent usw.).
- **Grbl-Settings-Ansicht** (`#grblPanel`) / **Troubleshooting-Ansicht** (`#troubleshootingPanel`) ersetzen
  Positionsanzeige und Arbeitsbereich, wenn ihr Menüband-Reiter aktiv ist.

Absprachen: „Stop“ immer mit Ort nennen (Stop Job im Menüband, Jog-Stop, Abort im E-Stop).
„Nullpunkt“ = Werkstück-Nullpunkt (WCS); Maschinen-Nullpunkt ausdrücklich so nennen.

### Zentrale Zustände (`status` in src/core.js)

- `status.comms.connectionStatus`: 0 = getrennt, 1 = öffnet, 2 = verbunden/idle, 3 = Job läuft,
  4 = pausiert, 5 = Alarm.
- `gcodeQueue` + `queuePointer` (zu sendende Zeilen), `sentBuffer` (gesendete, noch nicht per `ok`
  bestätigte Zeilen) in `src/grblSender.js`. `calcBufferSpace()` rechnet gegen den RX-Puffer der Steuerung.
- `status.comms.blocked` / `status.comms.paused` steuern, ob `send1Q()` weiter sendet.

### Senden von Befehlen (src/grblSender.js)

- `addQToEnd(gcode)` / `addQToEndAndKick(gcode)` + `send1Q()` → `machineSend()` – normale Zeilen über die
  Queue (warten auf `ok`).
- `addQRealtime(char)` → `machineSendRealtime()` – Grbl-Echtzeitbefehle, gehen **sofort und an der Queue
  vorbei** an den Port und erzeugen kein `ok`:
  `!` Feed Hold, `~` Cycle Start/Resume, `0x18` Soft-Reset (Ctrl-X), `0x85` Jog Cancel,
  `0x90–0x94` Feed-Override, `0x99–0x9D` Spindel-Override, `0x9E` Spindel/Laser-Stop.

## ⚠️ Sicherheitsregel: Maschinenbefehle

Dieser Code bewegt eine echte Maschine mit rotierendem Werkzeug. Fehler können Maschine, Werkstück
oder Menschen gefährden. **Änderungen an allem, was Maschinenbefehle erzeugt, sendet oder deren
Zustand verwaltet, besonders vorsichtig vornehmen** – das betrifft insbesondere:

- **Jog**: `jog`, `jogXY`, `jogTo`, `gotoZero`, `setPosition`, `probe` in `src/grblUtilities.js`;
  `app/js/jog.js`, `app/js/keyboard.js`, `app/jog/`, `app/js/mobilejog.js`
- **Stop / Reset**: `stop()` (Modi abort/stop/jog/smart), `resetMachine`, `closePort` in `src/grblPort.js`
- **Feed Hold / Pause / Resume**: `pause()`, `unpause()`, sowie das automatische `pause()` bei
  `Hold:0` in `parseStatusReport()`
- **Alarm**: `clearAlarm()` (Methode 1 = nur `$X`, Methode 2 = Queue leeren + Soft-Reset + `$X`),
  `handleAlarm()`, `handleError()`, `onParserData()`
- **Overrides**: `feedOverride`, `spindleOverride`
- **Queue / Streaming**: `machineSend()`, `machineSendRealtime()`, `send1Q()`, `addQToEnd()`,
  `addQRealtime()`, `calcBufferSpace()`, `runJob()`, `clearGcodeQueue()`, `finalizeJob()`, sowie alle
  Stellen, die `connectionStatus`, `paused`, `blocked`, `gcodeQueue`, `sentBuffer` ändern
- **G-Code-Umrechnung**: Höhenkarte (`app/js/heightmap/`) und künftige Transformationen (z. B. Schieflage) –
  sie verändern Koordinaten, besonders Z, bevor der G-Code an die Maschine geht
- **Zugriffsschutz**: Herkunftsprüfung für HTTP und Socket.IO in `src/server.js`
- Tastaturkürzel- und Button-Belegungen, die solche Socket-Events auslösen

Pflicht bei solchen Änderungen (auch beim Übernehmen von GrooveControl-Updates):

1. **Vorher erklären** und auf Bestätigung warten: Was ändert sich, welche Bytes/G-Code-Zeilen werden
   in welcher Situation (idle, Job läuft, pausiert, Alarm, Jog aktiv) anders gesendet?
2. **Risiken benennen**: Kann sich die Maschine unerwartet bewegen? Kann ein Stop/Feed Hold verzögert
   werden, ausbleiben oder in der Queue landen statt in Echtzeit? Können Queue-Zustand und Steuerung
   auseinanderlaufen? Werden Timeouts (z. B. die 200 ms zwischen `!` und `0x18` in `stop()`) verändert?
3. **Echtzeitbefehle nie in die Queue verlagern** (Stop, Hold, Reset, Jog-Cancel immer über `addQRealtime`).
4. **Keine Sicherheitsprüfungen entfernen** (z. B. `connectionStatus > 0`, Firmware-Typ-Prüfung,
   Parameter-Validierung bei Jog).
5. Änderungen klein und isoliert halten, kein „Aufräumen“ nebenbei in diesen Funktionen.
6. **Danach erklären**, was geändert wurde, und konkret beschreiben, wie es sicher getestet werden kann
   (z. B. Spindel aus, Werkzeug entfernt, Z hochgefahren, Hand am Not-Aus).

Im Zweifel nachfragen statt annehmen.

## Bekannte Eigenheiten

- Viel globaler Zustand und mehrere Timer-Loops (z. B. `statusTick` in `src/grblSender.js`).
- `UsefulMacros/` enthält Makros von GrooveControl, `BACKUPS OF MACROS FROM FORUM/` nur archivierte Makros –
  beides kein App-Code.
- Der frühere Stand auf Basis von OpenBuilds CONTROL v1.0.390 liegt im Branch `master` (bis zur Umstellung).
