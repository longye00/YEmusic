// 批量评估洛雪自定义源：每个脚本 × 平台 × 多首歌，记录取链结果、耗时与探测（仅开发用）
import './setup-host.cjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { sdks } from '../src/sdk';
import { toLxMusicInfo } from '../src/player/musicInfo';
import { parseScriptMeta } from '../src/plugins/meta';
import type { Track } from '../src/sdk/types';
const net = require('../electron/net.cjs');
const workerCode = fs.readFileSync('/tmp/worker.js', 'utf8');
const only = process.argv[2];
const dir = process.env.SCRIPTS_DIR || 'src/plugins/presets';
const QUALITY = process.env.Q || '320k';
const scripts = fs.readdirSync(dir).filter(f => f.endsWith('.js') && (!only || only.split(',').some(o => f.includes(o)))).map(f => ({ name: f, script: fs.readFileSync(`${dir}/${f}`, 'utf8') }));

function makeWorker(onMessage: (m: any) => void) {
  const ctx: any = { console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Blob, Response, Headers, Request, URL, URLSearchParams, crypto: globalThis.crypto, CompressionStream, DecompressionStream, structuredClone, queueMicrotask, atob, btoa, fetch, Uint8Array, ArrayBuffer, DataView, Promise, JSON, Math, Date, Error, TypeError };
  ctx.self = ctx; ctx.globalThis = ctx;
  ctx.postMessage = (m: any) => setImmediate(() => onMessage(m));
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(workerCode, ctx);
  return { post: (m: any) => setImmediate(() => ctx.onmessage({ data: m })), ctx };
}

const QUERIES = ['晴天 周杰伦', '海阔天空 Beyond', '起风了 买辣椒也用券'];
const TX_FALLBACK: Track = { id: 'tx_0039MnYb0qxYhV', source: 'tx', songmid: '0039MnYb0qxYhV', name: '晴天', singer: '周杰伦', album: '叶惠美', albumId: '000MkMni19ClKG', duration: 269, qualities: [{ type: '128k', size: '4.12MB' }, { type: '320k', size: '10.30MB' }, { type: 'flac', size: '30.00MB' }], meta: { songId: 97773, strMediaMid: '0039MnYb0qxYhV', albumMid: '000MkMni19ClKG' } };

async function pickTracks(): Promise<Record<string, Track[]>> {
  const out: Record<string, Track[]> = {};
  for (const p of ['kw', 'kg', 'tx', 'wy', 'mg'] as const) {
    out[p] = [];
    for (const q of QUERIES) {
      const r = await sdks[p].search(q, 1, 8).catch(() => null);
      const singer = q.split(' ')[1];
      const t = r?.list.find(x => x.singer.includes(singer) && !/live|伴奏|dj/i.test(x.name)) || r?.list[0];
      if (t) out[p].push(t);
    }
    if (p === 'tx' && !out.tx.length) {
      const b = await sdks.tx.getBoardList('26', 1).catch(() => null);
      out.tx = b?.list.slice(0, 2) || [];
      out.tx.unshift(TX_FALLBACK);
    }
  }
  return out;
}

(async () => {
  const tracks = await pickTracks();
  for (const [p, l] of Object.entries(tracks)) console.log(`# ${p}: ${l.map(t => `${t.name}-${t.singer}(${t.songmid})`).join(' / ')}`);
  const summary: any[] = [];
  for (const s of scripts) {
    const pending = new Map<number, (v: any) => void>();
    let initResolve: (v: any) => void = () => {};
    const inited = new Promise(r => (initResolve = r));
    const logs: string[] = [];
    const hosts = new Map<string, number>();
    const w = makeWorker(async m => {
      if (m.type === 'fetch') { try { const h = new URL(m.req.url).host; hosts.set(h, (hosts.get(h) || 0) + 1); } catch {} const res = await net.request(m.req); w.post({ type: 'fetchResult', id: m.id, res: { ...res, bytes: res.bytes ? new Uint8Array(res.bytes) : undefined } }); }
      else if (m.type === 'init') initResolve(m);
      else if (m.type === 'result') pending.get(m.id)?.(m);
      else if (m.type === 'log') logs.push(m.text);
      else if (m.type === 'updateAlert') logs.push('ALERT ' + m.log);
    });
    const t0 = Date.now();
    w.post({ type: 'load', script: s.script, info: parseScriptMeta(s.script) });
    const init: any = await Promise.race([inited, new Promise(r => setTimeout(() => r({ ok: false, error: 'timeout' }), 25000))]);
    const initMs = Date.now() - t0;
    console.log(`\n=== ${s.name}: init ok=${init.ok} ${init.error || ''} (${initMs}ms) sources=${Object.entries(init.sources || {}).map(([k, v]: any) => `${k}[${(v.qualitys || []).join(',')}]`).join(' ')}`);
    const row: any = { name: s.name, init: init.ok, initMs, platforms: {} };
    summary.push(row);
    if (!init.ok) { console.log(logs.slice(-3).join('\n')); continue; }
    let id = 0;
    await Promise.all(Object.entries(init.sources || {}).map(async ([p, cap]: any) => {
      const list = tracks[p]; if (!list?.length) return;
      const res2: any[] = [];
      for (const t of list) {
        const q = (cap.qualitys || []).includes(QUALITY) ? QUALITY : (cap.qualitys || [])[0] || '128k';
        const callId = ++id;
        const c0 = Date.now();
        const res: any = await Promise.race([new Promise(r => { pending.set(callId, r); w.post({ type: 'call', id: callId, source: p, action: 'musicUrl', info: { type: q, musicInfo: toLxMusicInfo(t) } }); }), new Promise(r => setTimeout(() => r({ ok: false, error: 'call timeout' }), 20000))]);
        const ms = Date.now() - c0;
        let good = false; let probe = '';
        if (res.ok && typeof res.result === 'string' && /^https?:/.test(res.result)) {
          const pr = await net.request({ url: res.result, range: 2, timeoutMs: 8000 });
          const ct = String(pr.headers?.['content-type'] || '');
          good = (pr.status === 200 || pr.status === 206) && !/html|json|text/i.test(ct);
          probe = `${pr.status} ${ct || pr.error || ''}`;
        }
        if (process.env.RETRYTEST && res.ok) {
          const id2 = ++id; const r0 = Date.now();
          const again: any = await Promise.race([new Promise(r => { pending.set(id2, r); w.post({ type: 'call', id: id2, source: p, action: 'musicUrl', info: { type: q, musicInfo: toLxMusicInfo(t), ye: { exclude: [res.result] } } }); }), new Promise(r => setTimeout(() => r({ ok: false, error: 'call timeout' }), 20000))]);
          console.log(`  ${p} RETRY ${t.name}: ${again.ok ? (again.result === res.result ? 'SAME!' : 'different') + ' ' + String(again.result).replace(/^(https?:\/\/[^/]+).*/, '$1') : 'ERR ' + again.error} ${Date.now() - r0}ms`);
        }
        res2.push({ song: t.name, ok: res.ok, good, ms, url: res.ok ? String(res.result).slice(0, 70) : '', err: res.ok ? '' : String(res.error).slice(0, 80), probe });
        console.log(`  ${p} ${q} ${t.name}: ${good ? 'OK ' : 'BAD'} ${ms}ms ${res.ok ? String(res.result).replace(/^(https?:\/\/[^/]+).*/, '$1') : 'ERR ' + String(res.error).slice(0, 80)} ${probe}`);
      }
      row.platforms[p] = res2;
    }));
    if (process.env.LOGHOSTS) console.log('  hosts:', [...hosts].map(([h, n]) => `${h}×${n}`).join(' '));
    if (process.env.SHOWLOGS) console.log(logs.filter(l => /聚合|\[星海\]|\[墨澜\]|\[长青\]|\[K×H\]/.test(l)).slice(-Number(process.env.SHOWLOGS)).join('\n'));
  }
  fs.writeFileSync(process.env.OUT || '/data/yemusic/eval/summary.json', JSON.stringify(summary, null, 1));
  console.log('\n##### SUMMARY (good/total, avg ms)');
  for (const r of summary) {
    const cells = ['kw', 'kg', 'tx', 'wy', 'mg'].map(p => { const l = r.platforms[p]; if (!l) return `${p}:-`; const g = l.filter((x: any) => x.good); return `${p}:${g.length}/${l.length}${g.length ? '@' + Math.round(g.reduce((a: number, x: any) => a + x.ms, 0) / g.length) : ''}`; });
    console.log(`${r.name.padEnd(28)} init=${r.init ? 'ok' : 'FAIL'} ${cells.join('  ')}`);
  }
  process.exit(0);
})();
