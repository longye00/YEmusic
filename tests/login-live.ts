// 登录流程实测（不扫码）：验证四条扫码链路的“取二维码 + 轮询状态”能在真实接口上跑通
import './setup-host.cjs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const { txQqQrCreate, txQqQrCheck, txWxQrCreate, txWxQrCheck } = await import('../src/sdk/txAuth');
const { kgQrCreate, kgQrCheck } = await import('../src/sdk/kgAuth');
const { qrCreate, qrCheck } = await import('../src/sdk/wyApi');
const step = async (name: string, fn: () => Promise<string>) => { const t0 = Date.now(); try { console.log(`${name}: ${await fn()} (${Date.now() - t0}ms)`); } catch (e: any) { console.log(`${name}: ERROR ${e?.message}`); } };
const only = process.argv[2];
if (!only || only === 'qq') {
    let key = '';
    await step('QQ  create', async () => { const r = await txQqQrCreate(); key = r.key; return `img=${r.image.slice(0, 30)}… len=${r.image.length} key=${key.slice(0, 8)}…`; });
    if (key) await step('QQ  check ', async () => JSON.stringify(await txQqQrCheck(key)));
}
if (!only || only === 'wx') {
    let key = '';
    await step('WX  create', async () => { const r = await txWxQrCreate(); key = r.key; return `img=${r.image.slice(0, 30)}… len=${r.image.length} key=${key}`; });
    if (key) await step('WX  check ', async () => JSON.stringify(await txWxQrCheck(key)));
}
if (!only || only === 'kg') {
    let key = '';
    await step('KG  create', async () => { const r = await kgQrCreate(); key = r.key; return `img=${r.image.slice(0, 30)}… len=${r.image.length} key=${key.slice(0, 12)}…`; });
    if (key) await step('KG  check ', async () => JSON.stringify(await kgQrCheck(key)));
}
if (!only || only === 'wy') {
    let key = '';
    await step('WY  create', async () => { const r = await qrCreate(); key = r.key; return `url=${r.url}`; });
    if (key) await step('WY  check ', async () => JSON.stringify(await qrCheck(key)));
}
process.exit(0);
