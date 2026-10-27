/** Cookie 小工具：解析主进程合并后的 Set-Cookie 与 `a=1; b=2` 形式的 Cookie 字符串。 */
export type CookieJar = Record<string, string>;

const ATTRIBUTES = /^(expires|path|domain|max-age|samesite|secure|httponly|priority|partitioned)$/i;

/** 主进程把多个 Set-Cookie 以 ", " 连接，Expires 中也含逗号，所以只认 `, 名=值` 形式的开头 */
export function parseSetCookie(header: string | undefined): CookieJar {
    const out: CookieJar = {};
    if (!header) return out;
    const re = /(?:^|,\s*)([A-Za-z0-9_\-.]+)=([^;,]*)/g;
    for (let m = re.exec(header); m; m = re.exec(header)) {
        if (ATTRIBUTES.test(m[1])) continue;
        // 服务端常先下发空值（清除旧 Cookie）再下发新值；空值不覆盖已有的非空值
        if (m[2] === '' && out[m[1]]) continue;
        out[m[1]] = m[2];
    }
    return out;
}

/** 解析 `a=1; b=2` 形式的 Cookie 字符串 */
export function parseCookiePairs(text: string): CookieJar {
    const out: CookieJar = {};
    for (const part of String(text || '').split(/;\s*/)) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        const name = part.slice(0, index).trim();
        if (ATTRIBUTES.test(name)) continue;
        out[name] = part.slice(index + 1).trim();
    }
    return out;
}

export const cookieHeader = (jar: CookieJar) => Object.keys(jar).filter(k => jar[k] !== undefined && jar[k] !== '').map(k => `${k}=${jar[k]}`).join('; ');

/** localStorage 里的 JSON 对象（读失败时返回空对象） */
export function loadJson<T extends object>(key: string): Partial<T> {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

export function saveJson(key: string, value: object | null) {
    try {
        if (value) localStorage.setItem(key, JSON.stringify(value));
        else localStorage.removeItem(key);
    } catch { /* 存储不可用时只保存在内存中 */ }
}
