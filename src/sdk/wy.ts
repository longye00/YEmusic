/** 网易云音乐（接口参考 lx-music-desktop，Apache-2.0）。 */
import { encodeForm, requestJson } from '@/lib/http';
import { decodeEntities } from '@/lib/util';
import { sizeFormat, sortQualities, trackKey, type Board, type PlatformSdk, type QualityInfo, type RawLyric, type Track } from './types';
import { wyHeaders } from './wyAuth';

export function fromSong(item: any, privilege?: any): Track {
    const qualities: QualityInfo[] = [];
    const priv = privilege || item.privilege || {};
    const maxbr = Number(priv.maxbr || 0);
    if (priv.maxBrLevel === 'hires' || item.hr) qualities.push({ type: 'flac24bit', size: sizeFormat(item.hr?.size) });
    if (maxbr >= 999000 || item.sq) qualities.push({ type: 'flac', size: sizeFormat(item.sq?.size) });
    if (maxbr >= 320000 || item.h) qualities.push({ type: '320k', size: sizeFormat(item.h?.size) });
    qualities.push({ type: '128k', size: sizeFormat(item.l?.size || item.m?.size) });
    const album = item.al || item.album || {};
    return {
        id: trackKey('wy', item.id),
        source: 'wy',
        songmid: String(item.id),
        name: decodeEntities(item.name),
        singer: decodeEntities((item.ar || item.artists || []).map((a: any) => a.name).join('、')),
        album: decodeEntities(album.name || ''),
        albumId: String(album.id || ''),
        duration: Math.round(Number(item.dt ?? item.duration ?? 0) / 1000),
        cover: album.picUrl ? `${String(album.picUrl).replace(/^http:/, 'https:')}?param=500y500` : undefined,
        qualities: sortQualities(qualities),
    };
}

async function songDetails(ids: (number | string)[]): Promise<Track[]> {
    const result: Track[] = [];
    for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        const body = await requestJson('https://music.163.com/api/v3/song/detail', {
            body: encodeForm({ c: JSON.stringify(chunk.map(id => ({ id }))) }),
            method: 'POST',
            headers: wyHeaders({ 'content-type': 'application/x-www-form-urlencoded' }),
        });
        const privileges = new Map((body?.privileges || []).map((p: any) => [p.id, p]));
        for (const song of body?.songs || []) result.push(fromSong(song, privileges.get(song.id)));
    }
    return result;
}

async function playlistDetail(id: string, page: number) {
    const limit = 1000;
    const body = await requestJson(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=100000&s=8`, { headers: wyHeaders() });
    const playlist = body?.playlist;
    if (!playlist) throw new Error(body?.message || '歌单获取失败');
    const ids: number[] = (playlist.trackIds || []).map((t: any) => t.id);
    const pageIds = ids.slice((page - 1) * limit, page * limit);
    const privileges = new Map((body.privileges || []).map((p: any) => [p.id, p]));
    const loaded = new Map<number, Track>();
    for (const t of playlist.tracks || []) loaded.set(t.id, fromSong(t, privileges.get(t.id)));
    const missing = pageIds.filter(trackId => !loaded.has(trackId));
    if (missing.length) for (const t of await songDetails(missing)) loaded.set(Number(t.songmid), t);
    const list = pageIds.map(trackId => loaded.get(trackId)).filter(Boolean) as Track[];
    return {
        list,
        total: ids.length,
        page,
        limit,
        info: {
            name: decodeEntities(playlist.name),
            cover: playlist.coverImgUrl ? `${String(playlist.coverImgUrl).replace(/^http:/, 'https:')}?param=600y600` : undefined,
            desc: playlist.description,
            author: playlist.creator?.nickname,
            playCount: playlist.playCount,
        },
    };
}

const BOARDS: [string, string][] = [
    ['19723756', '飙升榜'], ['3779629', '新歌榜'], ['2884035', '原创榜'], ['3778678', '热歌榜'], ['991319590', '说唱榜'],
    ['71384707', '古典榜'], ['1978921795', '电音榜'], ['5453912201', '黑胶VIP爱听榜'], ['71385702', 'ACG榜'], ['745956260', '韩语榜'],
    ['10520166', '国电榜'], ['180106', 'UK排行榜周榜'], ['60198', '美国Billboard榜'], ['21845217', 'KTV唛榜'], ['60131', '日本Oricon榜'],
    ['2809513713', '欧美热歌榜'], ['5059644681', '日语榜'], ['5059633707', '摇滚榜'], ['5059642708', '国风榜'], ['5059661515', '民谣榜'],
];

/** 网易云 yrc：`[行起始ms,行时长ms](字起始ms,字时长ms,0)字…` → lxlyric（相对时间） */
function yrcToLx(yrc: string): string {
    const out: string[] = [];
    for (const line of yrc.split(/\r?\n/)) {
        const m = /^\[(\d+),(\d+)\](.*)$/.exec(line.trim());
        if (!m) continue;
        const start = Number(m[1]);
        const time = `${String(Math.floor(start / 60000)).padStart(2, '0')}:${String(Math.floor((start % 60000) / 1000)).padStart(2, '0')}.${String(start % 1000).padStart(3, '0')}`;
        const words = m[3].replace(/\((\d+),(\d+),\d+\)/g, (_, ws, wd) => `<${Math.max(0, Number(ws) - start)},${wd}>`);
        out.push(`[${time}]${words}`);
    }
    return out.join('\n');
}

const stripCredits = (text: string) => String(text || '').split('\n').filter(line => !line.trim().startsWith('{')).join('\n');

export const wy: PlatformSdk = {
    id: 'wy',
    name: '网易云',
    async search(keyword, page = 1, limit = 30) {
        const body = await requestJson('https://music.163.com/api/cloudsearch/pc', {
            form: { s: keyword, type: 1, limit, offset: (page - 1) * limit, total: true },
            headers: wyHeaders(),
        });
        if (body?.code !== 200) throw new Error(body?.msg || body?.message || '搜索失败');
        const list = (body.result?.songs || []).map((song: any) => fromSong(song, song.privilege));
        return { list, total: Number(body.result?.songCount) || list.length, page, limit, source: 'wy' as const };
    },
    async getLyric(track) {
        const body = await requestJson(`https://music.163.com/api/song/lyric/v1?id=${track.songmid}&lv=-1&tv=-1&rv=-1&yv=-1&kv=-1&cp=false`, { headers: wyHeaders() });
        if (body?.code !== 200) throw new Error('歌词获取失败');
        const lyric = stripCredits(body.lrc?.lyric || '');
        const yrc = stripCredits(body.yrc?.lyric || '');
        if (!lyric.trim() && !yrc.trim()) throw new Error(body.nolyric || body.pureMusic ? '纯音乐，请欣赏' : '暂无歌词');
        const result: RawLyric = {
            lyric,
            tlyric: stripCredits(body.tlyric?.lyric || ''),
            rlyric: stripCredits(body.romalrc?.lyric || ''),
            lxlyric: yrc ? yrcToLx(yrc) : '',
        };
        return result;
    },
    boards: BOARDS.map(([bangid, name]) => ({ id: `wy__${bangid}`, source: 'wy', name, bangid }) as Board),
    getBoardList: (bangid, page = 1) => playlistDetail(bangid, page),
    songListSorts: [
        { id: 'hot', name: '最热' },
        { id: 'new', name: '最新' },
    ],
    async getSongLists(sortId = 'hot', page = 1) {
        const limit = 30;
        const body = await requestJson(`https://music.163.com/api/playlist/list?cat=${encodeURIComponent('全部')}&order=${sortId}&limit=${limit}&offset=${(page - 1) * limit}&total=true`, { headers: wyHeaders() });
        return {
            list: (body?.playlists || []).map((item: any) => ({
                id: String(item.id),
                source: 'wy' as const,
                name: decodeEntities(item.name),
                cover: item.coverImgUrl ? `${String(item.coverImgUrl).replace(/^http:/, 'https:')}?param=400y400` : undefined,
                playCount: item.playCount,
                author: item.creator?.nickname,
                desc: item.description,
                total: item.trackCount,
            })),
            total: Number(body?.total) || 0,
            page,
            limit,
        };
    },
    getSongListDetail: (id, page = 1) => playlistDetail(id, page),
    async hotSearch() {
        const body = await requestJson('https://music.163.com/api/search/hot?type=1111', { headers: wyHeaders() }).catch(() => null);
        return (body?.result?.hots || []).map((item: any) => item.first).filter(Boolean);
    },
};
