/**
 * 在线歌单导入：从分享文本 / 网址 / 短链接 / 纯 ID 里认出平台与歌单 ID，并拉取整张歌单。
 *
 * 各平台 App 的“分享 → 复制链接”复制出来的通常是一整段话（歌单名 + 短链接 + 尾巴），
 * 网易云是 163cn.tv/xxx、QQ 音乐是 c6.y.qq.com/base/fcgi-bin/u?__=xxx、酷狗是 t1.kugou.com/xxx：
 * 这些短链接里没有歌单 ID，要先请求一次（不跟随跳转，只读 Location）才能知道真正的目标。
 */
import { host } from '@/lib/host';
import { utf8Decode } from '@/lib/bytes';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, type Platform, type Track } from '@/sdk/types';

export interface PlaylistRef {
    platform: Platform;
    id: string;
}

export interface ParsedInput {
    ref?: PlaylistRef;
    /** 暂时认不出 ID、但属于某个平台域名的网址（多半是短链接），需要先请求一次拿到跳转目标 */
    pending: string[];
    /** 认不出来时给用户看的原因 */
    error?: string;
}

type Kind = 'playlist' | 'song' | 'album' | 'artist' | 'other';

const KIND_NAMES: Partial<Record<Kind, string>> = { song: '歌曲', album: '专辑', artist: '歌手' };

const HOST_RULES: [Platform, RegExp][] = [
    ['wy', /(?:^|\.)(?:music\.163\.com|163cn\.tv|163\.com|126\.net)$/],
    ['tx', /(?:^|\.)(?:qq\.com|url\.cn)$/],
    ['kg', /(?:^|\.)kugou\.com$/],
    ['kw', /(?:^|\.)kuwo\.cn$/],
    ['mg', /(?:^|\.)migu\.cn$/],
];

const platformOfHost = (hostname: string) => HOST_RULES.find(([, re]) => re.test(hostname))?.[0];

/** 酷狗的歌单 ID 有三种：数字 specialid、collection_… 、gcid_…（网页分享用），其余平台都是纯数字 */
function validId(platform: Platform, id: string) {
    if (platform === 'kg') return /^(?:\d+|collection_[\w]+|gcid_[\w]+)$/i.test(id);
    return /^\d+$/.test(id);
}

/** 带明确“这是歌单”含义的参数名 */
const PLAYLIST_PARAMS = ['disstid', 'dissid', 'specialid', 'special_id', 'global_collection_id', 'playlistid', 'playlist_id', 'pid', 'listid'];

const SPLIT = /[\s\u3000，。；：！？、（）()【】《》「」『』“”‘’"'<>]+/;
const TRAILING = /[.,;:!?)\]}]+$/;

/** 从一段文字里取出所有网址（支持省略 https:// 的 music.163.com/playlist?id=…） */
export function extractUrls(text: string): string[] {
    const out: string[] = [];
    for (const piece of text.replace(/&amp;/gi, '&').split(SPLIT)) {
        let token = piece.replace(TRAILING, '');
        if (!token) continue;
        const at = token.search(/https?:\/\//i);
        if (at > 0) token = token.slice(at);
        if (/^https?:\/\//i.test(token)) out.push(token);
        else if (/^(?:[\w-]+\.)+(?:com|cn|tv|net)(?:[:/?#]|$)/i.test(token)) out.push(`https://${token}`);
    }
    return [...new Set(out)];
}

interface ParsedUrl { host: string; path: string; params: [string, string][] }

function parseUrl(raw: string): ParsedUrl | null {
    try {
        const url = new URL(raw);
        const params: [string, string][] = [...url.searchParams.entries()];
        let path = url.pathname;
        // 网易云网页版把真正的路径与参数放在 #/ 之后：music.163.com/#/playlist?id=1
        if (/^#!?\//.test(url.hash)) {
            const [p, q = ''] = url.hash.replace(/^#!?/, '').split('?');
            path += p;
            params.push(...new URLSearchParams(q).entries());
        }
        let decoded = path;
        try { decoded = decodeURIComponent(path); } catch { /* 保持原样 */ }
        return { host: url.hostname.toLowerCase(), path: decoded, params };
    } catch {
        return null;
    }
}

function analyzeUrl(raw: string): { platform: Platform; id?: string; kind: Kind } | null {
    const url = parseUrl(raw);
    if (!url) return null;
    const platform = platformOfHost(url.host);
    if (!platform) return null;
    const param = (key: string) => url.params.find(([k]) => k.toLowerCase() === key)?.[1];

    for (const key of PLAYLIST_PARAMS) {
        const value = param(key);
        if (value && validId(platform, value)) return { platform, id: value, kind: 'playlist' };
    }
    const whole = `${url.path}?${url.params.map(([k, v]) => `${k}=${v}`).join('&')}`;
    if (platform === 'kg') {
        const collection = /(collection_[\w]+)/i.exec(whole);
        if (collection) return { platform, id: collection[1], kind: 'playlist' };
        const gcid = /(gcid_[\w]+)/i.exec(whole);
        if (gcid) return { platform, id: gcid[1], kind: 'playlist' };
    }
    // /playlist/123、/playlist_detail/123、/taoge/123、/special/single/123.html、/plist/list/123 …
    const byPath = /\/(?:playlist(?:_detail)?|taoge|special\/single|plist\/list|zlist\/list|songlist)\/(?:index\/)?([\w-]+?)(?:\.html?)?(?=[/?#]|$)/i.exec(url.path);
    if (byPath && validId(platform, byPath[1])) return { platform, id: byPath[1], kind: 'playlist' };
    // 路径里写明是歌单、ID 在 id= 里：music.163.com/playlist?id=1、…/taoge.html?id=1、…/share/playlist/index.html?id=1
    if (/playlist|taoge|songlist|plist|special/i.test(url.path)) {
        const value = param('id') || param('tid');
        if (value && validId(platform, value)) return { platform, id: value, kind: 'playlist' };
    }
    const path = url.path.toLowerCase();
    let kind: Kind = 'other';
    if (/album/.test(path)) kind = 'album';
    else if (/artist|singer/.test(path)) kind = 'artist';
    else if (/(?:^|\/)(?:song|songdetail|mixsong|mv|video|playsong)(?:[/.]|$)/.test(path) || param('songmid') || param('songid') || param('hash')) kind = 'song';
    return { platform, kind };
}

/** 同步识别：能直接认出的给出 ref，需要联网解析的短链接放进 pending，都不行就给原因 */
export function parseInput(input: string, fallback: Platform): ParsedInput {
    const text = input.trim();
    if (!text) return { pending: [] };
    const urls = extractUrls(text);
    const pending: string[] = [];
    let wrongKind: Kind | undefined;
    let unknownHost = false;
    for (const url of urls) {
        const found = analyzeUrl(url);
        if (!found) { unknownHost = true; continue; }
        if (found.id) return { ref: { platform: found.platform, id: found.id }, pending: [] };
        if (found.kind === 'other') pending.push(url);
        else wrongKind = found.kind;
    }
    if (pending.length) return { pending };
    const wrongName = wrongKind && KIND_NAMES[wrongKind];
    if (wrongName) return { pending: [], error: `这是${wrongName}链接，不是歌单链接` };
    if (!urls.length) {
        const bare = text.replace(/\s+/g, '');
        if (validId(fallback, bare)) return { ref: { platform: fallback, id: bare }, pending: [] };
        if (/^[\w-]+$/.test(bare)) return { pending: [], error: `${PLATFORM_NAMES[fallback]}的歌单 ID 应该是${fallback === 'kg' ? '数字或 collection_ 开头的编号' : '一串数字'}` };
        return { pending: [], error: '没有找到链接：请粘贴 App 里「分享 → 复制链接」得到的整段文字，或纯数字的歌单 ID' };
    }
    return { pending: [], error: unknownHost ? '暂不支持这个网址：请粘贴 QQ音乐 / 网易云 / 酷狗 / 酷我 / 咪咕 的歌单链接' : '没能从链接里认出歌单 ID' };
}

/** 兼容旧调用：只关心能不能直接认出 */
export function parsePlaylistInput(input: string, fallback: Platform): PlaylistRef | null {
    return parseInput(input, fallback).ref ?? null;
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/** 在页面源码里找歌单：页面脚本 / meta 跳转的短链，目标网址或 ID 会写在正文里 */
function scanBody(body: string, hint?: Platform): PlaylistRef | { kind: Kind } | null {
    const text = body.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/&amp;/gi, '&');
    for (const url of text.match(/https?:\/\/[^\s"'<>\\)]+/gi) || []) {
        const found = analyzeUrl(url);
        if (found?.id) return { platform: found.platform, id: found.id };
    }
    if (hint === 'kg') {
        const collection = /global_collection_id["']?\s*[:=]\s*["']?(collection_[\w]+)/i.exec(text) || /(collection_\d+_\d+_\d+_\d+)/i.exec(text);
        if (collection) return { platform: 'kg', id: collection[1] };
        const special = /["']?specialid["']?\s*[:=]\s*["']?(\d{3,})/i.exec(text) || /special\/single\/(\d+)/i.exec(text);
        if (special) return { platform: 'kg', id: special[1] };
    }
    return null;
}

/** 沿着 3xx 跳转往下走（不真正访问目标站），一旦某一步能认出歌单 ID 就返回 */
async function followShortLink(start: string): Promise<{ ref?: PlaylistRef; kind?: Kind }> {
    let url = start;
    for (let hop = 0; hop < 6; hop++) {
        const res = await host.fetch({ url, method: 'GET', followRedirects: false, timeoutMs: 12000, headers: { 'user-agent': MOBILE_UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' } });
        const location = res.headers?.location;
        if (res.status >= 300 && res.status < 400 && location) {
            let next: string;
            try { next = new URL(location, url).toString(); } catch { break; }
            const found = analyzeUrl(next);
            if (found?.id) return { ref: { platform: found.platform, id: found.id } };
            if (found && found.kind !== 'other') return { kind: found.kind };
            url = next;
            continue;
        }
        if (res.ok && res.bytes?.length) {
            // 只在“跳转中转页”（很小的页面）或酷狗的分享页里找；完整的网站首页里会有一堆无关的推荐歌单链接，不能当结果
            const where = new URL(url);
            const small = res.bytes.length <= 30_000;
            const kgShare = platformOfHost(where.hostname) === 'kg' && /share|songlist|plist|zlist/i.test(where.pathname);
            if (small || kgShare) {
                const hit = scanBody(utf8Decode(res.bytes.subarray(0, 600_000)), kgShare ? 'kg' : undefined);
                if (hit && 'id' in hit) return { ref: hit };
            }
        }
        break;
    }
    return {};
}

/** gcid_ 是酷狗网页分享用的编号，要从歌单页里换出真正的 ID */
async function normalizeRef(ref: PlaylistRef): Promise<PlaylistRef> {
    if (ref.platform !== 'kg' || !/^gcid_/i.test(ref.id)) return ref;
    for (const page of [`https://www.kugou.com/songlist/${ref.id}/`, `https://m.kugou.com/songlist/${ref.id}/`]) {
        try {
            const res = await host.fetch({ url: page, method: 'GET', timeoutMs: 12000, headers: { 'user-agent': MOBILE_UA } });
            if (!res.ok || !res.bytes?.length) continue;
            const hit = scanBody(utf8Decode(res.bytes.subarray(0, 600_000)), 'kg');
            if (hit && 'id' in hit && !/^gcid_/i.test(hit.id)) return hit;
        } catch { /* 换下一个页面 */ }
    }
    throw new Error('暂时无法解析这个酷狗歌单链接，请改用酷狗里的「复制链接」，或粘贴 PC 网页上的歌单地址');
}

/** 异步识别：必要时先解析短链接 */
export async function resolveInput(input: string, fallback: Platform): Promise<PlaylistRef> {
    const parsed = parseInput(input, fallback);
    if (parsed.ref) return normalizeRef(parsed.ref);
    if (!parsed.pending.length) throw new Error(parsed.error || '无法识别歌单链接');
    let kind: Kind | undefined;
    let failure = '';
    for (const url of parsed.pending.slice(0, 3)) {
        try {
            const hit = await followShortLink(url);
            if (hit.ref) return normalizeRef(hit.ref);
            if (hit.kind) kind = hit.kind;
        } catch (error) {
            failure = (error as Error).message;
        }
    }
    const kindName = kind && KIND_NAMES[kind];
    if (kindName) throw new Error(`这是${kindName}链接，不是歌单链接`);
    throw new Error(`没能从这个链接里认出歌单${failure ? `（${failure}）` : ''}：可能已失效、不是歌单，或所在平台限制了访问。请改用 App 里「分享 → 复制链接」，或直接输入歌单 ID`);
}

export interface OnlinePlaylist {
    ref: PlaylistRef;
    name: string;
    cover?: string;
    desc?: string;
    list: Track[];
}

/** 拉取整张歌单（分页，最多 30 页 / 3000 首） */
export async function fetchOnlinePlaylist(ref: PlaylistRef, onProgress?: (count: number) => void): Promise<OnlinePlaylist> {
    const sdk = sdks[ref.platform];
    let first;
    try {
        first = await sdk.getSongListDetail(ref.id, 1);
    } catch (error) {
        throw new Error(`读取${PLATFORM_NAMES[ref.platform]}歌单失败（${(error as Error).message}）：请确认歌单是公开的，并检查网络`);
    }
    const list = [...first.list];
    onProgress?.(list.length);
    const pages = Math.min(30, Math.ceil((first.total || list.length) / (first.limit || 100)));
    for (let page = 2; page <= pages; page++) {
        const more = await sdk.getSongListDetail(ref.id, page).catch(() => null);
        if (!more?.list.length) break;
        list.push(...more.list);
        onProgress?.(list.length);
    }
    if (!list.length) throw new Error(`${PLATFORM_NAMES[ref.platform]}歌单 ${ref.id} 里没有歌曲：歌单可能不存在、未公开或需要登录才能查看`);
    const seen = new Set<string>();
    const unique = list.filter(track => (seen.has(track.id) ? false : (seen.add(track.id), true)));
    return {
        ref,
        name: first.info?.name || `${PLATFORM_NAMES[ref.platform]}歌单 ${ref.id}`,
        cover: first.info?.cover,
        desc: first.info?.desc,
        list: unique,
    };
}
