// 账号歌单加载的模拟测试：weapi（需要 __csrf）与明文接口（不需要）两条通道的回退关系。
// 覆盖"登录后仍看不到我的喜欢"的几个成因：__csrf 缺失、weapi 返回空列表、登录态真的失效。
import './setup-host.cjs';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
};

const enc = (s: string) => new TextEncoder().encode(s);
const UID = 10086;
const LIKED = { id: 24381616, name: '我喜欢的音乐', specialType: 5, trackCount: 1268, creator: { userId: UID }, coverImgUrl: 'http://p1.music.126.net/a.jpg' };
const OWN = { id: 111, name: '自建歌单', specialType: 0, trackCount: 9, creator: { userId: UID } };
const SUBBED = { id: 222, name: '别人的歌单', specialType: 0, trackCount: 5, subscribed: true, creator: { userId: 999 } };

let mode: 'weapi-ok' | 'weapi-empty' | 'weapi-throws' | 'expired' = 'weapi-ok';
let plainCalls = 0;
let weapiCalls = 0;
let csrfPresent = true;

(globalThis as any).window.ye.fetch = async (req: any) => {
    const url = String(req.url);
    if (url.startsWith('https://music.163.com/weapi/user/playlist')) {
        weapiCalls++;
        if (mode === 'expired') return { ok: true, status: 200, bytes: enc(JSON.stringify({ code: 301 })) };
        if (mode === 'weapi-throws') return { ok: true, status: 200, bytes: enc(JSON.stringify({ code: -447, msg: '签名校验失败' })) };
        if (mode === 'weapi-empty') return { ok: true, status: 200, bytes: enc(JSON.stringify({ code: 200, playlist: [] })) };
        return { ok: true, status: 200, bytes: enc(JSON.stringify({ code: 200, playlist: [LIKED, OWN, SUBBED] })) };
    }
    if (url.startsWith('https://music.163.com/api/user/playlist')) {
        plainCalls++;
        if (mode === 'expired') return { ok: true, status: 200, bytes: enc(JSON.stringify({ code: 301 })) };
        return { ok: true, status: 200, bytes: enc(JSON.stringify({ code: 200, playlist: [LIKED, OWN, SUBBED] })) };
    }
    return { ok: false, status: 0, error: `unmocked ${url}` };
};

const { setWyCookies } = await import('../src/sdk/wyAuth');
const { userPlaylists } = await import('../src/sdk/wyApi');

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
};
const reset = () => { plainCalls = 0; weapiCalls = 0; };

// 带完整凭据（含 __csrf）：weapi 一次成功，不必回退
setWyCookies({ MUSIC_U: 'MU_abc', __csrf: 'csrf123' }, true);
reset();
mode = 'weapi-ok';
{
    const list = await userPlaylists(UID);
    check('weapi 正常：拿到全部歌单', list.length === 3, `n=${list.length}`);
    check('weapi 正常：没有回退到明文接口', plainCalls === 0, `plain=${plainCalls}`);
    check('我喜欢的音乐：specialType=5 标记为 liked', list.find(p => p.id === String(LIKED.id))?.liked === true);
    check('我喜欢的音乐：名字原样保留', list.find(p => p.id === String(LIKED.id))?.name === '我喜欢的音乐');
    check('自建歌单：subscribed=false', list.find(p => p.id === String(OWN.id))?.subscribed === false);
    check('收藏的他人歌单：subscribed=true', list.find(p => p.id === String(SUBBED.id))?.subscribed === true);
    check('封面 http → https', String(list[0].cover).startsWith('https://'));
    check('总数 trackCount → total', list.find(p => p.id === String(LIKED.id))?.total === 1268);
}

// __csrf 缺失（手机验证码登录刚拿到的凭据常见）：weapi 签名失败 → 明文接口兜底
setWyCookies({ MUSIC_U: 'MU_abc' }, true);
reset();
mode = 'weapi-throws';
{
    const list = await userPlaylists(UID);
    check('weapi 签名失败：回退明文接口并拿到歌单', list.length === 3, `n=${list.length} plain=${plainCalls}`);
    check('weapi 签名失败：明文接口确实被调用', plainCalls === 1, `plain=${plainCalls}`);
    check('weapi 签名失败：我喜欢的音乐仍在', Boolean(list.find(p => p.liked)));
}

// weapi 返回空列表（签名能过但内容被过滤）：也要回退，不能就此认为账号没有歌单
reset();
mode = 'weapi-empty';
{
    const list = await userPlaylists(UID);
    check('weapi 返回空列表：回退明文接口', plainCalls === 1 && list.length === 3, `n=${list.length} plain=${plainCalls}`);
}

// 登录态真的失效：两条通道都说未登录 → 抛出 301，由上层提示重新登录（不能静默当成"没有歌单"）
reset();
mode = 'expired';
{
    let message = '';
    let code = 0;
    try {
        await userPlaylists(UID);
    } catch (error) {
        message = (error as Error).message;
        code = (error as { code?: number }).code || 0;
    }
    check('登录失效：抛出"需要登录"', /需要登录/.test(message), message);
    check('登录失效：错误码为 301，上层可识别并提示重新登录', code === 301, `code=${code}`);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
