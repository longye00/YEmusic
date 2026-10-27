// 在 Node 中模拟 Worker 环境，实测内置洛雪音源能否初始化与取链
import './setup-host.cjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { sdks } from '../src/sdk';
import { toLxMusicInfo } from '../src/player/musicInfo';
import { parseScriptMeta } from '../src/plugins/meta';
const net = require('../electron/net.cjs');
const workerCode = fs.readFileSync('/tmp/worker.js', 'utf8');
const only = process.argv[2];
const dir = process.env.SCRIPTS_DIR || 'src/plugins/presets';
const scripts = fs.readdirSync(dir).filter(f => f.endsWith('.js') && (!only || f.includes(only))).map(f => ({ name: f, script: fs.readFileSync(`${dir}/${f}`, 'utf8') }));

function makeWorker(onMessage: (m: any) => void) {
  const ctx: any = { console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Blob, Response, Headers, Request, URL, URLSearchParams, crypto: globalThis.crypto, CompressionStream, DecompressionStream, structuredClone, queueMicrotask, atob, btoa, fetch, Uint8Array, ArrayBuffer, DataView, Promise, JSON, Math, Date, Error, TypeError };
  ctx.self = ctx; ctx.globalThis = ctx;
  ctx.postMessage = (m: any) => setImmediate(() => onMessage(m));
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(workerCode, ctx);
  return { post: (m: any) => setImmediate(() => ctx.onmessage({ data: m })) };
}

(async () => {
  const tracks: Record<string, any> = {};
  for (const p of ['kw', 'kg', 'tx', 'wy', 'mg'] as const) {
    const r = await sdks[p].search('晴天 周杰伦', 1, 5).catch(() => null);
    tracks[p] = r?.list.find(t => t.singer.includes('周杰伦')) || r?.list[0];
  }
  for (const s of scripts) {
    const pending = new Map<number, (v: any) => void>();
    let initResolve: (v: any) => void = () => {};
    const inited = new Promise(r => (initResolve = r));
    const logs: string[] = [];
    const w = makeWorker(async m => {
      if (m.type === 'fetch') { const res = await net.request(m.req); w.post({ type: 'fetchResult', id: m.id, res: { ...res, bytes: res.bytes ? new Uint8Array(res.bytes) : undefined } }); }
      else if (m.type === 'init') initResolve(m);
      else if (m.type === 'result') pending.get(m.id)?.(m);
      else if (m.type === 'log') logs.push(m.text);
      else if (m.type === 'updateAlert') logs.push('ALERT ' + m.log);
    });
    w.post({ type: 'load', script: s.script, info: parseScriptMeta(s.script) });
    const init: any = await Promise.race([inited, new Promise(r => setTimeout(() => r({ ok: false, error: 'timeout' }), 20000))]);
    console.log(`\n=== ${s.name}: init ok=${init.ok} ${init.error || ''} sources=${Object.entries(init.sources || {}).map(([k, v]: any) => `${k}[${v.qualitys.join(',')}]`).join(' ')}`);
    if (!init.ok) { console.log(logs.slice(-3).join('\n')); continue; }
    let id = 0;
    await Promise.all(Object.entries(init.sources || {}).map(async ([p, cap]: any) => {
      const t = tracks[p]; if (!t) return;
      const q = cap.qualitys.includes('320k') ? '320k' : cap.qualitys[0];
      const callId = ++id;
      const res: any = await Promise.race([new Promise(r => { pending.set(callId, r); w.post({ type: 'call', id: callId, source: p, action: 'musicUrl', info: { type: q, musicInfo: toLxMusicInfo(t) } }); }), new Promise(r => setTimeout(() => r({ ok: false, error: 'call timeout' }), 25000))]);
      let probe = '';
      if (res.ok) { const pr = await net.request({ url: res.result, range: 2, timeoutMs: 8000 }); probe = `probe=${pr.status} ${pr.headers?.['content-type'] || pr.error || ''}`; }
      console.log(`  ${p} ${q}: ${res.ok ? String(res.result).slice(0, 90) : 'ERR ' + res.error} ${probe}`);
    }));
    console.log('  logs:', logs.slice(-(Number(process.env.LOGN)||2)).join(' | ').slice(0, Number(process.env.LOGW)||200));
  }
  process.exit(0);
})();
