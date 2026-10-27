// 微信 / QQ 扫码登录“换取凭据 → 校验”这一段的模拟测试（真实账号无法在自动化里扫码，所以用仿真的服务端）
// 重点复现 0.5.1 的问题：微信账号的 musicid 是 19 位整数，JSON.parse 会丢精度，校验时就变成“登录凭据无效或已过期”。
import './setup-host.cjs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const TRUE_UIN = '1152921505155643813'; // 超过 2^53，JSON.parse 后会变成 1152921505155643800
const KEY = 'W_X_0123456789abcdef';
let mode: 'full' | 'noStr' | 'profile1000' = 'full';
const log: string[] = [];

const enc = (s: string) => new TextEncoder().encode(s);
const json = (body: string, headers: Record<string, string> = {}) => ({ ok: true, status: 200, headers, bytes: enc(body) });
const cookieOf = (h: Record<string, string> | undefined) => Object.fromEntries(String(h?.Cookie || h?.cookie || '').split(/;\s*/).filter(Boolean).map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));

(globalThis as any).window.ye.fetch = async (req: any) => {
    const url = String(req.url);
    const cookie = cookieOf(req.headers);
    if (url.startsWith('https://u.y.qq.com/cgi-bin/musicu.fcg')) {
        const body = JSON.parse(String(req.body));
        const { module } = body.req;
        if (module === 'music.login.LoginServer' || module === 'QQConnectLogin.LoginServer') {
            const wx = module === 'music.login.LoginServer';
            const idPart = mode === 'noStr' ? `"musicid":${TRUE_UIN}` : `"musicid":${TRUE_UIN},"str_musicid":"${TRUE_UIN}"`;
            return json(`{"code":0,"ts":1792424464913,"req":{"code":0,"data":{"openid":"","expired_at":0,${idPart},"musickey":"${KEY}","musickeyCreateTime":1792424464,"keyExpiresIn":259200,"nick":"测试&amp;用户","logo":"http://thirdwx.qlogo.cn/x/132","encryptUin":"oK6kowEAoK4z7eCz","loginType":${wx ? 1 : 2}}}}`);
        }
        if (module === 'music.UserInfo.userInfoServer') {
            const ok = cookie.uin === TRUE_UIN && cookie.qqmusic_key === KEY;
            log.push(`GetLoginUserInfo uin=${cookie.uin} ok=${ok}`);
            return json(ok ? '{"code":0,"req":{"code":0,"data":{"nick":"x"}}}' : '{"code":0,"req":{"code":1000}}');
        }
    }
    if (url.startsWith('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg')) {
        const q = new URL(url).searchParams;
        const ok = mode !== 'profile1000' && q.get('userid') === TRUE_UIN && cookie.uin === TRUE_UIN && cookie.qqmusic_key === KEY;
        log.push(`profile userid=${q.get('userid')} ok=${ok}`);
        return json(ok ? '{"code":0,"data":{"creator":{"nick":"接口昵称","headpic":"http://q.qlogo.cn/a.jpg"}}}' : '{"code":1000,"subcode":1000,"msg":"","url":"","data":{}}');
    }
    return { ok: false, status: 0, error: `unmocked ${url}` };
};

const { txWxQrFinish, txQqQrFinish } = await import('../src/sdk/txAuth');
const { completeTxLogin } = await import('../src/store/accounts');
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };

for (const m of ['full', 'noStr'] as const) {
    mode = m;
    log.length = 0;
    const cred = await txWxQrFinish('wxcode');
    check(`[${m}] 微信：uin 保持 19 位原值`, cred.uin === TRUE_UIN, cred.uin);
    check(`[${m}] 微信：loginType = 1，昵称解码`, cred.loginType === 1 && cred.nickname === '测试&用户', `${cred.loginType} ${cred.nickname}`);
    const profile = await completeTxLogin(cred, true);
    check(`[${m}] 微信：登录成功并使用资料接口昵称`, profile.nickname === '接口昵称' && profile.id === TRUE_UIN, `${profile.nickname} ${profile.id}`);
    check(`[${m}] 微信：资料接口收到了正确的 uin`, log.some(l => l === `profile userid=${TRUE_UIN} ok=true`), log.join(' | '));
}

// 资料接口说“未登录”，但客户端接口说有效 → 仍视为有效
mode = 'profile1000';
log.length = 0;
{
    const cred = await txWxQrFinish('wxcode');
    const profile = await completeTxLogin(cred, false);
    check('复核：资料接口 1000 + 客户端接口有效 → 登录成功', profile.id === TRUE_UIN, log.join(' | '));
}

// QQ 扫码得到的凭据也走同一条路径
mode = 'full';
{
    // 直接调用 exchange 路径：txQqQrFinish 需要先走 check_sig 等步骤，这里只验证 QQ 号（短整数）不受影响
    const { parseJsonKeepBigInt } = await import('../src/sdk/txAuth');
    const o = parseJsonKeepBigInt('{"a":10001,"b":1152921505155643813,"c":[1152921505155643813,2],"nick":"x, 1234567890123456, y","ts":1792424464913}');
    check('parseJsonKeepBigInt：大整数变字符串，小整数不变', o.a === 10001 && o.b === '1152921505155643813' && o.c[0] === '1152921505155643813' && o.c[1] === 2 && o.ts === 1792424464913);
    check('parseJsonKeepBigInt：昵称里形似大整数的文字不会破坏解析', typeof o.nick === 'string');
}

// 手动粘贴的 Cookie：校验不通过必须报错
{
    mode = 'profile1000';
    let msg = '';
    try { await completeTxLogin({ uin: TRUE_UIN + '1', musickey: 'bad', loginType: 1 }, false); } catch (e: any) { msg = e.message; }
    check('Cookie 登录：凭据无效 → 报错', msg === '登录凭据无效或已过期', msg);
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
