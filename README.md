# ACMP CTL: Community Template Library

Eine offene Bibliothek mit **Client-Command-Vorlagen für ACMP** ([Aagon Client Management Platform](https://www.aagon.com/)). Ihr sucht nach Anwendung, Aufgabe oder einzelnen Schritten, prüft jeden Schritt im Klartext und lasst eure KI den Command als **Entwurf** in eurer ACMP-Console anlegen.

**Zur Bibliothek: https://herzog-gmbh.github.io/acmp-ctl/**

> *English summary: An open library of ACMP client command templates. Every template is readable JSON, checked for secrets and internal names, and can be installed as a draft through the [ACMP MCP server](https://github.com/Herzog-GmbH/acmp-mcp). Docs are in German because ACMP's user base is mostly DACH.*

## Warum nicht einfach .sim-Dateien?

Die Exporte aus der ACMP-Console (`.sim`) sind verschlüsselt. Was ein Command tut, sieht man erst nach dem Import, und dann läuft er unter Umständen schon als SYSTEM auf allen Clients. Die CTL speichert Commands deshalb als **lesbare JSON-Vorlage**: jeder Schritt mit Klasse, Beschreibung und Feldern, dazu Parameter, Voraussetzungen und Dateien mit SHA-256.

## Installieren mit dem ACMP MCP

Der [ACMP MCP](https://github.com/Herzog-GmbH/acmp-mcp) verbindet eure KI (Claude, ChatGPT/Codex, GitHub Copilot, Gemini, Cursor) mit ACMP. Mit ihm reicht ein Satz:

```text
Installiere aus der ACMP CTL die Vorlage „Druckwarteschlange leeren“ als Entwurf in den Ordner Wartung.
```

Die KI lädt die Vorlage, prüft sie, setzt eure Parameter ein und stellt eine Freigabe-Anfrage. Nach Zustimmung eines Kollegen liegt der Command als Entwurf in eurer Console. **Auf Clients läuft erst etwas, wenn ihr ihn freigebt**, in der Console oder per `acmp_cc_release`. Testet ihn vorher auf einem Rechner.

Ablauf beim Installieren (so setzt es `acmp_lib_install` um):

1. `template.json` laden. Mit `status: "beispiel"` wird abgebrochen.
2. Jedes `{{NAME}}` in `steps` und `variables` durch den Parameterwert ersetzen. `{{GLOBAL_ACCOUNT_ID}}` wird durch die ID des globalen ACMP-Accounts ersetzt, den ihr nennt. `{{CF:<Feld>:<Eigenschaft>}}` wird über den Feldnamen in eurer Installation aufgelöst.
3. Dateien beim Hersteller laden (`url`) oder aus dem Repo nehmen (`path`) und den SHA-256 prüfen.
4. Entwurf anlegen wie `acmp_cc_create_draft`, Dateien anhängen wie `acmp_cc_add_file`. Mit `dryRun: true` zeigt der MCP nur, was angelegt würde.

Voraussetzung ist der ACMP MCP mit eingeschaltetem CC-Writer (siehe dort `docs/ACMP-VORBEREITUNG.md`). Ohne MCP könnt ihr jede Vorlage auch von Hand nachbauen: Die Website zeigt jeden Schritt samt Skript.

## Aufbau

```
schema/ctl-template-1.schema.json   Format einer Vorlage (JSON Schema)
templates/<id>/template.json        eine Vorlage je Ordner, optional README.md und files/
community/aagon-filebase.json       Verweise auf die Aagon Community Filebase (nur Links)
tools/build.mjs                     prüft alle Vorlagen und baut site/index.json
tools/from-decode.mjs               macht aus acmp_cc_decode eine Vorlage und bereinigt sie
site/                               die Webseite (statisch, liest index.json)
```

Gebraucht wird nur Node.js 20 oder neuer, keine weiteren Pakete.

```powershell
node tools/build.mjs            # prüfen und site/index.json bauen
node tools/build.mjs --check    # nur prüfen
```

## Eine Vorlage im Überblick

```json
{
  "schema": "acmp-ctl/template@1",
  "id": "edge-startseite",
  "version": "1.0.0",
  "status": "entwurf",
  "name": "Edge-Startseite festlegen",
  "summary": "Setzt Startseite und Startverhalten von Microsoft Edge per Richtlinie.",
  "category": "Windows-Einstellungen",
  "applications": [{ "name": "Microsoft Edge", "vendor": "Microsoft" }],
  "parameters": [{ "name": "STARTSEITE", "description": "Adresse beim Start", "default": "https://intranet.example.com" }],
  "variables": [{ "name": "STARTSEITE", "value": "{{STARTSEITE}}" }],
  "steps": [{ "class": "TModifyReg", "description": "Registrywerte bearbeiten", "fields": { "…": "…" } }]
}
```

Die Schritte haben genau das Format, das `acmp_cc_decode` ausgibt und `acmp_cc_create_draft` annimmt. `status` ist `beispiel` (zeigt nur das Format), `entwurf` (installierbar, Review offen) oder `geprueft` (in mehreren Umgebungen getestet).

## Status der Vorlagen

Alle Vorlagen sind gegen ACMP 6.10 geprüft: Format, Kennwörter, interne Namen und ein Probelauf der Installation (`dryRun`). `entwurf` heißt, dass die Vorlage installierbar ist, aber noch nicht in mehreren Umgebungen auf Clients lief. Rückmeldungen aus euren Tests, gern als Issue, bringen eine Vorlage auf `geprueft`.

## Beitragen

Siehe [CONTRIBUTING.md](CONTRIBUTING.md). Kurz: Command mit `acmp_cc_decode` auslesen, mit `tools/from-decode.mjs` umwandeln, die TODOs ausfüllen, `node tools/build.mjs --check` laufen lassen und einen Pull Request stellen.

## Hinweise

- ACMP CTL ist ein Community-Projekt der herzog GmbH und **kein Angebot der Aagon GmbH**. ACMP ist ein Produkt der Aagon GmbH.
- Vorlagen legen Commands direkt in der ACMP-Datenbank an. Das ist von Aagon nicht vorgesehen. Prüft jede Vorlage, bevor ihr sie freigebt, und testet sie zuerst auf einem Testrechner.
- Einträge aus der Aagon Community Filebase sind nur verlinkt. Die Exporte gehören ihren Autoren und liegen nicht in diesem Repo.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Mit einem Pull Request stellt ihr eure Vorlage unter dieselbe Lizenz.
