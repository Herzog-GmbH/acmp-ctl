#!/usr/bin/env node
// ACMP CTL – prüft alle Vorlagen und baut site/index.json für die Webseite.
//   node tools/build.mjs              prüfen und index.json schreiben
//   node tools/build.mjs --check      nur prüfen (für Pull Requests)
//   node tools/build.mjs --download   zusätzlich Dateien mit url beim Hersteller laden und SHA-256/Größe prüfen
// Exitcode 1, sobald eine Vorlage Fehler hat.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, CATEGORIES, validateTemplate, scanTemplate, loadPrivateRules, flatSteps, autoSummary, flagsFor, splitRelPath } from './lib.mjs';
import { BEREICHE, bereicheFor, hauptbereich } from './bereiche.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const DOWNLOAD = process.argv.includes('--download');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/* Datei einer Vorlage prüfen: path im Vorlagen-Ordner (immer), url beim Hersteller (nur mit --download) */
async function checkFile(f, dir, errors, warnings) {
  if (!f.sha256) return;
  let buf;
  if (f.path) {
    const parts = splitRelPath(f.path);
    if (!parts) return;   // meldet validateTemplate
    const p = path.join(tplDir, dir, ...parts);
    if (!fs.existsSync(p)) { errors.push(`files: ${f.path} fehlt im Ordner`); return; }
    buf = fs.readFileSync(p);
  } else if (f.url && DOWNLOAD) {
    try {
      const r = await fetch(f.url, { redirect: 'follow', headers: { 'user-agent': 'acmp-ctl-build' } });
      if (!r.ok) { errors.push(`files: ${f.url} liefert HTTP ${r.status}`); return; }
      if (!r.url.startsWith('https://')) { errors.push(`files: ${f.url} leitet auf ${r.url} weiter (nur https)`); return; }
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) { errors.push(`files: ${f.url} nicht ladbar (${e.message})`); return; }
  } else return;
  const got = sha256(buf);
  if (got !== f.sha256) errors.push(`files: ${f.name}: SHA-256 weicht ab (Vorlage ${f.sha256}, Datei ${got})`);
  if (f.size && f.size !== buf.length) warnings.push(`files: ${f.name}: size ${f.size}, Datei hat ${buf.length} Byte`);
}
const rules = loadPrivateRules();
const tplDir = path.join(ROOT, 'templates');
const templates = [];
let failed = 0;

for (const dir of fs.readdirSync(tplDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  const file = path.join(tplDir, dir, 'template.json');
  let tpl;
  try { tpl = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log(`✗ ${dir}: template.json fehlt oder ist kein gültiges JSON (${e.message})`); failed++; continue; }

  const v = validateTemplate(tpl, dir);
  const s = scanTemplate(tpl, rules);
  for (const f of tpl.files || []) await checkFile(f, dir, v.errors, v.warnings);
  const areas = bereicheFor({ key: tpl.id, category: tpl.category, tags: tpl.tags, applications: tpl.applications, requires: tpl.requires });
  if (!areas.length) v.warnings.push('passt in keinen Bereich der Startseite (tools/bereiche.mjs) – Tags oder Anwendungen ergänzen');
  const errors = [...v.errors, ...s.errors], warnings = [...v.warnings, ...s.warnings];
  const mark = errors.length ? '✗' : warnings.length ? '!' : '✓';
  console.log(`${mark} ${dir}  v${tpl.version} · ${tpl.status} · ${flatSteps(tpl.steps).length} Schritte`);
  errors.forEach(e => console.log(`    Fehler:  ${e}`));
  warnings.forEach(w => console.log(`    Hinweis: ${w}`));
  if (errors.length) { failed++; continue; }

  const withSummary = steps => (steps || []).map(st => {
    const o = { ...st, summary: autoSummary(st) };
    if (st.children) o.children = withSummary(st.children);
    return o;
  });
  const { $schema, ...rest } = tpl;
  templates.push({ ...rest, steps: withSummary(tpl.steps), stepCount: flatSteps(tpl.steps).length, flags: flagsFor(tpl), areas, area: hauptbereich(areas) });
}

const community = JSON.parse(fs.readFileSync(path.join(ROOT, 'community', 'aagon-filebase.json'), 'utf8'));
for (const e of community.entries) {
  e.areas = bereicheFor({ key: 'filebase-' + e.id, category: e.category, tags: e.tags, applications: e.applications });
  e.area = hauptbereich(e.areas);
}
console.log(`\n${templates.length} Vorlagen in Ordnung, ${failed} mit Fehlern · ${community.entries.length} Community-Verweise`);
if (!rules.patterns.length) console.log('Hinweis: keine tools/scan-rules.local.json – interne Namen werden nicht geprüft.');
if (!DOWNLOAD && templates.some(t => (t.files || []).some(f => f.url))) console.log('Hinweis: Dateien mit url wurden nicht geladen – mit --download auch deren SHA-256 prüfen.');

if (failed) process.exit(1);
if (!CHECK_ONLY) {
  const areas = BEREICHE.map(({ id, name, text, icon, hue }) => ({ id, name, text, icon, hue }));
  const index = { schema: 'acmp-ctl/index@1', generated: new Date().toISOString(), categories: CATEGORIES, areas, templates, community };
  fs.writeFileSync(path.join(ROOT, 'site', 'index.json'), JSON.stringify(index));
  console.log('site/index.json geschrieben');
}
