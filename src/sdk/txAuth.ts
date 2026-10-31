/**
 * QQ 音乐账号（可选）：QQ / 微信扫码登录，登录后乐库显示你创建 / 收藏的歌单与收藏的专辑。
 * 凭据（musicid + musickey）只保存在本机 localStorage，仅随请求发送给 y.qq.com。
 * 登录流程按 QQ 音乐网页版的公开行为独立实现：QQ 扫码走 ptlogin2 → graph.qq.com 授权码 → QQ 音乐登录；
 * 微信扫码走 open.weixin.qq.com 的网站应用授权码 → QQ 音乐登录。
 */
import { base64Encode, utf8Decode } from '@/lib/bytes';
import { cookieHeader, loadJson, parseCookiePairs, parseSetCookie, saveJson, type CookieJar } from '@/lib/cookie';
import { host, type HostResponse } from '@/lib/host';
import { encodeForm, requestJson, requestText } from '@/lib/http';
import { decodeEntities } from '@/lib/util';
import type { OnlinePlaylist } from './types';

const KEY = 'ye.tx.credential';
const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_APPID = '716027609';
const QQ_3RD_AID = '100497308';
const WX_APPID = 'wx48db31d50e334801';

export interface TxCredential {
    /** QQ 号或微信登录对应的 musicid */
    uin: string;
    musickey: string;
    /** 2 = QQ 登录，1 = 微信登录 */
    loginType: 1 | 2;
    nickname?: string;
    avatarUrl?: string;
}

let credential: TxCredential | null = (() => {
    const value = loadJson<TxCredential>(KEY);
    return value.uin && value.musickey ? (value as TxCredential) : null;
})();

export const getTxCredential = () => credential;
/** 没有昵称时的显示名：微信账号的 ID 是一长串数字，不适合直接展示 */
export const txFallbackName = (cred: Pick<TxCredential, 'uin' | 'loginType'>) => (cred.loginType === 1 ? '微信用户' : `QQ ${cred.uin}`);
export const hasTxLogin = () => Boolean(credential);

export function setTxCredential(next: TxCredential | null) {
    credential = next;
    saveJson(KEY, next);
}

/** 登录态对应的 Cookie（y.qq.com 网页版自己写入的那几项） */
const credentialJar = ({ uin, musickey, loginType }: TxCredential): CookieJar => ({
    uin,
    qqmusic_uin: uin,
    qqmusic_key: musickey,
    qm_keyst: musickey,
    tmeLoginType: String(loginType),
    ...(loginType === 1 ? { wxuin: uin } : {}),
});

/** 随 y.qq.com 请求发送的 Cookie（未登录时为空） */
export function txCookie(): string {
    return credential ? cookieHeader(credentialJar(credential)) : '';
}

export const txHeaders = (referer = 'https://y.qq.com/'): Record<string, string> => {
    const cookie = txCookie();
    return { Referer: referer, ...(cookie ? { Cookie: cookie } : {}) };
};

/** ptlogin 的 hash33：ptqrtoken 由 qrsig 算出，g_tk 由 p_skey / musickey 算出 */
export function hash33(text: string, seed = 0) {
    let h = seed;
    for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) % 2147483648;
    return h;
}
const gtk = (key: string) => hash33(key, 5381);
const uuid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b, i) => (i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b).toString(16).padStart(2, '0'))
    .join('')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

const text = (res: HostResponse) => (res.bytes ? utf8Decode(res.bytes) : '');
async function fetchRaw(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; follow?: boolean; timeout?: number } = {}) {
    const res = await host.fetch({ url, method: init.method || 'GET', headers: init.headers, body: init.body, timeoutMs: init.timeout ?? 15000, followRedirects: init.follow ?? true });
    if (!res.status) throw new Error(res.error || '网络请求失败');
    return res;
}

export class TxLoginError extends Error {}

// ---------------- 登录：QQ 扫码 ----------------
export interface QrImage { image: string; key: string }

export async function txQqQrCreate(): Promise<QrImage> {
    const url = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${QQ_APPID}&e=2&l=M&s=3&d=72&v=4&t=${Math.random()}&daid=383&pt_3rd_aid=${QQ_3RD_AID}`;
    const res = await fetchRaw(url, { headers: { Referer: 'https://xui.ptlogin2.qq.com/' } });
    const qrsig = parseSetCookie(res.headers?.['set-cookie']).qrsig;
    if (!res.ok || !res.bytes?.length || !qrsig) throw new TxLoginError('获取 QQ 登录二维码失败');
    return { image: `data:image/png;base64,${base64Encode(res.bytes)}`, key: qrsig };
}

export type QqQrState = { code: 'waiting' | 'scanned' | 'expired' | 'refused' } | { code: 'error'; message: string } | { code: 'done'; url: string; jar: CookieJar; nickname?: string };

export async function txQqQrCheck(qrsig: string): Promise<QqQrState> {
    const url = `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${encodeURIComponent('https://graph.qq.com/oauth2.0/login_jump')}&ptqrtoken=${hash33(qrsig)}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=20102616&js_type=1&pt_uistyle=40&aid=${QQ_APPID}&daid=383&pt_3rd_aid=${QQ_3RD_AID}&has_onekey=1`;
    const res = await fetchRaw(url, { headers: { Referer: 'https://xui.ptlogin2.qq.com/', Cookie: `qrsig=${qrsig}` } });
    const match = /ptuiCB\((.*)\)/.exec(text(res));
    if (!match) throw new TxLoginError('QQ 登录状态解析失败');
    const fields = [...match[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
    switch (fields[0]) {
        case '66': return { code: 'waiting' };
        case '67': return { code: 'scanned' };
        case '65': return { code: 'expired' };
        case '68': return { code: 'refused' };
        case '0': return { code: 'done', url: fields[2], jar: parseSetCookie(res.headers?.['set-cookie']), nickname: fields[5] };
        default: return { code: 'error', message: fields[4] || `QQ 登录失败（${fields[0]}）` };
    }
}

/** 扫码确认后：check_sig 拿 p_skey → graph.qq.com 授权码 → QQ 音乐登录 */
export async function txQqQrFinish(checkUrl: string, jar: CookieJar): Promise<TxCredential> {
    const sig = await fetchRaw(checkUrl, { follow: false, headers: { Referer: 'https://xui.ptlogin2.qq.com/' } });
    for (const [name, value] of Object.entries(parseSetCookie(sig.headers?.['set-cookie']))) if (value !== '' || !jar[name]) jar[name] = value;
    const pskey = jar.p_skey;
    if (!pskey) throw new TxLoginError('没有拿到 QQ 授权凭据（p_skey），请重试');
    const form = {
        response_type: 'code',
        client_id: QQ_3RD_AID,
        redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
        scope: 'get_user_info,get_app_friends',
        state: 'state',
        switch: '',
        from_ptlogin: 1,
        src: 1,
        update_auth: 1,
        openapi: '1010_1030',
        g_tk: gtk(pskey),
        auth_time: Date.now(),
        ui: uuid().toUpperCase(),
    };
    const auth = await fetchRaw('https://graph.qq.com/oauth2.0/authorize', {
        method: 'POST',
        follow: false,
        body: encodeForm(form),
        headers: { 'content-type': 'application/x-www-form-urlencoded', Referer: 'https://graph.qq.com/', Cookie: cookieHeader(jar) },
    });
    const location = auth.headers?.location || '';
    const code = /[?&]code=([^&]+)/.exec(location)?.[1];
    if (!code) throw new TxLoginError('QQ 授权失败，请重新扫码');
    return exchange({ module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } }, 2);
}

// ---------------- 登录：微信扫码 ----------------
const WX_CONNECT = `https://open.weixin.qq.com/connect/qrconnect?appid=${WX_APPID}&redirect_uri=${encodeURIComponent('https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/')}&response_type=code&scope=snsapi_login&state=STATE&href=${encodeURIComponent('https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect')}`;

export async function txWxQrCreate(): Promise<QrImage> {
    const page = await fetchRaw(WX_CONNECT);
    const uuid = /\/connect\/qrcode\/([\w-]+)/.exec(text(page))?.[1];
    if (!uuid) throw new TxLoginError('获取微信登录二维码失败');
    const img = await fetchRaw(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, { headers: { Referer: WX_CONNECT } });
    if (!img.ok || !img.bytes?.length) throw new TxLoginError('获取微信登录二维码失败');
    const type = img.headers?.['content-type']?.split(';')[0] || 'image/jpeg';
    return { image: `data:${type};base64,${base64Encode(img.bytes)}`, key: uuid };
}

export type WxQrState = { code: 'waiting' | 'scanned' | 'expired' | 'refused' } | { code: 'done'; wxCode: string };

/** 长轮询：没有变化时服务器约 25 秒后返回 408 */
export async function txWxQrCheck(uuid: string, last?: number): Promise<WxQrState> {
    const res = await fetchRaw(`https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${uuid}${last ? `&last=${last}` : ''}&_=${Date.now()}`, { headers: { Referer: WX_CONNECT }, timeout: 40000 });
    const body = text(res);
    const errcode = Number(/wx_errcode=(\d+)/.exec(body)?.[1] || 0);
    const wxCode = /wx_code='([^']*)'/.exec(body)?.[1] || '';
    if (errcode === 405 && wxCode) return { code: 'done', wxCode };
    if (errcode === 404) return { code: 'scanned' };
    if (errcode === 403) return { code: 'refused' };
    if (errcode === 402) return { code: 'expired' };
    return { code: 'waiting' };
}

export const txWxQrFinish = (wxCode: string) => exchange({ module: 'music.login.LoginServer', method: 'Login', param: { code: wxCode, strAppid: WX_APPID } }, 1);

/**
 * 微信登录得到的 musicid 是 19 位整数（约 1.15e18），超出 JS 的安全整数范围（约 9e15）：
 * 直接 JSON.parse 会把末几位四舍五入，拿着错误的 uin 去校验，QQ 音乐就会回“未登录”。
 * 所以解析前先把 15 位以上的整数改写成字符串（凭据里也优先用接口给的 str_musicid）。
 */
export function parseJsonKeepBigInt(text: string) {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"') {
            // 字符串原样保留（含转义），避免误改昵称里的数字
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j + 1;
        } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
            let j = i + 1;
            while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
            const token = text.slice(i, j);
            out += /^-?\d{15,}$/.test(token) ? `"${token}"` : token;
            i = j;
        } else {
            out += ch;
            i++;
        }
    }
    try {
        return JSON.parse(out);
    } catch {
        return JSON.parse(text);
    }
}

async function exchange(req: { module: string; method: string; param: Record<string, unknown> }, loginType: 1 | 2): Promise<TxCredential> {
    const raw = await requestText(MUSICU, {
        method: 'POST',
        json: { comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0, tmeLoginType: String(loginType) }, req },
        headers: { Referer: 'https://y.qq.com/' },
        retries: 0,
    });
    let body: any;
    try {
        body = parseJsonKeepBigInt(raw);
    } catch {
        throw new TxLoginError('QQ 音乐返回了无法识别的数据，请稍后重试');
    }
    const data = body?.req?.data;
    if (Number(body?.req?.code) !== 0 || !data?.musickey) throw new TxLoginError(`QQ 音乐登录失败（${body?.req?.code ?? body?.code ?? '未知错误'}），请重新扫码`);
    const uin = String(data.str_musicid || data.musicid || '');
    if (!/^\d+$/.test(uin) || /^0+$/.test(uin)) throw new TxLoginError('QQ 音乐没有返回账号 ID，请重新扫码');
    return {
        uin,
        musickey: String(data.musickey),
        loginType: Number(data.loginType) === 1 || Number(data.loginType) === 2 ? (Number(data.loginType) as 1 | 2) : loginType,
        nickname: data.nick ? decodeEntities(data.nick) : undefined,
        avatarUrl: data.logo ? String(data.logo).replace(/^http:/, 'https:') : undefined,
    };
}

/** Cookie 登录：粘贴 y.qq.com 的 Cookie（需要 uin 与 qqmusic_key / qm_keyst） */
export function parseTxCookie(input: string): TxCredential | null {
    const jar = parseCookiePairs(input);
    const uin = String(jar.uin || jar.wxuin || jar.p_uin || '').replace(/^o0*/, '');
    const musickey = jar.qqmusic_key || jar.qm_keyst;
    if (!uin || !musickey) return null;
    return { uin, musickey, loginType: jar.tmeLoginType === '1' || /^W_X/.test(musickey) ? 1 : 2 };
}

// ---------------- 账号资料与歌单 ----------------
export interface TxProfile { uin: string; nickname: string; avatarUrl?: string }

const https = (url: unknown) => (url ? String(url).replace(/^http:/, 'https:') : undefined);

/** 复核登录态：QQ 音乐客户端自己用的“当前登录用户”接口。true = 有效，false = 失效，null = 无法判断 */
async function txLoginAlive(cred: TxCredential): Promise<boolean | null> {
    try {
        const body = await requestJson(MUSICU, {
            method: 'POST',
            json: {
                comm: { g_tk: gtk(cred.musickey), platform: 'yqq', ct: 24, cv: 0, uin: cred.uin, authst: cred.musickey, tmeLoginType: String(cred.loginType) },
                req: { module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} },
            },
            headers: { Referer: 'https://y.qq.com/', Cookie: cookieHeader(credentialJar(cred)) },
            retries: 0,
        });
        const code = Number(body?.req?.code);
        if (code === 0) return true;
        return [1000, 104400, 104401].includes(code) ? false : null;
    } catch {
        return null;
    }
}

/** 校验凭据并取资料；确认凭据失效时返回 null（资料接口说“未登录”时，还会用客户端接口复核一次，避免误判） */
export async function txFetchProfile(cred: TxCredential): Promise<TxProfile | null> {
    const headers = { Referer: 'https://y.qq.com/portal/profile.html', Cookie: cookieHeader(credentialJar(cred)) };
    const body = await requestJson(
        `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&cid=205360838&reqfrom=1&reqtype=0&userid=${cred.uin}&loginUin=${cred.uin}&hostUin=0&g_tk=${gtk(cred.musickey)}`,
        { headers, retries: 0 },
    );
    if (Number(body?.code) !== 0) {
        if (Number(body?.code) === 1000) {
            if ((await txLoginAlive(cred)) === true) return { uin: cred.uin, nickname: cred.nickname || txFallbackName(cred), avatarUrl: cred.avatarUrl };
            return null;
        }
        throw new Error(body?.msg || `QQ 音乐账号校验失败（${body?.code}）`);
    }
    const creator = body?.data?.creator || {};
    return {
        uin: cred.uin,
        nickname: decodeEntities(creator.nick || cred.nickname || txFallbackName(cred)),
        avatarUrl: https(creator.headpic) || cred.avatarUrl,
    };
}

export interface TxUserPlaylist extends OnlinePlaylist { liked?: boolean; subscribed?: boolean }

/** 我创建的歌单（含“我喜欢”）+ 我收藏的歌单 */
export async function txUserPlaylists(uin: string): Promise<TxUserPlaylist[]> {
    const headers = txHeaders('https://y.qq.com/portal/profile.html');
    // g_tk 必须由 musickey 算出（hash33(key, 5381)）；写死成 5381 只在游客态下碰巧能用，
    // 登录后服务端会校验它，错了就返回 code 1000（未登录），账号歌单一个也出不来。
    const cred = getTxCredential();
    const token = gtk(cred?.musickey || '');
    const [created, collected] = await Promise.all([
        requestJson(`https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${uin}&sin=0&size=200&g_tk=${token}&loginUin=${uin}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`, { headers }),
        requestJson(`https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?ct=20&cid=205360956&userid=${uin}&reqtype=3&sin=0&ein=199&format=json&inCharset=utf8&outCharset=utf-8&loginUin=${uin}&g_tk=${token}`, { headers }).catch(() => null),
    ]);
    if (Number(created?.code) !== 0 && !created?.data) throw new Error(created?.msg || `QQ 音乐歌单加载失败（${created?.code}）`);
    const out: TxUserPlaylist[] = [];
    for (const item of created?.data?.disslist || []) {
        if (!item?.tid) continue;
        const liked = Number(item.dirid) === 201;
        out.push({
            id: String(item.tid),
            source: 'tx',
            name: liked ? '我喜欢' : decodeEntities(item.diss_name),
            cover: https(item.diss_cover),
            total: Number(item.song_cnt) || 0,
            playCount: Number(item.listen_num) || 0,
            author: created?.data?.hostname,
            liked,
        });
    }
    for (const item of collected?.data?.cdlist || []) {
        if (!item?.dissid) continue;
        out.push({
            id: String(item.dissid),
            source: 'tx',
            name: decodeEntities(item.dissname),
            cover: https(item.logo),
            total: Number(item.songnum) || 0,
            playCount: Number(item.listennum) || 0,
            author: decodeEntities(item.nickname || ''),
            subscribed: true,
        });
    }
    return out;
}

export interface TxAlbum { mid: string; name: string; artist: string; cover?: string; size?: number; publishTime?: string }

export async function txUserAlbums(uin: string): Promise<TxAlbum[]> {
    const body = await requestJson(
        `https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?ct=20&cid=205360956&userid=${uin}&reqtype=2&sin=0&ein=199&format=json&inCharset=utf8&outCharset=utf-8&loginUin=${uin}`,
        { headers: txHeaders('https://y.qq.com/portal/profile.html') },
    );
    if (Number(body?.code) !== 0) throw new Error(body?.msg || `QQ 音乐收藏专辑加载失败（${body?.code}）`);
    return (body?.data?.albumlist || []).filter((a: any) => a?.albummid).map((a: any): TxAlbum => ({
        mid: String(a.albummid),
        name: decodeEntities(a.albumname),
        artist: decodeEntities(a.singername || ''),
        cover: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${a.albummid}.jpg`,
        size: Number(a.songnum) || undefined,
        publishTime: a.pubtime ? String(a.pubtime) : undefined,
    }));
}
