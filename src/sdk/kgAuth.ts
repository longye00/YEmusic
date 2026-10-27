/**
 * 酷狗音乐账号（可选）：酷狗 App 扫码登录，登录后乐库显示你的歌单（含“我喜欢”与收藏的歌单）。
 * 凭据（userid + token）只保存在本机 localStorage，仅随请求发送给 kugou.com。
 * 接口签名方式参考公开资料独立实现。
 */
import { md5 } from '@/lib/md5';
import { loadJson, parseCookiePairs, saveJson } from '@/lib/cookie';
import { requestJson } from '@/lib/http';
import { decodeEntities } from '@/lib/util';
import type { OnlinePlaylist } from './types';

const KEY = 'ye.kg.credential';
const WEB_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const APP_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const APP_UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';
const DFID = '-';
const MID = md5(DFID);
const UUID = md5(DFID + MID);

export interface KgCredential { userid: string; token: string; nickname?: string; avatarUrl?: string }

let credential: KgCredential | null = (() => {
    const value = loadJson<KgCredential>(KEY);
    return value.userid && value.token ? (value as KgCredential) : null;
})();

export const getKgCredential = () => credential;
export const hasKgLogin = () => Boolean(credential);

export function setKgCredential(next: KgCredential | null) {
    credential = next;
    saveJson(KEY, next);
}

type Params = Record<string, string | number>;
const query = (params: Params) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
const sorted = (params: Params) => Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('');
const now = () => Math.floor(Date.now() / 1000);
const https = (url: unknown, size = 400) => (url ? String(url).replace('{size}', String(size)).replace(/^http:/, 'https:') : undefined);

/** 网页登录接口（login-user.kugou.com）：md5(盐 + 排序后的参数 + 盐) */
async function webApi(path: string, params: Params) {
    const all: Params = { dfid: DFID, mid: MID, uuid: UUID, appid: 1005, apiver: 20, clientver: 12029, userid: 0, clienttime: now(), ...params };
    all.signature = md5(`${WEB_SALT}${sorted(all)}${WEB_SALT}`);
    return requestJson(`https://login-user.kugou.com${path}?${query(all)}`, { retries: 0 });
}

/** 移动端网关（gateway.kugou.com）：md5(盐 + 排序后的参数 + 请求体 + 盐) */
async function gateway(url: string, params: Params, options: { body?: object; router?: string } = {}) {
    const clienttime = now();
    const cred = credential;
    const all: Params = { dfid: DFID, mid: MID, uuid: UUID, appid: 1005, clientver: 12029, clienttime, userid: cred?.userid || 0, ...(cred ? { token: cred.token } : {}), ...params };
    const body = options.body ? JSON.stringify(options.body) : '';
    all.signature = md5(`${APP_SALT}${sorted(all)}${body}${APP_SALT}`);
    return requestJson(`${url}?${query(all)}`, {
        method: body ? 'POST' : 'GET',
        body: body || undefined,
        headers: { dfid: DFID, mid: MID, clienttime: String(clienttime), 'User-Agent': APP_UA, ...(options.router ? { 'x-router': options.router } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        retries: 0,
    });
}

// ---------------- 扫码登录 ----------------
export async function kgQrCreate(): Promise<{ image: string; key: string }> {
    const body = await webApi('/v2/qrcode', { appid: 1001, type: 1, plat: 4, qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1001&', srcappid: 2919 });
    const data = body?.data;
    if (!data?.qrcode || !data?.qrcode_img) throw new Error(`获取酷狗登录二维码失败（${body?.error_code ?? '未知错误'}）`);
    const image = String(data.qrcode_img);
    return { image: image.startsWith('data:') ? image : `data:image/png;base64,${image}`, key: String(data.qrcode) };
}

export type KgQrState =
    | { code: 'waiting' | 'expired' }
    | { code: 'scanned'; nickname?: string; avatarUrl?: string }
    | { code: 'done'; credential: KgCredential };

export async function kgQrCheck(key: string): Promise<KgQrState> {
    const body = await webApi('/v2/get_userinfo_qrcode', { plat: 4, appid: 1001, srcappid: 2919, qrcode: key });
    const data = body?.data || {};
    const status = Number(data.status);
    if (status === 4 && data.token && data.userid) {
        return { code: 'done', credential: { userid: String(data.userid), token: String(data.token), nickname: decodeEntities(data.nickname || ''), avatarUrl: https(data.pic, 200) } };
    }
    if (status === 2) return { code: 'scanned', nickname: data.nickname ? decodeEntities(data.nickname) : undefined, avatarUrl: https(data.pic, 200) };
    if (status === 0) return { code: 'expired' };
    return { code: 'waiting' };
}

/** 手动登录：粘贴 `userid=…; token=…`（或 KugooID / t） */
export function parseKgCookie(input: string): KgCredential | null {
    const jar = parseCookiePairs(String(input || '').replace(/&/g, '; '));
    const userid = jar.userid || jar.KugooID;
    const token = jar.token || jar.t;
    return userid && token ? { userid, token } : null;
}

// ---------------- 歌单 ----------------
export interface KgUserPlaylist extends OnlinePlaylist { liked?: boolean; subscribed?: boolean }

/** 账号的全部歌单；凭据失效时抛出 code = 20010 / 20018 等错误 */
export async function kgUserPlaylists(): Promise<KgUserPlaylist[]> {
    const cred = credential;
    if (!cred) return [];
    const body = await gateway('https://gateway.kugou.com/v7/get_all_list', { plat: 1 }, {
        router: 'cloudlist.service.kugou.com',
        body: { userid: Number(cred.userid), token: cred.token, total_ver: 979, type: 2, page: 1, pagesize: 100 },
    });
    if (Number(body?.status) !== 1) throw new KgApiError(`酷狗歌单加载失败（${body?.error_code ?? '未知错误'}）`, Number(body?.error_code) || 0);
    return (body?.data?.info || []).filter((item: any) => item?.global_collection_id).map((item: any): KgUserPlaylist => {
        const own = String(item.list_create_userid || '') === cred.userid;
        const liked = Number(item.is_def) === 2 || (own && /^我喜欢/.test(String(item.name || '')));
        return {
            id: String(item.global_collection_id),
            source: 'kg',
            name: liked ? '我喜欢' : decodeEntities(item.name),
            cover: https(item.pic),
            total: Number(item.count) || 0,
            author: decodeEntities(item.list_create_username || ''),
            desc: item.intro ? decodeEntities(item.intro) : undefined,
            liked,
            subscribed: !own,
        };
    });
}

export class KgApiError extends Error {
    constructor(message: string, public code = 0) {
        super(message);
    }
}

/** 凭据失效类错误（需要重新登录） */
export const isKgAuthError = (error: unknown) => error instanceof KgApiError && [20010, 20017, 20018, 20019, 20020, 30014].includes(error.code);

/** 歌单（global_collection_id）里的歌曲，原始数据交给 kg.ts 转换 */
export async function kgCollectionSongs(id: string, page = 1, pagesize = 100): Promise<{ count: number; info: any; songs: any[] }> {
    const body = await gateway('https://gateway.kugou.com/pubsongs/v2/get_other_list_file_nofilt', {
        area_code: 1,
        begin_idx: (page - 1) * pagesize,
        plat: 1,
        type: 1,
        mode: 1,
        personal_switch: 1,
        extend_fields: 'abtags,hot_cmt,popularization',
        pagesize,
        global_collection_id: id,
    });
    if (Number(body?.status) !== 1) throw new KgApiError(`酷狗歌单加载失败（${body?.error_code ?? '未知错误'}）`, Number(body?.error_code) || 0);
    return { count: Number(body?.data?.count) || 0, info: body?.data?.list_info || {}, songs: body?.data?.songs || [] };
}
