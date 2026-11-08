// 试听片段测试：isTrialClip 判定表 + resolver 的「音源|歌曲」试听登记（markTrial / clearUrlCache）。
// 用桩替换"平台官方取链"和"洛雪音源脚本"，不依赖网络（esbuild alias 见文件末尾的运行命令）。
import './setup-host.cjs';
import { __state as official } from './stubs/official';
import { __state as scripts } from './stubs/sources';
import type { Track } from '../src/sdk/types';

const store = new Map<string, string>();
store.set('ye.settings.v2', JSON.stringify({ quality: '320k', qualityFallback: true, officialFirst: true, autoSwitchSource: false }));
(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window.ye.probeUrl = async (req: any) => ({ ok: true, status: 206, contentType: 'audio/mpeg', url: String(req.url) });

const { isTrialClip, TRIAL_ONLY } = await import('../src/player/trial');
const { resolveUrl, markTrial, clearUrlCache } = await import('../src/player/resolver');

const track = (id: string): Track => ({
    id: `wy_${id}`, source: 'wy', songmid: id, name: `测试歌曲 ${id}`, singer: '歌手', album: '专辑', duration: 200,
    qualities: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }],
});

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
};
const reset = () => { official.calls.length = 0; official.hits = {}; scripts.calls.length = 0; scripts.hits = {}; official.available = true; clearUrlCache(); };
const officialHit = (quality: string, url: string, actual = quality) => { official.hits[quality] = { url, quality: actual as any, sourceName: '网易云官方' }; };

// 1. isTrialClip 判定表
const table: [number, number | undefined, boolean][] = [
    [35, 240, true], [63, 100, true], [64, 95, true], [90, 200, true],
    [60, 85, false], [120, 240, false], [199, 200, false], [40, 45, false],
    [30, 0, false], [NaN, 200, false], [Infinity, 200, false],
];
for (const [actual, expected, want] of table) {
    check(`isTrialClip(${actual}, ${expected}) = ${want}`, isTrialClip(actual, expected) === want, `got ${isTrialClip(actual, expected)}`);
}

// 2. 官方结果被缓存；markTrial 后下一次解析跳过官方、直接用音源脚本，且不再调官方接口
reset();
officialHit('320k', 'https://official/320.mp3');
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const t = track('t1');
    const first = await resolveUrl(t);
    check('首次解析走官方', first.sourceId === 'official', first.url);
    markTrial('official', t);
    official.calls.length = 0;
    const r = await resolveUrl(t);
    check('试听登记后：跳过官方用音源脚本', r.sourceId === 'stub' && r.url === 'https://script/320.mp3', `${r.sourceId} ${r.url}`);
    check('试听登记后：没有再调官方接口', official.calls.length === 0, JSON.stringify(official.calls));
}

// 3. 官方与脚本都被这首歌登记成试听（autoSwitchSource 关）→ 抛出 TRIAL_ONLY
reset();
officialHit('320k', 'https://official/320.mp3');
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const t = track('t2');
    markTrial('official', t);
    markTrial('stub', t);
    let message = '';
    try { await resolveUrl(t); } catch (error) { message = (error as Error).message; }
    check('所有来源都只给试听：错误归纳为 TRIAL_ONLY', message === TRIAL_ONLY, message.slice(0, 90));
    check('没有再发起取链请求', official.calls.length === 0 && scripts.calls.length === 0, `official=${official.calls.length} scripts=${scripts.calls.length}`);
}

// 4. clearUrlCache 同时清掉试听登记 → 官方通道恢复可用
reset();
officialHit('320k', 'https://official/320.mp3');
{
    const t = track('t3');
    markTrial('official', t);
    clearUrlCache();
    const r = await resolveUrl(t);
    check('清缓存后试听登记失效：重新走官方', r.sourceId === 'official' && r.url === 'https://official/320.mp3', `${r.sourceId} ${r.url}`);
}

// 5. 只登记了一首歌的音源，不影响另一首歌
reset();
officialHit('320k', 'https://official/320.mp3');
{
    markTrial('official', track('t4'));
    const r = await resolveUrl(track('t5'));
    check('试听登记按歌曲隔离：别的歌仍走官方', r.sourceId === 'official', `${r.sourceId} ${r.url}`);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
