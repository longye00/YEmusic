// 酷狗网关签名探测：用一个假令牌请求“我的歌单”，返回 20017（鉴权失败）说明请求签名 / 参数没问题，只是令牌无效。不会登录任何账号。
import './setup-host.cjs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const { setKgCredential, kgUserPlaylists } = await import('../src/sdk/kgAuth');
setKgCredential({ userid: '123456789', token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
try { const r = await kgUserPlaylists(); console.log('OK?', r.length); } catch (e: any) { console.log('ERR', e.name, e.code, e.message); }
process.exit(0);
