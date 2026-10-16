## Vorlage

- id und Version:
- Was macht der Command, in einem Satz?
- Getestet mit ACMP-Version und auf welchen Clients?

## Checkliste

- [ ] `node tools/build.mjs --check` läuft ohne Fehler
- [ ] keine Kennwörter, Schlüssel, Tokens, auch nicht maskiert
- [ ] keine internen Namen (Server, Freigaben, Domänen, Rechner, Personen); was je Umgebung anders ist, ist ein Parameter
- [ ] keine ausführbaren Dateien im Repo; Programme per `url` vom Hersteller mit SHA-256
- [ ] der Command stammt von mir bzw. meiner Firma, und ich stelle ihn unter die MIT-Lizenz
