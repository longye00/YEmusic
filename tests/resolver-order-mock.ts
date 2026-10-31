// 解析顺序测试：官方通道优先、拿不到时回退音源脚本、降档链接作兜底、开关与 onlySource 的行为。
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
// 探测：一律判定为可播放的音频（resolver 里 probeUrl 走 host.probeUrl）
(globalThis as any).window.ye.probeUrl = async (req: any) => ({ ok: true, status: 206, contentType: 'audio/mpeg', url: String(req.url) });

const { resolveUrl } = await import('../src/player/resolver');
const { useSettings } = await import('../src/store/settings');

const track = (id: string): Track => ({
    id: `wy_${id}`, source: 'wy', songmid: id, name: `测试歌曲 ${id}`, singer: '歌手', album: '专辑', duration: 200,
    qualities: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }],
});

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
};
const reset = () => { official.calls.length = 0; official.hits = {}; scripts.calls.length = 0; scripts.hits = {}; official.available = true; };
const officialHit = (quality: string, url: string, actual = quality) => { official.hits[quality] = { url, quality: actual as any, sourceName: '网易云官方' }; };

// 1. 官方给到请求档位 → 用官方，完全不碰音源脚本
reset();
officialHit('320k', 'https://official/320.mp3');
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const r = await resolveUrl(track('a1'));
    check('官方命中请求档位：采用官方链接', r.sourceId === 'official' && r.url === 'https://official/320.mp3', `${r.sourceName} ${r.url}`);
    check('官方命中请求档位：没有调用音源脚本', scripts.calls.length === 0, JSON.stringify(scripts.calls));
    check('官方命中请求档位：官方接口只请求一次', official.calls.length === 1, JSON.stringify(official.calls));
}

// 2. 官方拿不到 → 回退到音源脚本
reset();
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const r = await resolveUrl(track('a2'));
    check('官方拿不到：回退音源脚本', r.sourceId === 'stub' && r.url === 'https://script/320.mp3', `${r.sourceId} ${r.url}`);
    check('官方拿不到：官方接口被尝试过', official.calls.length >= 1, JSON.stringify(official.calls));
}

// 3. 官方降档（请求 320k 只给 128k）+ 音源也失败 → 用降档的官方链接兜底
reset();
officialHit('320k', 'https://official/downgrade.mp3', '128k');
{
    const r = await resolveUrl(track('a3'));
    check('官方降档 + 音源失败：用降档的官方链接兜底', r.url === 'https://official/downgrade.mp3', `${r.sourceId} ${r.url}`);
    check('官方降档：仍先让音源脚本试足档音质', scripts.calls.length >= 1, JSON.stringify(scripts.calls));
}

// 4. 官方降档但音源能给足档 → 用音源（音质更高）
reset();
officialHit('320k', 'https://official/downgrade.mp3', '128k');
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const r = await resolveUrl(track('a4'));
    check('官方降档但音源有足档：用音源链接', r.url === 'https://script/320.mp3', `${r.sourceId} ${r.url}`);
}

// 5. 官方给到更高档（请求 320k 给无损）→ 直接采用，不再等音源
reset();
officialHit('320k', 'https://official/flac.mp3', 'flac');
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const r = await resolveUrl(track('a5'));
    check('官方给到更高档（会员音质）：直接采用', r.url === 'https://official/flac.mp3' && r.quality === 'flac', `${r.quality} ${r.url}`);
}

// 6. 官方不可用（该平台没有账号 / 没有账号体系）→ 直接走音源，不浪费一次请求
reset();
official.available = false;
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const r = await resolveUrl(track('a6'));
    check('官方不可用：不调用官方接口', official.calls.length === 0, JSON.stringify(official.calls));
    check('官方不可用：走音源脚本', r.sourceId === 'stub');
}

// 7. 关掉"官方优先"开关 → 完全不调官方接口
reset();
officialHit('320k', 'https://official/320.mp3');
scripts.hits = { '320k': 'https://script/320.mp3' };
useSettings.setState({ officialFirst: false });
{
    const r = await resolveUrl(track('a7'));
    check('关闭官方优先：不调用官方接口', official.calls.length === 0, JSON.stringify(official.calls));
    check('关闭官方优先：走音源脚本', r.sourceId === 'stub');
}
useSettings.setState({ officialFirst: true });

// 8. onlySource（用户指定只用某个音源）时跳过官方通道
reset();
officialHit('320k', 'https://official/320.mp3');
scripts.hits = { '320k': 'https://script/320.mp3' };
{
    const r = await resolveUrl(track('a8'), { onlySource: 'stub' });
    check('指定音源时：不调用官方接口', official.calls.length === 0, JSON.stringify(official.calls));
    check('指定音源时：用该音源', r.sourceId === 'stub');
}

// 9. 两条路都拿不到 → 抛出汇总错误（不是静默失败）
reset();
{
    let message = '';
    try { await resolveUrl(track('a9')); } catch (error) { message = (error as Error).message; }
    check('官方与音源都失败：抛出中文错误', message.length > 0 && !/undefined/.test(message), message.slice(0, 90));
}

// 10. 没有任何音源脚本，但官方通道可用 → 仍能播放（不再提示"没有启用的音源"）
reset();
officialHit('320k', 'https://official/320.mp3');
{
    const r = await resolveUrl(track('b1'));
    check('官方通道可用时不要求装音源', r.sourceId === 'official');
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
