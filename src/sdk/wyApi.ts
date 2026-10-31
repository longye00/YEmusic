/**
 * 网易云 weapi：扫码登录、账号歌单、收藏专辑、私人FM、每日推荐、推荐歌单、新碟、专辑详情。
 * weapi 参数加密方式参考公开资料（AES-128-CBC 两次 + RSA 无填充），独立实现。
 * 未登录时以游客身份访问：私人FM / 每日推荐 / 推荐歌单返回通用内容，账号相关接口返回 301。
 */
import { aesEncrypt } from '@/lib/aes';
import { base64Encode, utf8Decode, utf8Encode } from '@/lib/bytes';
import { encodeForm, requestJson, requestRaw } from '@/lib/http';
import { modPow } from '@/lib/rsa';
import { decodeEntities } from '@/lib/util';
import type { OnlinePlaylist, Track } from './types';
import { fromSong } from './wy';
import { getWyCookies, parseCookieString, parseSetCookie, wyHeaders, type WyCookies } from './wyAuth';

const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const IV = '0102030405060708';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const MODULUS = BigInt(
    '0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7',
);
const PUBLIC_EXPONENT = 65537n;

const aes = (text: string, key: string) => base64Encode(aesEncrypt(utf8Encode(text), utf8Encode(key), 'cbc', utf8Encode(IV), 128, true));

function rsaHex(text: string) {
    let hex = '';
    for (const byte of utf8Encode(text.split('').reverse().join(''))) hex += byte.toString(16).padStart(2, '0');
    return modPow(BigInt(`0x${hex}`), PUBLIC_EXPONENT, MODULUS).toString(16).padStart(256, '0');
}

export function weapiEncrypt(data: object): { params: string; encSecKey: string } {
    const random = crypto.getRandomValues(new Uint8Array(16));
    const secretKey = Array.from(random, n => BASE62[n % 62]).join('');
    return { params: aes(aes(JSON.stringify(data), PRESET_KEY), secretKey), encSecKey: rsaHex(secretKey) };
}

export class WyApiError extends Error {
    constructor(message: string, public code = 0) {
        super(message);
    }
}

/** 需要登录的接口返回 301 */
export const isLoginRequired = (error: unknown) => error instanceof WyApiError && (error.code === 301 || error.code === 302);

async function weapi<T = any>(path: string, data: Record<string, unknown> = {}): Promise<{ body: T; cookies: WyCookies }> {
    const csrf = getWyCookies().__csrf || '';
    const res = await requestRaw(`https://music.163.com/weapi${path}?csrf_token=${encodeURIComponent(csrf)}`, {
        method: 'POST',
        body: encodeForm(weapiEncrypt({ ...data, csrf_token: csrf })),
        headers: wyHeaders({ 'content-type': 'application/x-www-form-urlencoded', Origin: 'https://music.163.com' }),
        timeout: 12000,
        retries: 0,
    });
    let body: any = null;
    try {
        body = res.bytes ? JSON.parse(utf8Decode(res.bytes)) : null;
    } catch { /* 下面统一报错 */ }
    if (!body || typeof body !== 'object') throw new WyApiError(res.ok ? '网易云返回了无法识别的数据' : `网易云接口异常（HTTP ${res.status}）`, res.status);
    return { body, cookies: parseSetCookie(res.headers?.['set-cookie']) };
}

function check(body: any, fallback: string) {
    const code = Number(body?.code);
    if (code === 200) return;
    if (code === 301) throw new WyApiError('需要登录网易云账号', 301);
    throw new WyApiError(body?.message || body?.msg || `${fallback}（${code || '未知错误'}）`, code);
}

const https = (url: unknown) => (url ? String(url).replace(/^http:/, 'https:') : undefined);
const sized = (url: unknown, px = 400) => {
    const value = https(url);
    return value ? `${value.split('?')[0]}?param=${px}y${px}` : undefined;
};

// ---------------- 扫码登录 ----------------
export interface WyProfile {
    userId: number;
    nickname: string;
    avatarUrl?: string;
    vipType?: number;
}

export interface QrStatus {
    /** 800 已过期，801 等待扫码，802 待确认，803 登录成功，其他为风控 / 异常 */
    code: number;
    message?: string;
    nickname?: string;
    avatarUrl?: string;
    cookies?: WyCookies;
}

export async function qrCreate(): Promise<{ key: string; url: string }> {
    const { body } = await weapi('/login/qrcode/unikey', { type: 1 });
    check(body, '获取登录二维码失败');
    if (!body.unikey) throw new WyApiError('获取登录二维码失败');
    return { key: body.unikey, url: `https://music.163.com/login?codekey=${body.unikey}` };
}

export async function qrCheck(key: string): Promise<QrStatus> {
    const { body, cookies } = await weapi('/login/qrcode/client/login', { key, type: 1 });
    const done = Number(body.code) === 803;
    let merged: WyCookies | undefined;
    if (done) {
        // 凭据通常在 Set-Cookie 里；个别网络环境（代理 / 网关）会吞掉响应头，此时回退到响应体里的 cookie 字符串
        merged = typeof body.cookie === 'string' ? parseCookieString(body.cookie) : {};
        for (const name of Object.keys(cookies)) if (cookies[name] !== '' || merged[name] === undefined) merged[name] = cookies[name];
    }
    return {
        code: Number(body.code),
        message: body.message || body.msg,
        nickname: body.nickname,
        avatarUrl: https(body.avatarUrl),
        cookies: merged,
    };
}

// ---------------- 手机验证码登录 ----------------
/** 向手机号发送登录验证码（仅支持 +86） */
export async function captchaSent(phone: string): Promise<void> {
    const { body } = await weapi('/sms/captcha/sent', { cellphone: phone, ctcode: '86' });
    check(body, '发送验证码失败');
}

/** 手机号 + 验证码登录；返回可供 completeWyLogin 使用的凭据 Cookie */
export async function loginCellphone(phone: string, captcha: string): Promise<WyCookies> {
    const { body, cookies } = await weapi('/login/cellphone', { phone, countrycode: '86', captcha, rememberLogin: 'true' });
    check(body, '手机号登录失败');
    // 与扫码登录一致：凭据通常在 Set-Cookie 里，个别网络环境会吞掉响应头，回退到响应体里的 cookie 字符串
    const merged: WyCookies = typeof body.cookie === 'string' ? parseCookieString(body.cookie) : {};
    for (const name of Object.keys(cookies)) if (cookies[name] !== '' || merged[name] === undefined) merged[name] = cookies[name];
    if (!merged.MUSIC_U) throw new WyApiError('没有拿到登录凭据，请稍后重试');
    return merged;
}

export async function fetchAccount(): Promise<WyProfile | null> {
    const { body } = await weapi('/w/nuser/account/get', {});
    check(body, '获取账号信息失败');
    const profile = body.profile;
    if (!profile?.userId) return null;
    return { userId: Number(profile.userId), nickname: decodeEntities(profile.nickname || '网易云用户'), avatarUrl: sized(profile.avatarUrl, 120), vipType: profile.vipType };
}

export async function logoutRemote() {
    await weapi('/logout', {}).catch(() => undefined);
}

// ---------------- 歌单 ----------------
export interface WyPlaylist extends OnlinePlaylist {
    /** 收藏的他人歌单 */
    subscribed?: boolean;
    /** 账号的“我喜欢的音乐” */
    liked?: boolean;
}

function toPlaylist(item: any, extra: Partial<WyPlaylist> = {}): WyPlaylist {
    return {
        id: String(item.id),
        source: 'wy',
        name: decodeEntities(item.name),
        cover: sized(item.coverImgUrl || item.picUrl),
        playCount: Number(item.playCount ?? item.playcount) || undefined,
        author: item.creator?.nickname ? decodeEntities(item.creator.nickname) : undefined,
        desc: decodeEntities(item.copywriter || item.description || ''),
        total: Number(item.trackCount) || undefined,
        ...extra,
    };
}

export async function userPlaylists(uid: number): Promise<WyPlaylist[]> {
    const map = (list: any[]) => list.map((item: any) => toPlaylist(item, {
        subscribed: Boolean(item.subscribed) || Number(item.creator?.userId) !== Number(uid),
        liked: item.specialType === 5,
    }));
    // 优先走 weapi（需要 Cookie 里的 __csrf）。刚用手机验证码登录时凭据可能没有 __csrf，
    // weapi 会因签名不完整而报错、或返回空列表；两种情况都回退到不需要 csrf_token 的明文接口——
    // 它同样带 MUSIC_U，能拿到账号的全部歌单（含"我喜欢的音乐"）。
    const plain = async () => {
        const body = await requestJson(`https://music.163.com/api/user/playlist?uid=${uid}&limit=1000&offset=0`, { headers: wyHeaders(), retries: 0 });
        check(body, '获取账号歌单失败');
        return map(body.playlist || []);
    };
    try {
        const { body } = await weapi('/user/playlist', { uid, limit: 1000, offset: 0, includeVideo: true });
        check(body, '获取账号歌单失败');
        const list = body.playlist || [];
        return list.length ? map(list) : await plain();
    } catch (error) {
        if (isLoginRequired(error)) throw error;
        return plain();
    }
}

/** 推荐歌单：登录后为个性化推荐，否则为通用推荐（35 个） */
export async function recommendPlaylists(loggedIn: boolean): Promise<WyPlaylist[]> {
    if (loggedIn) {
        try {
            const { body } = await weapi('/v1/discovery/recommend/resource', {});
            if (Number(body.code) === 200 && body.recommend?.length) return body.recommend.map((item: any) => toPlaylist(item));
        } catch { /* 回退到通用推荐 */ }
    }
    const body = await requestJson('https://music.163.com/api/personalized/playlist?limit=35&total=true&n=1000', { headers: wyHeaders() });
    check(body, '获取推荐歌单失败');
    return (body.result || []).map((item: any) => toPlaylist(item));
}

// ---------------- 电台 / 推荐 ----------------
/** 私人FM：每次返回 1~3 首，未登录时为通用推荐 */
export async function personalFm(): Promise<Track[]> {
    const { body } = await weapi('/v1/radio/get', {});
    check(body, '私人FM获取失败');
    return (body.data || []).map((song: any) => fromSong(song, song.privilege));
}

/** 相似歌曲：以一首网易云歌曲为种子（“猜我喜欢”用）。未登录也能用 */
export async function similarSongs(songId: string | number, limit = 12): Promise<Track[]> {
    const { body } = await weapi('/v1/discovery/simiSong', { songid: songId, limit, offset: 0 });
    check(body, '获取相似歌曲失败');
    return (body.songs || []).map((song: any) => fromSong(song, song.privilege));
}

/** 每日推荐 30 首（未登录时为通用推荐） */
export async function dailySongs(): Promise<Track[]> {
    const { body } = await weapi('/v3/discovery/recommend/songs', {});
    check(body, '每日推荐获取失败');
    const privileges = new Map((body.data?.privileges || []).map((p: any) => [p.id, p]));
    return (body.data?.dailySongs || []).map((song: any) => fromSong(song, privileges.get(song.id) || song.privilege));
}

// ---------------- 专辑 ----------------
export interface WyAlbum {
    id: string;
    name: string;
    cover?: string;
    artist: string;
    size?: number;
    publishTime?: number;
    desc?: string;
}

function toAlbum(item: any): WyAlbum {
    const artists = item.artists?.length ? item.artists : item.artist ? [item.artist] : [];
    return {
        id: String(item.id),
        name: decodeEntities(item.name),
        cover: sized(item.picUrl || item.blurPicUrl, 500),
        artist: decodeEntities(artists.map((a: any) => a.name).filter(Boolean).join('、')),
        size: Number(item.size) || undefined,
        publishTime: Number(item.publishTime) || undefined,
        desc: item.briefDesc || item.description || undefined,
    };
}

export async function subAlbums(): Promise<WyAlbum[]> {
    const { body } = await weapi('/album/sublist', { limit: 200, offset: 0, total: true });
    check(body, '获取收藏专辑失败');
    return (body.data || []).map(toAlbum);
}

export async function newAlbums(): Promise<WyAlbum[]> {
    const body = await requestJson('https://music.163.com/api/album/new?area=ALL&offset=0&total=true&limit=40', { headers: wyHeaders() });
    check(body, '获取新碟失败');
    return (body.albums || []).map(toAlbum);
}

export async function albumDetail(id: string): Promise<{ info: WyAlbum; tracks: Track[] }> {
    const body = await requestJson(`https://music.163.com/api/v1/album/${encodeURIComponent(id)}`, { headers: wyHeaders() });
    check(body, '专辑获取失败');
    const info = toAlbum(body.album || { id });
    const tracks = (body.songs || []).map((song: any) => {
        const track = fromSong(song, song.privilege);
        return track.cover || !info.cover ? track : { ...track, cover: info.cover };
    });
    return { info: { ...info, desc: body.album?.description || info.desc }, tracks };
}

// ---------------- 排行榜封面 ----------------
let toplistMeta: Promise<Map<string, { cover?: string; desc?: string }>> | null = null;

export function wyToplistMeta() {
    toplistMeta ??= requestJson('https://music.163.com/api/toplist', { headers: wyHeaders() })
        .then(body => new Map<string, { cover?: string; desc?: string }>((body?.list || []).map((item: any) => [String(item.id), { cover: sized(item.coverImgUrl), desc: item.updateFrequency || item.description || undefined }])))
        .catch(error => {
            toplistMeta = null;
            throw error;
        });
    return toplistMeta;
}
