// 网易云手机验证码登录的模拟测试（真实短信无法自动化，用仿真的 weapi 服务端）：
// 覆盖 1) 发送验证码参数；2) 登录时 MUSIC_U 从 Set-Cookie 与响应体两条通道合并；
// 3) 响应体 cookie 回退；4) 凭据无效 / 验证码错误时的报错。
import './setup-host.cjs';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

let mode: 'full' | 'bodyCookie' | 'noCookie' | 'badCookie' = 'full';
let sentCount = 0;
const MUSIC_U = 'MU_TEST_0123456789abcdef';
const enc = (s: string) => new TextEncoder().encode(s);
const json = (body: string, headers: Record<string, string> = {}) => ({ ok: true, status: 200, headers, bytes: enc(body) });
const CAPTCHA = '246810';

(globalThis as any).window.ye.fetch = async (req: any) => {
    const url = String(req.url);
    if (url.startsWith('https://music.163.com/weapi/sms/captcha/sent')) {
        sentCount++;
        // 验证发送参数确实按 weapi 表单发出（有 params + encSecKey 两个加密字段）
        const form = new URLSearchParams(String(req.body));
        if (!form.get('params') || !form.get('encSecKey')) return json('{"code":-1}');
        return json(`{"code":200,"data":true}`);
    }
    if (url.startsWith('https://music.163.com/weapi/login/cellphone')) {
        if (mode === 'noCookie') return json(`{"code":200,"profile":{"userId":1,"nickname":"x"},"account":{"id":1}}`);
        if (mode === 'badCookie') return json(`{"code":400,"message":"验证码错误"}`);
        if (mode === 'bodyCookie') return json(`{"code":200,"profile":{"userId":1},"cookie":"MUSIC_U=${MUSIC_U};"}`);
        return json(`{"code":200,"profile":{"userId":1}}`, { 'set-cookie': `MUSIC_U=${MUSIC_U}; Path=/; HttpOnly` });
    }
    if (url.startsWith('https://music.163.com/weapi/w/nuser/account/get')) {
        const cookie = String(req.headers?.Cookie || '');
        if (cookie.includes(MUSIC_U)) return json(`{"code":200,"profile":{"userId":10086,"nickname":"验证码&用户","avatarUrl":"http://p3.music.126.net/a.jpg","vipType":0}}`);
        return json(`{"code":301}`); // 未登录
    }
    return { ok: false, status: 0, error: `unmocked ${url}` };
};

const { loginWyWithPhone, sendWyCaptcha } = await import('../src/store/accounts');
let failed = 0;
const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };

try {
    await sendWyCaptcha('13800138000');
    check('发送验证码：接口调用成功（走 weapi 加密）', sentCount === 1, `sent=${sentCount}`);
} catch (e: any) {
    check('发送验证码：接口调用成功（走 weapi 加密）', false, e.message);
}

try {
    const profile = await loginWyWithPhone('13800138000', CAPTCHA);
    check('登录（Set-Cookie 通道）：返回昵称（实体解码）', profile.nickname === '验证码&用户' && profile.id === '10086', `${profile.nickname}`);
    check('登录（Set-Cookie 通道）：MUSIC_U 已持久化', store.has('ye.wy.cookie') && String(store.get('ye.wy.cookie')).includes(MUSIC_U));
} catch (e: any) {
    check('登录（Set-Cookie 通道）：返回昵称（实体解码）', false, e.message);
}

store.clear();
mode = 'bodyCookie';
try {
    const profile = await loginWyWithPhone('13800138000', CAPTCHA);
    check('登录（body.cookie 回退）：MUSIC_U 从响应体拿到并登录成功', profile.id === '10086');
} catch (e: any) {
    check('登录（body.cookie 回退）：MUSIC_U 从响应体拿到并登录成功', false, e.message);
}

store.clear();
mode = 'noCookie';
{
    let msg = '';
    try { await loginWyWithPhone('13800138000', CAPTCHA); } catch (e: any) { msg = e.message; }
    check('登录（没有 MUSIC_U）：明确报错', /没有拿到登录凭据/.test(msg), msg);
}

store.clear();
mode = 'badCookie';
{
    let msg = '';
    try { await loginWyWithPhone('13800138000', '000000'); } catch (e: any) { msg = e.message; }
    check('登录（验证码错误）：错误信息透传', msg.includes('验证码错误'), msg);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
