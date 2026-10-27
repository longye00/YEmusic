// Generates the trimmed zh-CN / en dictionaries in src/folia/i18n (only the keys referenced by the vendored Folia files).
// 用法：FOLIA_SRC=<folia-major 源码目录> node scripts/gen-folia-locales.mjs   （见 src/folia/VENDOR.md）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const FOLIA = process.env.FOLIA_SRC || path.resolve(here, '../../folia-major');
const SRC = path.join(FOLIA, 'src/i18n/locales');
const VENDORED = process.argv[2] ?? path.resolve(here, '../src/folia');
const OUT = path.join(VENDORED, 'i18n');

const load = file => {
  const code = transformSync(fs.readFileSync(path.join(SRC, file), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports.default;
};
const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, p, out); else out[p] = String(v);
  }
  return out;
};
const zh = flatten(load('zh-CN.ts'));
const en = flatten(load('en.ts'));
const allKeys = new Set([...Object.keys(zh), ...Object.keys(en)]);
console.log('zh keys', Object.keys(zh).length, 'en keys', Object.keys(en).length);

// collect string literals from vendored sources
const files = [];
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
walk(VENDORED);
const literalRe = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const used = new Set();
const prefixes = new Set();
const stripPlural = k => k.replace(/_(zero|one|two|few|many|other)$/, '');
const byBase = {};
for (const k of allKeys) (byBase[stripPlural(k)] ||= []).push(k);
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) {
    if (byBase[m[1]]) byBase[m[1]].forEach(k => used.add(k));
  }
  for (const m of text.matchAll(literalRe)) {
    const lit = m[2];
    if (!lit || lit.length > 160) continue;
    if (byBase[lit]) byBase[lit].forEach(k => used.add(k));
    if (/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)*\.$/.test(lit)) prefixes.add(lit);
    const tpl = lit.match(/^([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+\.)\$\{/);
    if (m[1] === '`' && tpl) prefixes.add(tpl[1]);
  }
}
for (const p of prefixes) for (const k of allKeys) if (k.startsWith(p)) used.add(k);
console.log('used keys', used.size, 'prefixes', [...prefixes].join(' '));

const nest = (flat) => {
  const root = {};
  for (const k of Object.keys(flat).sort()) {
    const parts = k.split('.');
    let cur = root;
    parts.slice(0, -1).forEach(p => { cur = (cur[p] && typeof cur[p] === 'object') ? cur[p] : (cur[p] = {}); });
    cur[parts[parts.length - 1]] = flat[k];
  }
  return root;
};
const pick = (flat) => Object.fromEntries(Object.entries(flat).filter(([k]) => used.has(k)));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'zh-CN.json'), JSON.stringify(nest(pick(zh)), null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'en.json'), JSON.stringify(nest(pick(en)), null, 2) + '\n');
const noZh = [...used].filter(k => !(k in zh));
console.log('used keys missing in zh:', noZh.length, noZh.slice(0, 10));
