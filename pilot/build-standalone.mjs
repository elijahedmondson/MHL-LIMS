#!/usr/bin/env node
// Builds dist/MHL-LIMS-pilot-standalone.html: the whole pilot (core, rules, seed data, UI) in one file
// that runs in a browser with no server. Data is kept in that browser's localStorage.
//
//   node build-standalone.mjs
//
// The bundler is deliberately tiny: it understands the import/export forms this code base uses
// (single-line `import { a, b } from`, `import * as X from`, and `export function|const|class`).
// Modules are named after their file name, so two files may not share a name: the build checks that
// every import resolves to the file it names, and stops if not.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..');

// In dependency order is not required (modules load on first use), but the app module must come last.
const FILES = [
  path.join(lims, 'tools', 'rules-reference', 'rules.mjs'),
  ...['stats', 'defs', 'ihc', 'pathology', 'necrules', 'terminology', 'protocols', 'bloodwork', 'sheets', 'dilution', 'wsi', 'estimates', 'estimatemail', 'xenium', 'animallist', 'xlsxwrite', 'core', 'seed'].map((m) => path.join(here, 'core', `${m}.mjs`)),
  path.join(here, 'web', 'ui.js'),
  ...['lookup', 'request', 'intake', 'necropsy', 'studies', 'billing', 'labels', 'settings', 'assays', 'ihcviews', 'pathviews', 'reports',
    'protocolviews', 'terms', 'bloodviews', 'calculator', 'wsiviews', 'tracking', 'estimateviews', 'xeniumviews', 'charts', 'studyreports'].map((m) => path.join(here, 'web', 'views', `${m}.js`)),
  path.join(here, 'web', 'app.js'),
];

// What the browser's /lib/... paths point to (the same table as server.mjs).
export const LIB = {
  'rules.mjs': path.join(lims, 'tools', 'rules-reference', 'rules.mjs'),
  ...Object.fromEntries(['stats', 'defs', 'ihc', 'pathology', 'terminology', 'protocols', 'bloodwork', 'sheets', 'dilution', 'wsi', 'estimates', 'estimatemail', 'xenium', 'animallist', 'xlsxwrite'].map((m) => [`${m}.mjs`, path.join(here, 'core', `${m}.mjs`)])),
};

const nameOf = (spec) => path.basename(spec).replace(/\.(m?js)$/, '');

function moduleTable() {
  const table = {};
  for (const file of FILES) {
    const name = nameOf(file);
    if (table[name]) throw new Error(`Two modules are both called "${name}": ${table[name]} and ${file}. Rename one.`);
    table[name] = file;
  }
  return table;
}

function checkImports(table) {
  for (const file of Object.values(table)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^import .* from ['"]([^'"]+)['"];?\s*$/gm)) {
      const spec = m[1];
      if (spec.startsWith('node:')) throw new Error(`${file} imports ${spec}, which the browser cannot load.`);
      const target = /(^|\/)lib\//.test(spec) ? LIB[path.basename(spec)] : path.resolve(path.dirname(file), spec);
      if (!target) throw new Error(`${file} imports ${spec}, which is not one of the /lib modules.`);
      if (path.resolve(target) !== path.resolve(table[nameOf(spec)] || '')) {
        throw new Error(`${file} imports ${spec}, but the bundle would give it ${table[nameOf(spec)] || 'nothing'}. Add the file to FILES or rename it.`);
      }
    }
  }
}

function transform(name, src) {
  const exported = [];
  let code = src.replace(/^#!.*\n/, '');
  code = code.replace(/^import \* as (\w+) from ['"]([^'"]+)['"];?\s*$/gm, (_, id, spec) => `const ${id} = __require('${nameOf(spec)}');`);
  code = code.replace(/^import \{([^}]+)\} from ['"]([^'"]+)['"];?\s*$/gm, (_, names, spec) =>
    `const { ${names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ')} } = __require('${nameOf(spec)}');`);
  code = code.replace(/^export (async function|function|const|let|class) ([\w$]+)/gm, (_, kind, id) => { exported.push(id); return `${kind} ${id}`; });
  code = code.replace(/^export \{([^}]+)\};?\s*$/gm, (_, names) => { names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exported.push(n)); return ''; });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`Unsupported import/export syntax left in ${name}`);
  return `__define('${name}', function () {\n${code}\nreturn { ${exported.join(', ')} };\n});\n`;
}

export const LOADER = `
const __factories = {}, __cache = {};
function __define(name, factory) { __factories[name] = factory; }
function __require(name) {
  if (!(name in __cache)) {
    if (!__factories[name]) throw new Error('Missing module ' + name);
    __cache[name] = {};
    __cache[name] = __factories[name]();
  }
  return __cache[name];
}`;

// The module definitions only (no boot code). Tests evaluate this to run the bundled core.
export function bundleModules() {
  const table = moduleTable();
  checkImports(table);
  return Object.entries(table).map(([name, file]) => transform(name, readFileSync(file, 'utf8'))).join('\n');
}

export function buildHtml() {
  const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
  const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
  const boot = `
const PRICE_LIST = ${JSON.stringify(priceList)};
const IHC_CATALOG = ${JSON.stringify(ihcCatalog)};
(function boot() {
  const { createCore } = __require('core');
  const { seedState } = __require('seed');
  const pad = (n) => String(n).padStart(2, '0');
  const clock = {
    today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    now() { const d = new Date(); return clock.today() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); },
  };
  const KEY = 'mhl-lims-pilot-v1';
  let storage = null, stored = null;
  try { storage = window.localStorage; stored = storage.getItem(KEY); } catch (e) { storage = null; }
  const fresh = () => seedState({ priceList: PRICE_LIST, ihcCatalog: IHC_CATALOG, today: clock.today() });
  const state = stored ? JSON.parse(stored) : fresh();
  const save = (s) => { try { if (storage) storage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('Could not save pilot data', e); } };
  if (!stored) save(state);
  window.MHL_LOCAL = createCore({ state, priceList: PRICE_LIST, ihcCatalog: IHC_CATALOG, clock, save, reseed: fresh });
  __require('app');
})();`;
  const bundle = [LOADER, bundleModules(), boot].join('\n');
  const css = readFileSync(path.join(here, 'web', 'app.css'), 'utf8');
  let html = readFileSync(path.join(here, 'web', 'index.html'), 'utf8');
  // Function replacements: a string replacement would treat "$$" in the code as "$".
  html = html.replace('<link rel="stylesheet" href="/app.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="/app.js"></script>', () => `<script>\n"use strict";\n${bundle.replace(/<\/script/gi, () => '<\\/script')}\n</script>`)
    .replace('<title>MHL LIMS pilot</title>', () => '<title>MHL LIMS pilot (standalone)</title>');
  if (html.includes('/app.js') || html.includes('/app.css')) throw new Error('Template placeholders were not replaced');
  return html;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = buildHtml();
  mkdirSync(path.join(here, 'dist'), { recursive: true });
  const out = path.join(here, 'dist', 'MHL-LIMS-pilot-standalone.html');
  writeFileSync(out, html);
  console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
}
