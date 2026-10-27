/**
 * 网易云账号凭据（Cookie）。只保存在本机 localStorage，仅随请求发送给 music.163.com。
 * 未登录时所有接口按游客身份访问，乐库里的推荐内容为通用推荐。
 */
import { parseSetCookie as parseSetCookieHeader } from '@/lib/cookie';

const KEY = 'ye.wy.cookie';

export type WyCookies = Record<string, string>;

function load(): WyCookies {
    try {
        const value = JSON.parse(localStorage.getItem(KEY) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

let jar: WyCookies = load();

export const getWyCookies = (): WyCookies => jar;
export const hasWyLogin = () => Boolean(jar.MUSIC_U);

export function setWyCookies(next: WyCookies, replace = false) {
    jar = replace ? { ...next } : { ...jar, ...next };
    try {
        localStorage.setItem(KEY, JSON.stringify(jar));
    } catch { /* 存储不可用时只保存在内存中 */ }
}

export function clearWyCookies() {
    jar = {};
    try {
        localStorage.removeItem(KEY);
    } catch { /* ignore */ }
}

/** 解析主进程合并后的 Set-Cookie（实现见 lib/cookie） */
export const parseSetCookie = parseSetCookieHeader;

/** 解析 `a=1; b=2` 形式的 Cookie 字符串；只给了一个裸值时视为 MUSIC_U */
export function parseCookieString(text: string): WyCookies {
    const out: WyCookies = {};
    const value = String(text || '').trim();
    if (!value) return out;
    if (!value.includes('=')) {
        out.MUSIC_U = value;
        return out;
    }
    for (const part of value.split(/;\s*/)) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        const name = part.slice(0, index).trim();
        if (/^(expires|path|domain|max-age|samesite|secure|httponly)$/i.test(name)) continue;
        out[name] = part.slice(index + 1).trim();
    }
    return out;
}

/** 随 music.163.com 请求发送的 Cookie 头（未登录时为空） */
export function wyCookieHeader(): string {
    const names = Object.keys(jar).filter(name => jar[name] !== undefined && jar[name] !== '');
    if (!names.length) return '';
    const cookie: WyCookies = { __remember_me: 'true', ...jar };
    return Object.keys(cookie).map(name => `${name}=${cookie[name]}`).join('; ');
}

/** 网易云接口的通用请求头：Referer + 登录后的 Cookie */
export function wyHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = wyCookieHeader();
    return { Referer: 'https://music.163.com/', ...(cookie ? { Cookie: cookie } : {}), ...extra };
}
