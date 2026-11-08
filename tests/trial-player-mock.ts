// 试听片段的播放器联动测试：resolve 拿到的链接被引擎判成试听（trial:<秒>）后，
// 播放器登记这个「音源|歌曲」、换来源重取、从断点继续；全都只有试听时给出 TRIAL_ONLY。
// 引擎用桩代替（记录每次 load 的参数与真正播放过的链接），不依赖网络与 <audio>。
// 用法：node tests/run-test.mjs tests/trial-player-mock.ts '{"@/player/engine":"tests/stubs/engine.ts","@/sdk/official":"tests/stubs/official.ts","@/store/sources":"tests/stubs/sources.ts","@/player/lyrics":"tests/stubs/lyrics.ts"}'
import './setup-host.cjs';
import { __state as official } from './stubs/official';
import { __state as scripts } from './stubs/sources';
import { __state as eng, __emit, __reset as resetEngine } from './stubs/engine';
import type { Track } from '../src/sdk/types';

// ---- node 环境补丁：localStorage / window / document / host ----
const store = new Map<string, string>();
store.set('ye.settings.v2', JSON.stringify({ quality: '320k', qualityFallback: true, officialFirst: true, autoSwitchSource: false, skipOnError: false }));
(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window.addEventListener = () => {};
(globalThis as any).document = { title: '' };
const ye = (globalThis as any).window.ye;
ye.probeUrl = async (req: any) => ({ ok: true, status: 206, contentType: 'audio/mpeg', url: String(req.url) });
ye.proxyAudioUrl = async () => null;
ye.onMediaCommand = () => () => {};
ye.setTrayState = async () => {};

const { resolveUrl, clearUrlCache } = await import('../src/player/resolver');
const { playTrack, usePlayer } = await import('../src/store/player');
const { TRIAL_ONLY } = await import('../src/player/trial');
const { useToasts } = await import('../src/store/toast');

const OFFICIAL_URL = 'https://official/320.mp3';
const SCRIPT_URL = 'https://script/320.mp3';

const track = (id: string): Track => ({
    id: `wy_${id}`, source: 'wy', songmid: id, name: `测试歌曲 ${id}`, singer: '歌手', album: '专辑', duration: 200,
    cover: 'https://x/c.jpg',
    qualities: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }],
});

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
};

const reset = () => {
    official.calls.length = 0;
    official.hits = {};
    scripts.calls.length = 0;
    scripts.hits = {};
    official.available = true;
    resetEngine();
    clearUrlCache();
};
const officialHit = (quality: string, url: string) => { official.hits[quality] = { url, quality: quality as any, sourceName: '网易云官方' }; };

const waitFor = async (cond: () => boolean, ms = 5000): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        if (cond()) return true;
        await new Promise(r => setTimeout(r, 20));
    }
    return cond();
};

// 1. 官方链接被判试听 → 换音源脚本的完整版；官方那条从未真正播放过，expectedDuration 每次都带歌长
reset();
officialHit('320k', OFFICIAL_URL);
scripts.hits = { '320k': SCRIPT_URL };
eng.trial.add(OFFICIAL_URL);
{
    const t = track('p1');
    playTrack(t);
    const ok = await waitFor(() => usePlayer.getState().status === 'playing');
    check('官方试听 → 重试后进入播放', ok, `status=${usePlayer.getState().status} error=${usePlayer.getState().error}`);
    check('先加载官方链接（被判试听）', eng.loads[0]?.url === OFFICIAL_URL, eng.loads.map(l => l.url).join(' | '));
    check('再加载音源脚本链接', eng.loads.at(-1)?.url === SCRIPT_URL, eng.loads.map(l => l.url).join(' | '));
    check('每次 load 都带上歌曲时长 200', eng.loads.every(l => l.options.expectedDuration === 200), JSON.stringify(eng.loads.map(l => l.options.expectedDuration)));
    check('被判试听的链接从未真正播放', !eng.playedUrls.includes(OFFICIAL_URL), eng.playedUrls.join(' | '));
    check('播放器状态里的链接是完整版', usePlayer.getState().resolved?.url === SCRIPT_URL, String(usePlayer.getState().resolved?.url));
}

// 2. 同一首歌再次解析：官方已被这首歌登记成试听 → 不再调官方接口，直接用脚本链接
{
    const t = track('p1');
    official.calls.length = 0;
    const r = await resolveUrl(t);
    check('试听登记按「音源|歌曲」记住：官方不再被调用', official.calls.length === 0, JSON.stringify(official.calls));
    check('再次解析直接给完整版链接', r.url === SCRIPT_URL, `${r.sourceId} ${r.url}`);
}

// 3. 官方与脚本都被判试听 → TRIAL_ONLY，load 次数不超过试听放宽后的上限（3 + 2）
reset();
officialHit('320k', OFFICIAL_URL);
scripts.hits = { '320k': SCRIPT_URL };
eng.trial.add(OFFICIAL_URL);
eng.trial.add(SCRIPT_URL);
{
    const t = track('p2');
    playTrack(t);
    const ok = await waitFor(() => usePlayer.getState().status === 'error');
    check('所有来源都只给试听：进入错误态', ok, `status=${usePlayer.getState().status}`);
    check('错误信息是 TRIAL_ONLY', usePlayer.getState().error === TRIAL_ONLY, String(usePlayer.getState().error).slice(0, 90));
    check('提示条说明只有试听片段', useToasts.getState().toasts[0]?.message.includes('试听片段') === true, useToasts.getState().toasts[0]?.message || '');
    check('engine.load 次数 ≤ 3+2（试听放宽上限）', eng.loads.length <= 5, `loads=${eng.loads.length}`);
    check('试听链接都没有真正播放', eng.playedUrls.length === 0, eng.playedUrls.join(' | '));
}

// 4. 半路兜底：播到一半才给出真实时长 35s → 从断点换源重取（autoplay + startAt≈当前进度）
reset();
officialHit('320k', OFFICIAL_URL);
scripts.hits = { '320k': SCRIPT_URL };
{
    const t = track('p3');
    playTrack(t);
    await waitFor(() => usePlayer.getState().status === 'playing');
    check('先正常播放官方完整版', eng.loads[0]?.url === OFFICIAL_URL && eng.playedUrls.includes(OFFICIAL_URL));
    eng.currentTime = 12;
    __emit({ type: 'duration', duration: 35 });
    const ok = await waitFor(() => eng.loads.length >= 2 && usePlayer.getState().status === 'playing');
    check('半路发现试听 → 从断点换源重取', ok, `loads=${eng.loads.length} status=${usePlayer.getState().status}`);
    const retry = eng.loads[1];
    check('换到的是另一个链接（脚本）', retry?.url === SCRIPT_URL, String(retry?.url));
    check('重取是自动播放且从断点 ≈12s 继续', Boolean(retry) && retry.options.autoplay !== false && Math.abs((retry.options.startAt ?? 0) - 12) < 1.5, `autoplay=${retry?.options.autoplay} startAt=${retry?.options.startAt}`);
    check('重取也带上歌曲时长 200', retry?.options.expectedDuration === 200, String(retry?.options.expectedDuration));
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
