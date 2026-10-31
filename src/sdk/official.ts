/**
 * 平台官方取链：直接用各平台自己的播放接口拿音频地址，而不是走洛雪音源脚本。
 *
 * 与音源脚本的区别：
 * - 登录后带上自己的凭据，VIP 歌曲能拿到会员音质（无损 / Hi-Res），音源脚本永远以游客身份取链；
 * - 链接来自平台自己的 CDN，不受第三方音源存活情况影响；
 * - 拿不到（无版权 / 只有试听片段 / 需要更高权限）时返回 null，由 resolver 继续走音源脚本。
 *
 * 三个平台的可用程度不同：
 * - 网易云：官方接口对游客也开放（上限 320k），登录后按会员等级放开无损 / Hi-Res；
 * - QQ音乐：取链接口要求合法 guid 与登录态，未登录一律 `retcode 405 guid-error`，因此只在已登录时尝试；
 * - 酷狗：`play/getdata` 未登录返回 `err_code 30020`（privilege），同样只在已登录时尝试。
 */
import { requestJson } from '@/lib/http';
import { md5 } from '@/lib/md5';
import { hasWyLogin, wyHeaders } from './wyAuth';
import { getTxCredential } from './txAuth';
import { getKgCredential } from './kgAuth';
import type { Platform, Quality, Track } from './types';

export interface OfficialUrl {
    url: string;
    /** 平台实际给出的音质，可能低于请求的音质（会员等级不够时会被降档） */
    quality: Quality;
    /** 平台名称，用于日志与播放器状态提示 */
    sourceName: string;
}

/** 官方通道在解析结果里的标识（不是音源脚本的 id，熔断 / 坏链统计要跳过它） */
export const OFFICIAL_SOURCE_ID = 'official';

const https = (url: string) => url.replace(/^http:/, 'https:');

// ---------------- 网易云 ----------------
/** 音质 → 官方 level 参数 */
const WY_LEVEL: Record<Quality, string> = {
    '128k': 'standard',
    '320k': 'exhigh',
    flac: 'lossless',
    flac24bit: 'hires',
};
/** 官方 level → 音质（响应里的 level 才是实际给到的档位） */
const WY_QUALITY: Record<string, Quality> = {
    standard: '128k',
    lower: '128k',
    exhigh: '320k',
    lossless: 'flac',
    hires: 'flac24bit',
    jyeffect: 'flac',
    sky: 'flac',
    jymaster: 'flac24bit',
    dolby: 'flac',
};

/**
 * 网易云官方播放地址。
 * 明文接口 `api/song/enhance/player/url/v1`：未登录也能用（上限 320k），
 * 带上 MUSIC_U 后按会员等级放开无损 / Hi-Res。
 */
export async function wyOfficialUrl(track: Track, quality: Quality): Promise<OfficialUrl | null> {
    const level = WY_LEVEL[quality] || 'standard';
    const encodeType = level === 'standard' || level === 'exhigh' ? 'mp3' : 'flac';
    const body = await requestJson('https://music.163.com/api/song/enhance/player/url/v1', {
        method: 'POST',
        form: { ids: `[${track.songmid}]`, level, encodeType },
        headers: wyHeaders(),
        timeout: 6000,
        retries: 0,
    });
    const item = body?.data?.[0];
    if (!item) return null;
    // 404 = 这首歌在这个平台没有版权 / 已下架
    if (Number(item.code) !== 200 || !item.url) return null;
    // 只有试听片段（VIP 歌 + 非 VIP 账号）：给出去等于播 30 秒就停，交回音源脚本处理
    if (item.freeTrialInfo) return null;
    const actual = WY_QUALITY[String(item.level || '')] || quality;
    return { url: https(String(item.url)), quality: actual, sourceName: '网易云官方' };
}

// ---------------- QQ音乐 ----------------
/** 音质 → 官方文件名前缀与扩展名 */
const TX_FILE: Record<Quality, { prefix: string; ext: string }> = {
    '128k': { prefix: 'M500', ext: 'mp3' },
    '320k': { prefix: 'M800', ext: 'mp3' },
    flac: { prefix: 'F000', ext: 'flac' },
    flac24bit: { prefix: 'RS01', ext: 'flac' },
};

/**
 * QQ音乐官方播放地址（vkey.GetVkeyServer / CgiGetVkey）。
 * 未登录时平台一律回 `retcode 405 guid-error`，所以只在已登录时调用。
 */
export async function txOfficialUrl(track: Track, quality: Quality): Promise<OfficialUrl | null> {
    const cred = getTxCredential();
    if (!cred) return null;
    const { prefix, ext } = TX_FILE[quality] || TX_FILE['320k'];
    // 文件名里的 mid 优先用 media_mid（命中率更高）
    const mediaMid = track.meta?.strMediaMid || track.songmid;
    const guid = String(Math.floor(Math.random() * 10000000000));
    const data = {
        comm: { uin: Number(cred.uin) || 0, format: 'json', ct: 23, cv: 0, guid },
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
                filename: [`${prefix}${mediaMid}${track.songmid}.${ext}`],
                songmid: [track.songmid],
                songtype: [0],
                uin: cred.uin,
                loginflag: 1,
                platform: '23',
                firstlogin: 1,
                newver: 1,
                nohash: 0,
                cms: 0,
            },
        },
    };
    const body = await requestJson(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(data))}`, {
        method: 'GET',
        headers: {
            Referer: 'https://y.qq.com/',
            Cookie: [
                `uin=o${cred.uin}`,
                `qm_keyst=${cred.musickey}`,
                `qqmusic_key=${cred.musickey}`,
                `qqmusic_uin=o${cred.uin}`,
                `tmeLoginType=${cred.loginType}`,
                `pgv_pvid=${guid}`,
                `ts_uid=${guid}`,
            ].join('; '),
        },
        timeout: 6000,
        retries: 0,
    });
    const info = body?.req_0?.data?.midurlinfo?.[0];
    const purl = info?.purl;
    if (!purl) return null;
    const sip: string[] = body?.req_0?.data?.sip || [];
    const base = sip.find(s => s) || 'https://dl.stream.qqmusic.qq.com/';
    return { url: https(base + purl), quality, sourceName: 'QQ音乐官方' };
}

// ---------------- 酷狗 ----------------
/** 音质 → 取哪个 hash（酷狗按音质分文件） */
function kgHashFor(track: Track, quality: Quality): string {
    const fromQuality = track.qualities?.find(q => q.type === quality)?.hash;
    return String(fromQuality || track.meta?.hash || '').toUpperCase();
}

/**
 * 酷狗官方播放地址（wwwapi `play/getdata`）。
 * 未登录返回 `err_code 30020`（privilege），所以只在已登录时调用。
 */
export async function kgOfficialUrl(track: Track, quality: Quality): Promise<OfficialUrl | null> {
    const cred = getKgCredential();
    if (!cred) return null;
    const hash = kgHashFor(track, quality);
    if (!hash) return null;
    const dfid = '-';
    const mid = md5(dfid);
    const params = new URLSearchParams({
        r: 'play/getdata',
        hash,
        appid: '1005',
        mid,
        platid: '4',
        album_id: String(track.albumId || 0),
        _: String(Date.now()),
        userid: cred.userid,
        token: cred.token,
    });
    const body = await requestJson(`https://wwwapi.kugou.com/yy/index.php?${params.toString()}`, {
        headers: {
            Referer: 'https://www.kugou.com/',
            Cookie: `kg_mid=${mid}; userid=${cred.userid}; token=${cred.token}`,
        },
        timeout: 6000,
        retries: 0,
    });
    const data = body?.data;
    if (Number(body?.status) !== 1 || !data) return null;
    const url = data.play_url || data.play_backup_url;
    if (!url) return null;
    return { url: https(String(url)), quality, sourceName: '酷狗官方' };
}

// ---------------- 统一入口 ----------------
/** 该平台是否具备走官方通道的条件（酷我 / 咪咕没有账号体系，一律 false） */
export function officialAvailable(platform: Platform): boolean {
    if (platform === 'wy') return true;
    if (platform === 'tx') return Boolean(getTxCredential());
    if (platform === 'kg') return Boolean(getKgCredential());
    return false;
}

/** 官方通道当前是否带登录态（用于界面提示与解析日志） */
export function officialLoggedIn(platform: Platform): boolean {
    if (platform === 'wy') return hasWyLogin();
    if (platform === 'tx') return Boolean(getTxCredential());
    if (platform === 'kg') return Boolean(getKgCredential());
    return false;
}

/**
 * 取官方播放地址；不可用 / 拿不到时返回 null（调用方继续走音源脚本）。
 * 抛错也只当作"没拿到"，不影响后续回退。
 */
export async function officialUrl(track: Track, quality: Quality): Promise<OfficialUrl | null> {
    const platform = track.source as Platform;
    if (!officialAvailable(platform)) return null;
    try {
        if (platform === 'wy') return await wyOfficialUrl(track, quality);
        if (platform === 'tx') return await txOfficialUrl(track, quality);
        if (platform === 'kg') return await kgOfficialUrl(track, quality);
        return null;
    } catch {
        return null;
    }
}

