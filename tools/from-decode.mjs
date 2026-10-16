#!/usr/bin/env node
// ACMP CTL – macht aus der Ausgabe von acmp_cc_decode eine Vorlage (Vorstufe des MCP-Tools acmp_lib_export).
//   node tools/from-decode.mjs <decode.json> --id <vorlagen-id> [--category Wartung] [--out templates/<id>/template.json]
// Bereinigt dabei: Kennwortfelder werden entfernt, globale Accounts und RunAs-Konten werden zu Platzhaltern,
// interne Pfade aus tools/scan-rules.local.json ("replace") werden zu Parametern. Danach läuft dieselbe Prüfung wie im Build.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CATEGORIES, GLOBAL_ACCOUNT, validateTemplate, scanTemplate, loadPrivateRules, autoSummary } from './lib.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const input = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const id = opt('id');
if (!input || !id) {
  console.error('Aufruf: node tools/from-decode.mjs <decode.json> --id <vorlagen-id> [--category <Kategorie>] [--out <datei>]');
  process.exit(2);
}
const category = opt('category') || 'Werkzeuge';
if (!CATEGORIES.includes(category)) { console.error(`Kategorie muss eine von ${CATEGORIES.join(', ')} sein`); process.exit(2); }

const raw = JSON.parse(fs.readFileSync(input, 'utf8'));

/* Die Decode-Ausgabe kann eingebettet sein (MCP-Antwort als Text). Format von acmp_cc_decode:
   { name, scriptId, version, clientScript: { variables, steps: [{ class, description, id, fields, children }] }, files: ["name", …] } */
const isSteps = a => Array.isArray(a) && a.every(s => s && typeof s === 'object' && 'class' in s);
function findDecoded(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.clientScript && isSteps(node.clientScript.steps)) return { ...node.clientScript, name: node.name, files: node.files, format: node.format };
  if (isSteps(node.steps)) return node;
  for (const v of Object.values(node)) {
    if (typeof v === 'string' && v.trim().startsWith('{')) { try { const r = findDecoded(JSON.parse(v)); if (r) return r; } catch { /* kein JSON */ } }
    const r = findDecoded(v); if (r) return r;
  }
  return null;
}
const dec = findDecoded(raw);
if (!dec) { console.error('Kein steps-Array mit {class, fields, children} gefunden. Ist das die Ausgabe von acmp_cc_decode?'); process.exit(1); }

const rules = loadPrivateRules();
const report = [];
const params = new Map();
let needsGlobalAccount = false;

const SECRET_KEY = /(pass(wort|word)?|kennwort|pwd|secret|token|api.?key|credential)$/i;
/* Kennwörter mitten in Skriptzeilen werden nie in die Datei geschrieben. Die Markierung lässt den Build danach bewusst scheitern. */
const INLINE_SECRETS = [
  [/((?:^|\s)[-/](?:password|passwort|kennwort|pwd|pw)[\s:=]+)(?!\{\{)[^\s"']{3,}/gi, '$1***ENTFERNT***'],
  [/(ConvertTo-SecureString\s+)(['"])[^'"]+\2(\s+-AsPlainText)/gi, "$1'***ENTFERNT***'$3"],
];
function scrubValue(val, where) {
  let out = val;
  for (const [re, rep] of INLINE_SECRETS) {
    if (re.test(out)) { out = out.replace(re, rep); report.push(`${where}: Kennwort im Text entfernt – Stelle von Hand umbauen`); }
    re.lastIndex = 0;
  }
  for (const r of rules.replace) {
    const re = new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(out)) {
      out = out.replace(re, `{{${r.param}}}`);
      if (!params.has(r.param)) params.set(r.param, { name: r.param, description: r.description || 'TODO: Beschreibung', default: '' });
      report.push(`${where}: internen Wert durch {{${r.param}}} ersetzt`);
    }
  }
  return out;
}
/* Individuelle Felder haben in jeder Installation andere IDs. Die IDs werden zu {{CF:<Feldname>:<Eigenschaft>}}
   (FieldID, TableID, FolderID, FolderParentID, Tablename, Fieldname); die Feldbeschreibung in StoredCustomFields/
   StoredTables/StoredFolders bleibt erhalten. acmp_lib_install sucht das Feld beim Installieren über den Namen. */
const CF_ID_FIELDS = { Tablename: 'Tablename', Fieldname: 'Fieldname', FieldID: 'FieldID', TableID: 'TableID' };
const customFields = new Map();
function storedWithPlaceholders(json, key, name, idProp, parentProp, where) {
  if (!json) return json;
  let o; try { o = JSON.parse(json); } catch { report.push(`${where}: ${key} ist kein JSON – unverändert`); return json; }
  for (const e of o[key] || []) {
    if (e.Id) e.Id = `{{CF:${name}:${idProp}}}`;
    if (e.ParentId) e.ParentId = `{{CF:${name}:${parentProp}}}`;
  }
  if ((o[key] || []).length > 1) report.push(`${where}: ${key} hat mehrere Einträge – nur für ein Feld je Schritt geprüft`);
  return JSON.stringify(o);
}
function scrubCustomFieldStep(fields, where) {
  const name = fields.FieldDisplayName;
  if (!name) return fields;
  const parse = (s, key) => { try { return JSON.parse(s || '{}')[key]?.[0] || {}; } catch { return {}; } };
  const cf = parse(fields.StoredCustomFields, 'StoredCustomFields');
  const tb = parse(fields.StoredTables, 'StoredTables');
  const fo = parse(fields.StoredFolders, 'StoredFolders');
  const type = { imText: 'Text', imMemo: 'Mehrzeilig', imInteger: 'Ganzzahl', imFloat: 'Kommazahl', imDate: 'Datum', imBoolean: 'Ja/Nein', imList: 'Liste' }[cf.InputMethod] || cf.InputMethod || 'Text';
  if (!customFields.has(name)) customFields.set(name, { name, type, ...(cf.MaxLength ? { maxLength: cf.MaxLength } : {}), ...(fields.TableDisplayName || tb.DisplayName ? { table: fields.TableDisplayName || tb.DisplayName } : {}), ...(fo.DisplayName ? { folder: fo.DisplayName } : {}) });
  const out = { ...fields };
  for (const [k, prop] of Object.entries(CF_ID_FIELDS)) if (out[k]) out[k] = `{{CF:${name}:${prop}}}`;
  out.StoredCustomFields = storedWithPlaceholders(fields.StoredCustomFields, 'StoredCustomFields', name, 'FieldID', 'TableID', where);
  out.StoredTables = storedWithPlaceholders(fields.StoredTables, 'StoredTables', name, 'TableID', 'FolderID', where);
  out.StoredFolders = storedWithPlaceholders(fields.StoredFolders, 'StoredFolders', name, 'FolderID', 'FolderParentID', where);
  report.push(`${where}: individuelles Feld „${name}“ → IDs werden beim Installieren aufgelöst`);
  return out;
}
const refParams = n => 'CC_' + n.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) + '_ID';

function scrubFields(fields, where, cls) {
  if (cls === 'TStoreValueOnACMPServer') fields = scrubCustomFieldStep(fields || {}, where);
  if (cls === 'TRunClientCommand' && fields?.ScriptID && !/^\{\{/.test(fields.ScriptID)) {
    const p = refParams(fields.ScriptName || 'CLIENT_COMMAND');
    params.set(p, { name: p, description: `ID des Client Commands „${fields.ScriptName || '?'}“ in eurer Installation (wird hier aufgerufen)`, default: '', required: true });
    fields = { ...fields, ScriptID: `{{${p}}}` };
    report.push(`${where}: ruft Client Command „${fields.ScriptName}“ auf → Parameter {{${p}}}`);
  }
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (SECRET_KEY.test(k)) { out[k] = ''; if (v) report.push(`${where}.${k}: Kennwort geleert`); continue; }
    if (v === '***') {
      if (/_Enabled$|^Use/i.test(k)) { out[k] = 'False'; report.push(`${where}.${k}: vom Decoder maskiert, auf False gesetzt – prüfen`); }
      else report.push(`${where}.${k}: vom Decoder maskiert, Feld weggelassen – prüfen`);
      continue;
    }
    if (/GlobalAccountId$/i.test(k) && v && !/^\{\{/.test(v)) { out[k] = `{{${GLOBAL_ACCOUNT}}}`; needsGlobalAccount = true; report.push(`${where}.${k}: globaler Account → {{${GLOBAL_ACCOUNT}}}`); continue; }
    if (/RunAs.*(User|Domain)(name)?$/i.test(k) && typeof v === 'string' && v && !/^(true|false)$/i.test(v)) {
      const p = /Domain(name)?$/i.test(k) ? 'RUNAS_DOMAIN' : 'RUNAS_USER';
      out[k] = `{{${p}}}`;
      if (!params.has(p)) params.set(p, { name: p, description: p === 'RUNAS_USER' ? 'Benutzer, unter dem der Schritt läuft (Kennwort danach in der Console eintragen)' : 'Domäne des Benutzers', default: '', required: true });
      report.push(`${where}.${k}: Konto → {{${p}}}`);
      continue;
    }
    out[k] = typeof v === 'string' ? scrubValue(v, `${where}.${k}`) : Array.isArray(v) ? v.map((x, i) => typeof x === 'string' ? scrubValue(x, `${where}.${k}[${i}]`) : x) : v;
  }
  return out;
}
const convert = (steps, p = 'steps') => steps.map((s, i) => {
  const where = `${p}[${i}]`;
  const o = { class: s.class };
  if (s.description) o.description = scrubValue(s.description, where + '.description');
  if (s.fields) o.fields = scrubFields(s.fields, where + '.fields', s.class);
  if (s.xml) { o.xml = scrubValue(s.xml, where + '.xml'); report.push(`${where}: enthält rohes XML – bitte von Hand auf Kennwörter prüfen`); }
  if (s.children?.length) o.children = convert(s.children, where + '.children');
  return o;
});

const steps = convert(dec.steps);
const variables = (dec.variables || []).map(v => ({ name: v.name, value: scrubValue(v.value ?? '', `variables.${v.name}`) }));
const tpl = {
  $schema: '../../schema/ctl-template-1.schema.json',
  schema: 'acmp-ctl/template@1',
  id,
  version: '1.0.0',
  status: 'entwurf',
  name: dec.name || 'TODO: Name',
  summary: 'TODO: Ein bis zwei Sätze, was der Command tut und wann man ihn braucht.',
  author: { name: 'TODO: Name', github: '' },
  license: 'MIT',
  updated: new Date().toISOString().slice(0, 10),
  category,
  tags: [],
  applications: [],
  acmp: { minVersion: '6.9', scriptFormat: dec.format && /12|Altformat/.test(String(dec.format)) ? 12 : 13 },
  parameters: [...params.values()],
  requires: { customFields: [...customFields.values()], globalAccount: needsGlobalAccount ? 'TODO: Welche Rechte braucht der Account?' : null, notes: [] },
  variables,
  steps,
  files: (dec.files || []).map(f => typeof f === 'string'
    ? { name: f, sha256: null, url: null }
    : { name: f.name || f.Path || f.path, sha256: (f.sha256 || '').toLowerCase() || null, url: null }),
};

const out = opt('out') || path.join(ROOT, 'templates', id, 'template.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(tpl, null, 2) + '\n');

console.log(`Vorlage geschrieben: ${path.relative(ROOT, out)}`);
report.forEach(r => console.log('  ' + r));
const v = validateTemplate(tpl, path.basename(path.dirname(out))), s = scanTemplate(tpl, rules);
const errs = [...v.errors, ...s.errors];
if (errs.length) { console.log('\nNoch zu erledigen, bevor die Vorlage durch den Build kommt:'); errs.forEach(e => console.log('  ' + e)); }
if (tpl.files.length) console.log('\nDateien: url (Download beim Hersteller) oder path (Skript im Repo) je Datei ergänzen.');
console.log('\nVorschau der Schritte:');
const show = (st, d = 0) => st.forEach(x => { console.log(`${'  '.repeat(d + 1)}${x.description || x.class}  ${autoSummary(x)}`); if (x.children) show(x.children, d + 1); });
show(steps);
