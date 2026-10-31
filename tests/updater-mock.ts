// 应用内更新的模拟测试：清单解析（两种来源、缺字段、坏数据）、版本比较、"有新版才提示"的判定。
import './setup-host.cjs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

let served: Record<string, string | null> = {};
let requested: string[] = [];
const enc = (s: string) => new TextEncoder().encode(s);

(globalThis as any).window.ye.version = async () => '0.5.4';
(globalThis as any).window.ye.fetch = async (req: any) => {
    const url = String(req.url);
    requested.push(url);
    const body = url in served ? served[url] : null;
    if (body === null) return { ok: false, status: 404, bytes: enc('{"error":"Not Found"}') };
    return { ok: true, status: 200, bytes: enc(body) };
};

const { compareVersions, fetchManifest, checkForUpdate } = await import('../src/lib/updater');
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };

const GH = 'https://github.com/longye00/YEmusic/releases/latest/download/update.json';
const CDN = 'https://cdn.jsdelivr.net/gh/longye00/YEmusic@main/update.json';

check('版本比较：0.5.5 > 0.5.4', compareVersions('0.5.5', '0.5.4') > 0);
check('版本比较：0.5.4 = 0.5.4', compareVersions('0.5.4', '0.5.4') === 0);
check('版本比较：0.5.3 < 0.5.4', compareVersions('0.5.3', '0.5.4') < 0);
check('版本比较：0.6.0 > 0.5.9', compareVersions('0.6.0', '0.5.9') > 0);
check('版本比较：1.0.0 > 0.99.99', compareVersions('1.0.0', '0.99.99') > 0);
check('版本比较：带 v 前缀与位数不齐（v0.5.4.1 vs 0.5.4）', compareVersions('v0.5.4.1', '0.5.4') > 0);
check('版本比较：非数字段当作 0，不抛错', compareVersions('0.5.x', '0.5.4') < 0);

served = { [GH]: JSON.stringify({ version: '0.5.5', notes: '修了三个问题', android: 'YEmusic-0.5.5-android.apk', windows: 'YEmusic-setup-0.5.5.exe' }) };
{
    requested = [];
    const m = await fetchManifest();
    check('清单（Release）：解析成功', m?.version === '0.5.5' && m.notes === '修了三个问题', JSON.stringify(m));
    check('清单（Release）：保留发布时的文件名', m?.android === 'YEmusic-0.5.5-android.apk' && m?.windows === 'YEmusic-setup-0.5.5.exe');
    check('清单（Release）：命中后不再请求兜底地址', requested.length === 1 && requested[0] === GH, requested.join(' | '));
    const update = await checkForUpdate();
    check('检查更新：0.5.5 > 本机 0.5.4 → 返回清单', update?.version === '0.5.5');
}

served = { [GH]: null, [CDN]: JSON.stringify({ version: '0.5.6', notes: '', android: 'a.apk', windows: 'w.exe' }) };
{
    requested = [];
    const m = await fetchManifest();
    check('清单（兜底）：Release 404 时从 jsDelivr 拿到', m?.version === '0.5.6');
    check('清单（兜底）：两个来源都试过', requested.length === 2 && requested[0] === GH && requested[1] === CDN, requested.join(' | '));
}

served = { [GH]: JSON.stringify({ version: '0.6.0' }) };
{
    const m = await fetchManifest();
    check('清单（缺字段）：android / windows 文件名按版本号补全', m?.android === 'YEmusic-0.6.0-android.apk' && m?.windows === 'YEmusic-setup-0.6.0.exe', JSON.stringify(m));
    check('清单（缺字段）：notes 缺失时为空串而不是 undefined', m?.notes === '');
}

for (const [name, body] of [
    ['没有 version 字段', JSON.stringify({ notes: 'x' })],
    ['version 不是版本号', JSON.stringify({ version: 'latest' })],
    ['version 是数字不是字符串', JSON.stringify({ version: 5.5 })],
    ['不是 JSON', '<html>404</html>'],
    ['空对象', '{}'],
] as const) {
    served = { [GH]: body, [CDN]: body };
    const m = await fetchManifest();
    check(`清单（坏数据）：${name} → null`, m === null, JSON.stringify(m));
}

served = {};
check('清单（离线）：两个来源都失败 → null', (await fetchManifest()) === null);
check('检查更新（离线）：返回 null，不打扰用户', (await checkForUpdate()) === null);

served = { [GH]: JSON.stringify({ version: '0.5.4', notes: 'same' }) };
check('检查更新：清单版本 = 本机版本 → null', (await checkForUpdate()) === null);
served = { [GH]: JSON.stringify({ version: '0.5.0', notes: 'older' }) };
check('检查更新：清单版本比本机旧 → null', (await checkForUpdate()) === null);

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
