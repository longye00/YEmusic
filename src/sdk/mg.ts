/** 咪咕音乐（接口参考 lx-music-desktop，Apache-2.0）。 */
import { requestJson, requestText } from '@/lib/http';
import { md5 } from '@/lib/md5';
import { decodeEntities, parseDuration } from '@/lib/util';
import { sizeFormat, sortQualities, trackKey, type Board, type PlatformSdk, type QualityInfo, type Track } from './types';

const MOBILE_UA = 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';

function img(url: string | undefined) {
    if (!url) return undefined;
    return /^https?:/.test(url) ? url.replace(/^http:/, 'https:') : `https://d.musicapp.migu.cn${url}`;
}

function parseFormats(formats: any[] | undefined): QualityInfo[] {
    const list: QualityInfo[] = [];
    for (const f of formats || []) {
        const size = sizeFormat(f.asize ?? f.androidSize ?? f.isize ?? f.size);
        if (f.formatType === 'PQ') list.push({ type: '128k', size });
        else if (f.formatType === 'HQ') list.push({ type: '320k', size });
        else if (f.formatType === 'SQ') list.push({ type: 'flac', size });
        else if (f.formatType === 'ZQ24' || f.formatType === 'ZQ') list.push({ type: 'flac24bit', size });
    }
    return sortQualities(list.length ? list : [{ type: '128k' }]);
}

/** jadeite 搜索 / 歌单详情返回的歌曲结构 */
function fromSong(data: any): Track | null {
    if (!data?.songId || !data.copyrightId) return null;
    const singers = Array.isArray(data.singerList) ? data.singerList.map((s: any) => s.name) : String(data.singer || '').split('|');
    return {
        id: trackKey('mg', data.songId),
        source: 'mg',
        songmid: String(data.songId),
        name: decodeEntities(data.name || data.songName),
        singer: decodeEntities(singers.filter(Boolean).join('、')),
        album: decodeEntities(data.album || ''),
        albumId: String(data.albumId || ''),
        duration: Number(data.duration) || parseDuration(data.length),
        cover: img(data.img3 || data.img2 || data.img1 || data.albumImgs?.[0]?.img),
        qualities: parseFormats(data.audioFormats || data.newRateFormats || data.rateFormats),
        meta: { copyrightId: String(data.copyrightId), lrcUrl: data.lrcUrl, mrcUrl: data.mrcurl || data.mrcUrl, trcUrl: data.trcUrl },
    };
}

async function getMusicInfo(copyrightId: string) {
    const body = await requestJson(`https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${copyrightId}&resourceType=2`, { headers: { 'User-Agent': MOBILE_UA } });
    return body?.resource?.[0];
}

const BOARDS: [string, string][] = [
    ['27553319', '尖叫新歌榜'], ['27186466', '热歌榜'], ['27553408', '原创榜'], ['75959118', '音乐风向榜'], ['76557036', '彩铃分贝榜'],
    ['76557745', '会员臻爱榜'], ['23189800', '港台榜'], ['23189399', '内地榜'], ['19190036', '欧美榜'], ['83176390', '国风金曲榜'],
];

function collectPlaylists(node: any, out: Map<string, any>) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) collectPlaylists(item, out);
        return;
    }
    if (node.view === 'ZJ-SongList-Item' && node.resId && !out.has(node.resId)) out.set(node.resId, node);
    for (const value of Object.values(node)) if (value && typeof value === 'object') collectPlaylists(value, out);
}

export const mg: PlatformSdk = {
    id: 'mg',
    name: '咪咕',
    async search(keyword, page = 1, limit = 30) {
        const time = Date.now().toString();
        const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
        const sign = md5(`${keyword}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`);
        const body = await requestJson(
            `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(keyword)}&pageNo=${page}&sort=0&sid=USS`,
            { headers: { uiVersion: 'A_music_3.6.1', deviceId, timestamp: time, sign, channel: '0146921', 'User-Agent': MOBILE_UA } },
        );
        if (body?.code !== '000000') throw new Error(body?.info || '搜索失败');
        const seen = new Set<string>();
        const list: Track[] = [];
        for (const group of body.songResultData?.resultList || []) {
            for (const item of group) {
                const track = fromSong(item);
                if (!track || seen.has(track.meta!.copyrightId!)) continue;
                seen.add(track.meta!.copyrightId!);
                list.push(track);
            }
        }
        return { list, total: Number(body.songResultData?.totalCount) || list.length, page, limit, source: 'mg' as const };
    },
    async getLyric(track) {
        let { lrcUrl, trcUrl } = track.meta || {};
        if (!lrcUrl && track.meta?.copyrightId) {
            const info = await getMusicInfo(track.meta.copyrightId).catch(() => null);
            lrcUrl = info?.lrcUrl;
            trcUrl = info?.trcUrl;
        }
        if (!lrcUrl) throw new Error('暂无歌词');
        const [lyric, tlyric] = await Promise.all([
            requestText(lrcUrl.replace(/^http:/, 'https:'), { headers: { 'User-Agent': MOBILE_UA } }),
            trcUrl ? requestText(trcUrl.replace(/^http:/, 'https:')).catch(() => '') : Promise.resolve(''),
        ]);
        return { lyric, tlyric };
    },
    boards: BOARDS.map(([bangid, name]) => ({ id: `mg__${bangid}`, source: 'mg', name, bangid }) as Board),
    async getBoardList(bangid, page = 1) {
        const body = await requestJson(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${bangid}&needAll=0`, { headers: { 'User-Agent': MOBILE_UA } });
        const info = body?.columnInfo;
        const list = (info?.contents || []).map((c: any) => fromSong(c.objectInfo)).filter(Boolean) as Track[];
        return { list, total: list.length, page, limit: list.length || 1, info: { name: info?.columnTitle, cover: info?.columnPicUrl, desc: info?.columnDes } };
    },
    songListSorts: [{ id: 'recommend', name: '推荐' }],
    async getSongLists(_sortId, page = 1) {
        const body = await requestJson(`https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`, { headers: { 'User-Agent': MOBILE_UA } });
        const map = new Map<string, any>();
        collectPlaylists(body?.data, map);
        return {
            list: [...map.values()].map(item => ({
                id: String(item.resId),
                source: 'mg' as const,
                name: decodeEntities(item.txt),
                cover: img(item.img),
                desc: item.txt2,
                playCount: 0,
            })),
            total: map.size * 10,
            page,
            limit: Math.max(map.size, 1),
        };
    },
    async getSongListDetail(id, page = 1) {
        const limit = 50;
        const [songs, info] = await Promise.all([
            requestJson(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${limit}&playlistId=${id}`, { headers: { 'User-Agent': MOBILE_UA } }),
            page === 1 ? requestJson(`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${id}`, { headers: { 'User-Agent': MOBILE_UA } }).catch(() => null) : Promise.resolve(null),
        ]);
        const list = (songs?.data?.songList || []).map(fromSong).filter(Boolean) as Track[];
        const data = info?.data;
        return {
            list,
            total: Number(songs?.data?.totalCount) || list.length,
            page,
            limit,
            info: data ? { name: data.title, cover: data.imgItem?.img, desc: data.summary, author: data.ownerName, playCount: Number(data.opNumItem?.playNum) || 0 } : undefined,
        };
    },
};
