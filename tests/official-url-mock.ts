// 平台官方取链的模拟测试（official.ts）：验证登录后走平台自己的接口，以及各类"拿不到就回落音源"的分支。
// 真实平台接口无法自动化，用仿真服务端覆盖：可用、无版权(404)、只有试听片段、会员降档、未登录、接口异常。
import './setup-host.cjs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const enc = (s: string) => new TextEncoder().encode(s);
const json = (body: string, headers: Record<string, string> = {}) => ({ ok: true, status: 200, headers, bytes: enc(body) });

// 仿真服务端：按 URL 关键字返回不同响应；mode 控制走哪条分支
let wyMode = 'ok' as 'ok' | 'copyright404' | 'trial' | 'vipLower' | 'empty';
let kgMode = 'ok' as 'ok' | 'privilege' | 'empty';
const seen: { url: string; cookie: string; body: string }[] = [];

(globalThis as any).window.ye.fetch = async (req: any) => {
    const url = String(req.url);
    const cookie = String((req.headers && req.headers.Cookie) || (req.headers && req.headers.cookie) || '');
    seen.push({ url, cookie, body: String(req.body || '') });
    if (url.includes('song/enhance/player/url')) {
        if (wyMode === 'copyright404') return json('{"code":200,"data":[{"code":404}]}');
        if (wyMode === 'trial') return json('{"code":200,"data":[{"code":200,"url":"http://m.music.126.net/x.mp3","level":"exhigh","freeTrialInfo":{"start":0,"end":30}}]}');
        if (wyMode === 'vipLower') return json('{"code":200,"data":[{"code":200,"url":"http://m.music.126.net/x.mp3","level":"exhigh"}]}');
        if (wyMode === 'empty') return json('{"code":200,"data":[]}');
        return json('{"code":200,"data":[{"code":200,"url":"http://m.music.126.net/x.mp3","level":"lossless"}]}');
    }
    if (url.includes('u.y.qq.com')) {
        if (wyMode === 'empty') return json('{"req_0":{"data":{"midurlinfo":[{"purl":""}],"sip":[]}}}');
        return json('{"req_0":{"code":0,"data":{"midurlinfo":[{"purl":"C400abc.mp3?guid=1&vkey=X"}],"sip":["https://dl.stream.qqmusic.qq.com/"]}}}');
    }
    if (url.includes('kugou.com')) {
        if (kgMode === 'privilege') return json('{"status":1,"err_code":30020,"data":null}');
        if (kgMode === 'empty') return json('{"status":1,"data":{}}');
        return json('{"status":1,"data":{"play_url":"http://trackercdn.kugou.com/x.mp3","play_backup_url":""}}');
    }
    return { ok: false, status: 0, error: `unmocked ${url}` };
};

const { setWyCookies } = await import('../src/sdk/wyAuth');
const { setTxCredential } = await import('../src/sdk/txAuth');
const { setKgCredential } = await import('../src/sdk/kgAuth');
const { officialAvailable, officialLoggedIn, officialUrl, OFFICIAL_SOURCE_ID } = await import('../src/sdk/official');

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };

const wyTrack = { id: 'wy_1', source: 'wy', songmid: '12345', name: '测试', singer: '歌手', album: '', duration: 200 } as any;
const txTrack = { id: 'tx_1', source: 'tx', songmid: 'abc', name: '测试', singer: '歌手', album: '', duration: 200, meta: { strMediaMid: 'media123' } } as any;
const kgTrack = { id: 'kg_1', source: 'kg', songmid: 'k1', name: '测试', singer: '歌手', album: '', albumId: '99', duration: 200, qualities: [{ type: 'flac', hash: 'ABCDEF' }] } as any;

// 1. 未登录：网易云仍可用（游客 320k），QQ / 酷狗不可用
setWyCookies({});
setTxCredential(null);
setKgCredential(null);
check('未登录：网易云 officialAvailable = true（游客可取链）', officialAvailable('wy'));
check('未登录：QQ officialAvailable = false', !officialAvailable('tx'));
check('未登录：酷狗 officialAvailable = false', !officialAvailable('kg'));
check('未登录：酷我 / 咪咕一律 false', !officialAvailable('kw' as any) && !officialAvailable('mg' as any));
check('officialLoggedIn：未登录全 false', !officialLoggedIn('wy') && !officialLoggedIn('tx') && !officialLoggedIn('kg'));

// 2. 网易云游客取链
{
    seen.length = 0;
    const hit = await officialUrl(wyTrack, '320k');
    check('网易云游客：取到链接', hit?.url === 'https://m.music.126.net/x.mp3', JSON.stringify(hit));
    check('网易云游客：http 自动升 https', hit?.url.startsWith('https://'));
    check('网易云游客：sourceName = 网易云官方', hit?.sourceName === '网易云官方');
    check('网易云游客：请求未带 MUSIC_U', !seen[0].cookie.includes('MUSIC_U'), seen[0].cookie);
}

// 3. 网易云登录后可用，请求带上 MUSIC_U
setWyCookies({ MUSIC_U: 'MU_TEST_VALUE', __csrf: 'c1' });
check('登录网易云：officialLoggedIn = true', officialLoggedIn('wy'));
{
    seen.length = 0;
    const hit = await officialUrl(wyTrack, 'flac');
    check('登录网易云：取到无损链接', Boolean(hit?.url));
    check('登录网易云：请求带上了 MUSIC_U', seen[0].cookie.includes('MUSIC_U=MU_TEST_VALUE'), seen[0].cookie);
    check('登录网易云：平台给 lossless → 音质 flac', hit?.quality === 'flac', String(hit?.quality));
}

// 4. 无版权 / 已下架（data.code = 404）→ null，回落音源
wyMode = 'copyright404';
check('网易云：无版权(code 404) → null（回落音源脚本）', (await officialUrl(wyTrack, 'flac')) === null);
wyMode = 'ok';

// 5. 只有试听片段（freeTrialInfo）→ null，避免播 30 秒就停
wyMode = 'trial';
check('网易云：只有试听片段 → null（不播 30 秒残片）', (await officialUrl(wyTrack, 'flac')) === null);
wyMode = 'ok';

// 6. 会员降档：请求 flac 实际给 exhigh → 仍返回，但音质标成 320k（调用方据此判断是否先用音源脚本）
wyMode = 'vipLower';
{
    const hit = await officialUrl(wyTrack, 'flac');
    check('网易云：会员降档 → 返回链接', Boolean(hit?.url));
    check('网易云：降档后音质如实标为 320k', hit?.quality === '320k', String(hit?.quality));
}
wyMode = 'ok';

// 7. data 为空数组 → null
wyMode = 'empty';
check('网易云：data 为空 → null', (await officialUrl(wyTrack, 'flac')) === null);
wyMode = 'ok';

// 8. QQ音乐：仅登录后可用
setTxCredential({ uin: '10001', musickey: 'WQ_MK_abc', loginType: 2 });
check('登录QQ：officialAvailable = true', officialAvailable('tx'));
check('登录QQ：officialLoggedIn = true', officialLoggedIn('tx'));
{
    seen.length = 0;
    const hit = await officialUrl(txTrack, 'flac');
    check('QQ音乐：拼接 sip + purl 得到完整链接', hit?.url === 'https://dl.stream.qqmusic.qq.com/C400abc.mp3?guid=1&vkey=X', JSON.stringify(hit));
    check('QQ音乐：请求带上 qm_keyst 凭据', seen[0].cookie.includes('qm_keyst=WQ_MK_abc'), seen[0].cookie);
    check('QQ音乐：sourceName = QQ音乐官方', hit?.sourceName === 'QQ音乐官方');
    check('QQ音乐：文件名用 media_mid 优先', seen[0].url.includes('media123'), seen[0].url.slice(0, 160));
}
// purl 为空 → null
wyMode = 'empty';
check('QQ音乐：purl 为空 → null', (await officialUrl(txTrack, 'flac')) === null);
wyMode = 'ok';

// 9. 酷狗：仅登录后可用
setKgCredential({ userid: '123456', token: 'TK_abc' });
check('登录酷狗：officialAvailable = true', officialAvailable('kg'));
{
    seen.length = 0;
    const hit = await officialUrl(kgTrack, 'flac');
    check('酷狗：取到 play_url', hit?.url === 'https://trackercdn.kugou.com/x.mp3', JSON.stringify(hit));
    check('酷狗：请求带上 userid / token', seen[0].cookie.includes('userid=123456') && seen[0].cookie.includes('token=TK_abc'), seen[0].cookie);
    check('酷狗：用了对应音质的 hash', seen[0].url.includes('hash=ABCDEF'), seen[0].url.slice(0, 160));
    check('酷狗：sourceName = 酷狗官方', hit?.sourceName === '酷狗官方');
}
// 无权限（err_code 30020）→ null
kgMode = 'privilege';
check('酷狗：无权限(err_code 30020) → null', (await officialUrl(kgTrack, 'flac')) === null);
kgMode = 'empty';
check('酷狗：data 为空 → null', (await officialUrl(kgTrack, 'flac')) === null);
kgMode = 'ok';

// 10. 官方通道标识（resolver 用它跳过硬断 / 降权统计）
check('OFFICIAL_SOURCE_ID = official', OFFICIAL_SOURCE_ID === 'official');

// 11. 接口抛错 → 当作"没拿到"返回 null，不向外冒泡（officialUrl 内部已 try/catch）
(globalThis as any).window.ye.fetch = async () => { throw new Error('network down'); };
check('接口抛错：officialUrl 吞掉异常返回 null', (await officialUrl(wyTrack, 'flac')) === null);

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
