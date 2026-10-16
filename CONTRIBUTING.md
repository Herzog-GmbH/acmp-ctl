# Vorlage beitragen

Danke, dass ihr einen Command teilt. Weil Vorlagen auf fremden Clients mit SYSTEM-Rechten laufen, gibt es ein paar feste Regeln.

## In fünf Schritten

1. **Auslesen:** Den Command über den ACMP MCP mit `acmp_cc_decode` auslesen und die Antwort als `<name>.decode.json` speichern. Diese Datei nie einchecken.
2. **Umwandeln:**
   ```powershell
   node tools/from-decode.mjs meincommand.decode.json --id mein-command --category Wartung
   ```
   Das Skript entfernt Kennwortfelder, macht aus globalen Accounts `{{GLOBAL_ACCOUNT_ID}}`, aus RunAs-Konten Parameter und aus euren internen Pfaden (`tools/scan-rules.local.json`, Abschnitt `replace`) ebenfalls Parameter.
3. **Ausfüllen:** In `templates/mein-command/template.json` alle `TODO`-Stellen ersetzen: `summary`, `author`, `tags`, `applications`, Beschreibungen der Parameter. Dateien bekommen `url` (Download beim Hersteller) oder `path` (Skript im Repo) und den SHA-256. Über `category`, `tags` und `applications` landet die Vorlage in den Bereichen der Startseite (Regeln in `tools/bereiche.mjs`); passt sie in keinen, meldet der Build einen Hinweis. Den Bauplan für die Console erzeugt die Website selbst aus den Schritten.
4. **Prüfen:**
   ```powershell
   node tools/build.mjs --check
   ```
   Der Build bricht bei Kennwörtern, UNC-Pfaden mit festem Server, internen DNS-Namen, privaten IP-Adressen, E-Mail-Adressen, fest eingetragenen Konten und offenen TODOs ab. Dateien mit `path` prüft er immer gegen den SHA-256, Dateien mit `url` nur mit `node tools/build.mjs --check --download` (lädt sie beim Hersteller).
5. **Pull Request** stellen. Ein Mensch prüft jede Vorlage, bevor sie auf `status: "entwurf"` online geht. Nach Tests in mindestens einer weiteren Umgebung wird sie `geprueft`.

## Regeln

- **Keine Kennwörter, Schlüssel oder Tokens**, auch nicht maskiert. RunAs-Kennwörter tragt ihr nach der Installation in der Console ein.
- **Keine internen Namen:** Server, Freigaben, Domänen, Rechner- und Benutzernamen werden zu Parametern.
- Interne Muster eurer Firma gehören in `tools/scan-rules.local.json` (Vorlage: `scan-rules.example.json`). Die Datei steht in `.gitignore`, damit die Muster selbst nicht im Repo landen.
- **Keine fremden Commands** ohne Erlaubnis der Autoren. Aagon-Standard-Commands und Downloads aus der Community Filebase nicht als Vorlage einreichen, sondern verlinken.
- **Keine ausführbaren Dateien im Repo.** Programme kommen per `url` vom Hersteller und werden über den SHA-256 geprüft. Im Repo liegen nur Skripte und Textdateien.
- Neue Version bei jeder Änderung: `version` erhöhen (`1.0.0` → `1.0.1` für Korrekturen, `1.1.0` für neue Funktionen, `2.0.0` wenn sich Parameter ändern).

## Parameter

Alles, was je Umgebung anders ist, wird ein Parameter: `"parameters": [{ "name": "STARTSEITE", "description": "…", "default": "…" }]`. Im Text der Schritte und Variablen steht dann `{{STARTSEITE}}`. Soll der Wert später in der Console änderbar sein, legt eine Projektvariable mit Startwert `{{STARTSEITE}}` an und lest in den Schritten `%STARTSEITE%`.
