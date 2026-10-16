// ACMP CTL – gemeinsame Prüfungen für build.mjs und from-decode.mjs (keine Abhängigkeiten)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'ctl-template-1.schema.json'), 'utf8'));
export const CATEGORIES = SCHEMA.properties.category.enum;
const TOP_KEYS = new Set(Object.keys(SCHEMA.properties));
const STEP_KEYS = new Set(Object.keys(SCHEMA.$defs.step.properties));
const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
export const GLOBAL_ACCOUNT = 'GLOBAL_ACCOUNT_ID';

/* Schrittklassen, die in echten Commands vorkommen (Auszug aus acmp_cc_catalog). Unbekannte Klassen sind erlaubt, erzeugen aber eine Warnung. */
export const KNOWN_CLASSES = new Set(('TActionIf TActionElse TActionSwitch TActionCase TActionGroup TActionExitScript TComment TSetProjectVar ' +
  'TSetProjectVarFromRegistry TSetProjectVarFromEnvString TSetGlobalVar TModifyReg TModifyIni TDeleteRegistryValue TIfRegKeyExists ' +
  'TIfRegValueNameExists TExecuteCommand TExecuteBatchCommand TExecutePowerShell TAddSharedPrinter TControlNTService TWMIQuery ' +
  'TEnqueueShutDown TDownloadFile TUploadFile TDeleteFilesCommand TCopySingleFile TCopyFileList TCreateLink TRenameFile TRenameFolder ' +
  'TMakeDir TDeleteDir TCopyFolder TIfFileExists TIfDirectoryExists TIsSoftwareInstalledCommand TisOPSystem TIsOsArchitecture ' +
  'TShowProgressForm THideProgressForm TSetProgressFormProperties TWriteToLog TWait TGetDateTime TMessageDialog ' +
  'TIterateVariableProperties TIncVarCommand TReplaceStringCommand TMathFunctionAddition TMathFunctionDivision ' +
  'TMathFunctionMultiplication TMathFunctionRound TMathOperationFloatToDateTime TInstallMsiPackage TUninstallMSIProduct ' +
  'TUpdateWindowsCommand TInstallFontsCommand TExtractZipArchive TCreateZipArchiveCommand TSetNTFSFolderPermissions ' +
  'TEnqueueClientTask TRunClientCommand TIterateSelectedClients TSetSoftwareInstalled TStoreValueOnACMPServer TUndoScript ' +
  'TExecuteQuery TSendSMTPMail THTTPGet TPing TWakeOnLAN TLDAPSearch TDelphiScript TCutFilenameCommand TSetPasswordToLocalUser ' +
  'TCustomWindowScript TEnqueueACMPJob').split(/\s+/));

export const EXEC_CLASSES = new Set(['TExecuteCommand', 'TExecutePowerShell', 'TExecuteBatchCommand', 'TInstallMsiPackage', 'TDelphiScript', 'TRunClientCommand']);

export function flatSteps(steps, out = []) {
  for (const s of steps || []) { out.push(s); if (s.children) flatSteps(s.children, out); }
  return out;
}

/* Läuft über alle Werte eines Objekts und meldet (Pfad, Schlüssel, Wert) für jeden String */
export function walkStrings(node, visit, p = '') {
  if (typeof node === 'string') return visit(p, p.split('.').pop(), node);
  if (Array.isArray(node)) return node.forEach((v, i) => walkStrings(v, visit, `${p}[${i}]`));
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walkStrings(v, visit, p ? `${p}.${k}` : k);
}

export function loadPrivateRules() {
  const f = path.join(ROOT, 'tools', 'scan-rules.local.json');
  if (!fs.existsSync(f)) return { patterns: [], replace: [] };
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  return {
    patterns: (r.patterns || []).map(x => ({ re: new RegExp(x.regex, x.flags || 'i'), hint: x.hint || x.regex })),
    replace: r.replace || [],
  };
}

const SECRET_KEY = /(pass(wort|word)?|kennwort|pwd|secret|token|api.?key|credential)$/i;
const SECRET_VALUE = [
  [/(?:^|\s)[-/](?:password|passwort|kennwort|pwd|pw)[\s:=]+(?!\{\{)[^\s"']{3,}/i, 'Kennwort in einer Befehlszeile'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'privater Schlüssel'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS-Zugangsschlüssel'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub-Token'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack-Token'],
  [/ConvertTo-SecureString\s+(['"])[^'"]+\1\s+-AsPlainText/i, 'Kennwort im Skript (ConvertTo-SecureString)'],
];
const EXAMPLE_HOST = /(^|[.@/\\])(example\.(com|org|net|local)|example|contoso\.com|fabrikam\.com)\b/i;
const LEAKS = [
  [/\\\\(?!\{\{)(?!\?\\)(?!\.\\)[A-Za-z0-9_.$-]+\\/, 'UNC-Pfad mit festem Server. Als Parameter anlegen, z. B. {{FREIGABE}}'],
  [/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(local|lan|intern|internal|corp|home\.arpa)\b/i, 'interner DNS-Name'],
  [/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, 'private IP-Adresse'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'E-Mail-Adresse'],
];

/* Sicherheits- und Leak-Prüfung. Gibt { errors, warnings } zurück. */
export function scanTemplate(tpl, rules = loadPrivateRules()) {
  const errors = [], warnings = [];
  const scope = { ...tpl };
  delete scope.$schema; delete scope.author; delete scope.license; delete scope.schema;
  walkStrings(scope, (p, key, val) => {
    if (!val || /^(true|false|-?\d+)$/i.test(val.trim())) return;
    const isPlaceholder = /^\{\{[A-Z0-9_]+\}\}$/.test(val.trim());
    if (SECRET_KEY.test(key) && !isPlaceholder) errors.push(`${p}: Feld sieht nach Kennwort aus und ist gefüllt. Kennwörter gehören nie in eine Vorlage.`);
    if (/\*{3,}/.test(val) && SECRET_KEY.test(key)) errors.push(`${p}: maskiertes Kennwort übernommen`);
    if (/GlobalAccountId$/i.test(key) && !isPlaceholder) errors.push(`${p}: globaler Account fest eingetragen. {{${GLOBAL_ACCOUNT}}} verwenden.`);
    if (/RunAs.*(User|Domain)|^(User|Domain)name$/i.test(key) && !isPlaceholder) errors.push(`${p}: Benutzerkonto fest eingetragen. Als Parameter anlegen.`);
    for (const [re, hint] of SECRET_VALUE) if (re.test(val)) errors.push(`${p}: ${hint}`);
    for (const [re, hint] of LEAKS) {
      const m = val.match(re);
      if (m && !EXAMPLE_HOST.test(m[0])) errors.push(`${p}: ${hint} („${m[0]}“)`);
    }
    for (const r of rules.patterns) if (r.re.test(val)) errors.push(`${p}: interner Name (${r.hint})`);
    if (/TODO:/.test(val)) errors.push(`${p}: enthält noch TODO`);
  });
  return { errors, warnings };
}

/* Wie im ACMP MCP (AcmpCtl.ValidFileName): so legt die Console Dateien im Bereich private ab */
export function validFileName(n) {
  return typeof n === 'string' && n.length > 0 && n.length <= 200 && !/[\\/:*?"<>|\x00-\x1f]/.test(n) &&
    n !== '.' && n !== '..' && !/[. ]$/.test(n) && !/\.mcp-upload$/i.test(n);
}

/* "files/skript.ps1" -> ["files", "skript.ps1"]; null = kein sicherer relativer Pfad (wie AcmpCtl.SplitRelPath) */
export function splitRelPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 260) return null;
  const parts = rel.replace(/\\/g, '/').split('/');
  return parts.every(s => s && s !== '.' && s !== '..' && !/[:*?"<>|\x00-\x1f]/.test(s) && !/[. ]$/.test(s)) ? parts : null;
}

/* Strukturprüfung gegen das Schema (die Regeln, auf die es ankommt, ohne JSON-Schema-Bibliothek) */
export function validateTemplate(tpl, dirName) {
  const errors = [], warnings = [];
  const req = SCHEMA.required;
  for (const k of req) if (tpl[k] === undefined || tpl[k] === '') errors.push(`Pflichtfeld fehlt: ${k}`);
  for (const k of Object.keys(tpl)) if (!TOP_KEYS.has(k)) errors.push(`unbekanntes Feld: ${k}`);
  if (tpl.schema !== 'acmp-ctl/template@1') errors.push('schema muss "acmp-ctl/template@1" sein');
  if (!tpl.author?.name || /TODO/.test(tpl.author.name)) errors.push('author.name fehlt oder enthält noch TODO');
  if (tpl.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tpl.id)) errors.push('id: nur a-z, 0-9 und Bindestriche');
  if (dirName && tpl.id !== dirName) errors.push(`id „${tpl.id}“ passt nicht zum Ordner „${dirName}“`);
  if (tpl.version && !/^\d+\.\d+\.\d+$/.test(tpl.version)) errors.push('version: Format 1.2.3');
  if (tpl.status && !SCHEMA.properties.status.enum.includes(tpl.status)) errors.push('status: beispiel, entwurf oder geprueft');
  if (tpl.category && !CATEGORIES.includes(tpl.category)) errors.push(`category: eine von ${CATEGORIES.join(', ')}`);
  if (tpl.updated && !/^\d{4}-\d{2}-\d{2}$/.test(tpl.updated)) errors.push('updated: Format JJJJ-MM-TT');
  if (!Array.isArray(tpl.steps) || !tpl.steps.length) errors.push('steps: mindestens ein Schritt');
  const installable = tpl.status !== 'beispiel';

  const checkStep = (s, p) => {
    for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) errors.push(`${p}: unbekanntes Feld ${k}`);
    if (!/^T[A-Za-z0-9]+$/.test(s.class || '')) errors.push(`${p}: class fehlt oder ungültig`);
    else if (!KNOWN_CLASSES.has(s.class)) warnings.push(`${p}: Schrittklasse ${s.class} ist unbekannt`);
    if (installable && !s.fields && !s.xml) errors.push(`${p} (${s.class}): weder fields noch xml – so nicht installierbar`);
    (s.children || []).forEach((c, i) => checkStep(c, `${p}.children[${i}]`));
  };
  (tpl.steps || []).forEach((s, i) => checkStep(s, `steps[${i}]`));

  const declared = new Map();
  for (const prm of tpl.parameters || []) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(prm.name || '')) errors.push(`Parameter „${prm.name}“: nur A-Z, 0-9, _`);
    if (declared.has(prm.name)) errors.push(`Parameter „${prm.name}“ doppelt`);
    if (prm.name === GLOBAL_ACCOUNT) errors.push(`${GLOBAL_ACCOUNT} ist reserviert, stattdessen requires.globalAccount setzen`);
    declared.set(prm.name, 0);
  }
  walkStrings({ steps: tpl.steps, variables: tpl.variables }, (p, k, val) => {
    for (const m of val.matchAll(PLACEHOLDER)) {
      const n = m[1];
      if (n === GLOBAL_ACCOUNT) { if (!tpl.requires?.globalAccount) errors.push(`${p}: {{${n}}} benutzt, aber requires.globalAccount ist nicht gesetzt`); }
      else if (!declared.has(n)) errors.push(`${p}: Platzhalter {{${n}}} ist kein Parameter`);
      else declared.set(n, declared.get(n) + 1);
    }
  });
  for (const [n, c] of declared) if (!c) warnings.push(`Parameter ${n} wird nirgends als {{${n}}} verwendet`);
  const cfNames = new Set((tpl.requires?.customFields || []).map(c => c.name));
  walkStrings({ steps: tpl.steps }, (p, k, val) => {
    for (const m of val.matchAll(/\{\{CF:([^:}]+):([A-Za-z]+)\}\}/g)) {
      if (!cfNames.has(m[1])) errors.push(`${p}: {{CF:${m[1]}:…}} verweist auf ein Feld, das nicht in requires.customFields steht`);
      if (!['FieldID', 'TableID', 'FolderID', 'FolderParentID', 'Tablename', 'Fieldname'].includes(m[2])) errors.push(`${p}: unbekannte Eigenschaft ${m[2]} in {{CF:…}}`);
    }
  });

  /* Dateien: dieselben Regeln wie acmp_lib_install im ACMP MCP */
  const fileNames = new Set();
  for (const [i, f] of (tpl.files || []).entries()) {
    if (!validFileName(f.name)) { errors.push(`files[${i}]: Dateiname „${f.name ?? ''}“ ungültig (nur ein Dateiname ohne Pfad)`); continue; }
    const at = `files[${i}] ${f.name}`;
    if (fileNames.has(f.name.toLowerCase())) errors.push(`${at}: Dateiname doppelt`);
    fileNames.add(f.name.toLowerCase());
    if (f.url && f.path) errors.push(`${at}: entweder url oder path, nicht beides`);
    if (f.url && !/^https:\/\//i.test(f.url)) errors.push(`${at}: url muss mit https:// beginnen`);
    if (f.path && !splitRelPath(f.path)) errors.push(`${at}: path muss ein relativer Pfad im Vorlagen-Ordner sein (ohne .., ohne Laufwerk), z. B. files/skript.ps1`);
    if (f.size !== undefined && f.size !== null && !(Number.isInteger(f.size) && f.size > 0)) errors.push(`${at}: size muss eine positive Zahl sein`);
    if (installable) {
      if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) errors.push(`${at}: sha256 fehlt (64 Hex-Zeichen, klein). Ohne Prüfsumme hängt acmp_lib_install keine Datei an.`);
      if (!f.url && !f.path) errors.push(`${at}: url oder path angeben`);
    }
  }
  /* Abgleich mit den Schritten (nur Hinweise): private\<name> z. B. in „Datei herunterladen“; Variablen (%…%) werden nicht geprüft */
  const refs = new Set(), all = [];
  walkStrings({ steps: tpl.steps }, (p, k, val) => {
    all.push(val.toLowerCase());
    // ganzer Wert (Eintrag in Files_To_Download) oder Inhalt eines XML-Elements, wie AcmpCtl.PrivateRef
    for (const m of val.matchAll(/^\s*private\\([^\\/:*?"<>|\r\n]+?)\s*$|>\s*private\\([^\\/:*?"<>|\r\n]+?)\s*</gim)) refs.add((m[1] ?? m[2]).trim().toLowerCase());
  });
  for (const n of fileNames) if (!all.some(s => s.includes(`private\\${n}`))) warnings.push(`Datei ${n} wird von keinem Schritt geladen (fehlt „Datei herunterladen“ mit private\\${n}?)`);
  if (installable) for (const r of refs) if (!r.includes('%') && !fileNames.has(r)) warnings.push(`Ein Schritt lädt private\\${r}, die Vorlage bringt diese Datei aber nicht mit`);
  if (!tpl.applications?.length) warnings.push('keine applications angegeben – über die Anwendungssuche nicht auffindbar');
  return { errors, warnings };
}

/* Anzeigetext je Schritt, wenn die Vorlage keinen summary mitbringt */
const SKIP_FIELDS = new Set(['Description', '_CommandComment', 'ID', '_DataVersion', 'HasBreakpoint', 'Timeout_after', 'Enabled', 'Ignore_error',
  'isSystem', 'Command_relation', 'HighestAvailableRights', 'Execute_as', '_CaseValue', '_SwitchValue', 'Content_option', 'Content_list']);
const pick = (f, ...keys) => keys.map(k => f[k]).find(v => typeof v === 'string' && v.trim());
const lines = v => Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/\r?\n/) : [];
export function autoSummary(s) {
  if (s.summary) return s.summary;
  const f = s.fields || {};
  switch (s.class) {
    case 'TExecuteCommand': return [pick(f, 'FileName', 'Filename'), pick(f, 'Parameters')].filter(Boolean).join(' ');
    case 'TExecutePowerShell':
    case 'TExecuteBatchCommand': {
      const l = lines(f.BatchLines ?? f.Batchlines).map(x => x.trim())
        .filter(x => x && !x.startsWith('#') && !x.startsWith('::') && !/^(rem|@?echo|Write-(Host|Output)|\$\w+\s*=\s*["'])\b/i.test(x));
      return l.length ? l[0].slice(0, 140) + (l.length > 1 ? ` … (${l.length} Zeilen)` : '') : '';
    }
    case 'TSetProjectVar': return f.Variable_name ? `${f.Variable_name} = ${f.Content ?? ''}` : '';
    case 'TStoreValueOnACMPServer': return f.FieldDisplayName ? `${f.Value ?? ''} → Feld „${f.FieldDisplayName}“${f.TableDisplayName ? ` (${f.TableDisplayName})` : ''}` : '';
    case 'TIsSoftwareInstalledCommand': return f.SoftwareName ? `${f.SoftwareName} ist ${f.Software_is_installed === 'False' ? 'nicht ' : ''}installiert` : '';
    case 'TControlNTService': return [f.Service_name, f.Action, f.Startup_type && !/^Only get/.test(f.Startup_type) ? `Starttyp ${f.Startup_type}` : ''].filter(Boolean).join(', ');
    case 'TCopySingleFile': return f.Source_file ? `${f.Source_file} → ${f.Target_file ?? ''}` : '';
    case 'TRenameFolder': return f.Old_Folder_Name ? `${f.Old_Folder_Name} → ${f.New_Folder_Name ?? ''}` : '';
    case 'TDeleteDir': return f.Directory || '';
    case 'TIfDirectoryExists': return f.Directory_name ? `${f.Directory_name} ${f.Negation === 'True' ? 'existiert nicht' : 'existiert'}` : '';
    case 'TRunClientCommand': return f.ScriptName ? `„${f.ScriptName}“` : '';
    case 'TWait': return f.Duration ? `${f.Duration} s` : '';
    case 'TDownloadFile': return [].concat(f.Files_To_Download || []).join(', ') + (f.Target_Path ? ` → ${f.Target_Path}` : '');
    case 'TUpdateWindowsCommand': return f.Search_online_for_updates === 'True' ? 'online bei Microsoft suchen' : 'über ACMP';
    case 'TActionIf': return f.Value_1 !== undefined ? `${f.Value_1} ${f.Operator || '='} ${f.Value_2 ?? ''}` : '';
    default: {
      const vals = Object.entries(f).filter(([k, v]) => !SKIP_FIELDS.has(k) && typeof v === 'string' && v.trim() && v.length < 120).slice(0, 3).map(([, v]) => v);
      return vals.join('  |  ');
    }
  }
}

export function flagsFor(tpl) {
  const cls = new Set(flatSteps(tpl.steps).map(s => s.class));
  const f = [];
  if ([...cls].some(c => EXEC_CLASSES.has(c))) f.push(['warn', 'Führt Programme aus']);
  if (cls.has('TEnqueueShutDown')) f.push(['danger', 'Startet den PC neu']);
  if (cls.has('TModifyReg') || cls.has('TDeleteRegistryValue')) f.push(['info', 'Ändert die Registry']);
  if (cls.has('TMessageDialog') || cls.has('TCustomWindowScript')) f.push(['', 'Zeigt einen Dialog']);
  if (tpl.requires?.globalAccount) f.push(['', 'Globaler Account nötig']);
  if (tpl.requires?.customFields?.length) f.push(['', 'Individuelle Felder nötig']);
  if (tpl.files?.length) f.push(['', 'Dateien enthalten']);
  const n = tpl.parameters?.length || 0;
  if (n) f.push(['', n === 1 ? '1 Parameter' : `${n} Parameter`]);
  return f;
}
