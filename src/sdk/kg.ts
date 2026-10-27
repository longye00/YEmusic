/** 酷狗音乐（接口参考 lx-music-desktop，Apache-2.0）。 */
import { requestJson } from '@/lib/http';
import { base64Decode, utf8Decode } from '@/lib/bytes';
import { inflate } from '@/lib/zlib';
import { decodeEntities } from '@/lib/util';
import { kgCollectionSongs } from './kgAuth';
import { sizeFormat, sortQualities, trackKey, type Board, type PlatformSdk, type QualityInfo, type RawLyric, type Track } from './types';

const KG_HEADERS = {
    'KG-RC': '1',
    'KG-THash': 'expand_search_manager.cpp:852736169:451',
    'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
};

function cover(url: string | undefined, size = 480) {
    if (!url) return undefined;
    return String(url).replace('{size}', String(size)).replace(/^http:/, 'https:');
}

function splitFilename(filename: string) {
    const text = decodeEntities(filename || '');
    const index = text.indexOf(' - ');
    if (index < 0) return { singer: '', name: text };
    return { singer: text.slice(0, index), name: text.slice(index + 3) };
}

function q(type: QualityInfo['type'], size: number | string | undefined, hash: string | undefined): QualityInfo | null {
    if (!hash || !Number(size)) return null;
    return { type, size: sizeFormat(size), hash: String(hash) };
}

function fromSearch(raw: any): Track {
    const qualities = sortQualities(
        [q('128k', raw.FileSize, raw.FileHash), q('320k', raw.HQFileSize, raw.HQFileHash), q('flac', raw.SQFileSize, raw.SQFileHash), q('flac24bit', raw.ResFileSize, raw.ResFileHash)].filter(Boolean) as QualityInfo[],
    );
    const singer = Array.isArray(raw.Singers) && raw.Singers.length ? raw.Singers.map((s: any) => s.name).join('、') : raw.SingerName;
    return {
        id: trackKey('kg', raw.Audioid),
        source: 'kg',
        songmid: String(raw.Audioid),
        name: decodeEntities(`${raw.OriSongName || raw.SongName}${raw.Suffix ? ` ${raw.Suffix}` : ''}`),
        singer: decodeEntities(singer || ''),
        album: decodeEntities(raw.AlbumName || ''),
        albumId: String(raw.AlbumID || ''),
        duration: Number(raw.Duration) || 0,
        cover: cover(raw.Image || raw.trans_param?.union_cover),
        qualities,
        meta: { hash: raw.FileHash, albumAudioId: raw.MixSongID },
    };
}

function fromRank(raw: any): Track {
    const { singer, name } = splitFilename(raw.filename);
    const qualities = sortQualities(
        [q('128k', raw.filesize, raw.hash), q('320k', raw['320filesize'], raw['320hash']), q('flac', raw.sqfilesize, raw.sqhash)].filter(Boolean) as QualityInfo[],
    );
    const songmid = String(raw.audio_id || raw.album_audio_id || raw.hash);
    return {
        id: trackKey('kg', songmid),
        source: 'kg',
        songmid,
        name: decodeEntities(raw.songname || name),
        singer: singer || (raw.authors || []).map((a: any) => a.author_name).join('、'),
        album: decodeEntities(raw.remark || raw.album_name || ''),
        albumId: String(raw.album_id || ''),
        duration: Math.round(Number(raw.duration) > 10000 ? Number(raw.duration) / 1000 : Number(raw.duration)) || 0,
        cover: cover(raw.trans_param?.union_cover || raw.album_sizable_cover),
        qualities: qualities.length ? qualities : [{ type: '128k', hash: raw.hash }],
        meta: { hash: raw.hash, albumAudioId: raw.album_audio_id },
    };
}

/** 网关歌单（global_collection_id）里的歌曲 */
function fromCollection(raw: any): Track {
    const { singer, name } = splitFilename(raw.name);
    const goods: any[] = Array.isArray(raw.relate_goods) ? raw.relate_goods : [];
    const level = (n: number) => goods.find(g => Number(g?.level) === n);
    const g128 = level(2) || goods.find(g => Number(g?.bitrate) === 128) || { hash: raw.hash, size: raw.size };
    const g320 = level(4) || goods.find(g => Number(g?.bitrate) === 320);
    const gflac = level(5);
    const ghires = level(6);
    const qualities = sortQualities(
        [q('128k', g128?.size, g128?.hash), q('320k', g320?.size, g320?.hash), q('flac', gflac?.size, gflac?.hash), q('flac24bit', ghires?.size, ghires?.hash)].filter(Boolean) as QualityInfo[],
    );
    const songmid = String(raw.audio_id || raw.mixsongid || raw.hash);
    const singers = Array.isArray(raw.singerinfo) ? raw.singerinfo.map((s: any) => s?.name).filter(Boolean).join('、') : '';
    return {
        id: trackKey('kg', songmid),
        source: 'kg',
        songmid,
        name: decodeEntities(name || raw.name || ''),
        singer: decodeEntities(singer || singers),
        album: decodeEntities(raw.albuminfo?.name || ''),
        albumId: String(raw.album_id || raw.albuminfo?.id || ''),
        duration: Math.round((Number(raw.timelen) || 0) / 1000),
        cover: cover(raw.cover || raw.trans_param?.union_cover),
        qualities: qualities.length ? qualities : [{ type: '128k', hash: raw.hash }],
        meta: { hash: raw.hash, albumAudioId: raw.mixsongid || raw.album_audio_id },
    };
}

const KRC_KEY = new Uint8Array([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);

async function decodeKrc(content: string): Promise<RawLyric> {
    const data = base64Decode(content).subarray(4);
    const xored = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) xored[i] = data[i] ^ KRC_KEY[i % 16];
    let text = utf8Decode(await inflate(xored)).replace(/\r/g, '');
    text = text.replace(/^.*\[id:\$\w+\]\n/, '');
    let tlyric: string[] | null = null;
    let rlyric: string[] | null = null;
    const lang = /\[language:([\w=\\/+]+)\]/.exec(text);
    if (lang) {
        text = text.replace(/\[language:[\w=\\/+]+\]\n?/, '');
        try {
            const json = JSON.parse(utf8Decode(base64Decode(lang[1])));
            for (const item of json.content || []) {
                if (item.type === 0) rlyric = item.lyricContent;
                else if (item.type === 1) tlyric = item.lyricContent;
            }
        } catch {
            // 忽略损坏的翻译信息
        }
    }
    let index = 0;
    const tl: string[] = [];
    const rl: string[] = [];
    const lx = text.replace(/\[((\d+),\d+)\].*/g, line => {
        const m = /\[((\d+),\d+)\].*/.exec(line)!;
        const ms = parseInt(m[2]);
        const time = `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
        if (tlyric) tl.push(`[${time}]${(tlyric[index] as unknown as string[])?.join('') ?? ''}`);
        if (rlyric) rl.push(`[${time}]${(rlyric[index] as unknown as string[])?.join('') ?? ''}`);
        index++;
        return line.replace(m[1], time);
    });
    const lxlyric = decodeEntities(lx.replace(/<(\d+,\d+),\d+>/g, '<$1>'));
    return {
        lyric: lxlyric.replace(/<\d+,\d+>/g, ''),
        tlyric: decodeEntities(tl.join('\n')),
        rlyric: decodeEntities(rl.join('\n')),
        lxlyric,
    };
}

const BOARDS: [string, string][] = [
    ['8888', 'TOP500'], ['6666', '飙升榜'], ['59703', '蜂鸟流行音乐榜'], ['52144', '抖音热歌榜'], ['52767', '快手热歌榜'], ['24971', 'DJ热歌榜'],
    ['23784', '网络红歌榜'], ['44412', '说唱先锋榜'], ['31308', '内地榜'], ['33160', '电音榜'], ['31313', '香港地区榜'], ['51341', '民谣榜'],
    ['54848', '台湾地区榜'], ['31310', '欧美榜'], ['33162', 'ACG新歌榜'], ['31311', '韩国榜'], ['31312', '日本榜'], ['33165', '粤语金曲榜'],
    ['33163', '影视金曲榜'], ['51340', '伤感榜'],
];

export const kg: PlatformSdk = {
    id: 'kg',
    name: '酷狗',
    async search(keyword, page = 1, limit = 30) {
        let body: any = null;
        for (let i = 0; i < 2; i++) {
            body = await requestJson(`http://songsearch.kugou.com/song_search_v2?platform=AndroidFilter&iscorrection=1&keyword=${encodeURIComponent(keyword)}&hifiquality=0&pagesize=${limit}&PrivilegeFilter=0&page=${page}`).catch(() => null);
            if (body?.error_code === 0 && body?.data?.lists?.length) break;
        }
        if (!body?.data?.lists?.length) {
            // song_search_v2 经常返回 total=0 的“降级”空结果（并不报错），此时改用移动端搜索接口
            const alt = await requestJson(`http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&showtype=1`).catch(() => null);
            const info: any[] = alt?.data?.info || [];
            if (info.length) {
                const seenAlt = new Set<string>();
                const listAlt = info
                    // 与 song_search_v2 保持一致：hash 统一为大写
                    .map(raw => fromRank({ ...raw, songname: raw.songname_original || raw.songname, remark: raw.album_name, hash: String(raw.hash || '').toUpperCase(), '320hash': String(raw['320hash'] || '').toUpperCase(), sqhash: String(raw.sqhash || '').toUpperCase() }))
                    .filter(track => (seenAlt.has(track.id) ? false : (seenAlt.add(track.id), true)));
                return { list: listAlt, total: Number(alt.data.total) || listAlt.length, page, limit, source: 'kg' as const };
            }
        }
        const seen = new Set<string>();
        const list: Track[] = [];
        for (const item of body?.data?.lists || []) {
            for (const raw of [item, ...(item.Grp || [])]) {
                const key = `${raw.Audioid}${raw.FileHash}`;
                if (seen.has(key)) continue;
                seen.add(key);
                list.push(fromSearch(raw));
            }
        }
        return { list, total: Number(body?.data?.total) || list.length, page, limit, source: 'kg' as const };
    },
    async getLyric(track) {
        const hash = track.meta?.hash || track.qualities?.find(item => item.type === '128k')?.hash || '';
        const search = await requestJson(`http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(track.name)}&hash=${hash}&timelength=${Math.round(track.duration * 1000)}&lrctxt=1`, { headers: KG_HEADERS });
        const candidate = search?.candidates?.[0];
        if (!candidate) throw new Error('暂无歌词');
        const fmt = candidate.krctype == 1 && candidate.contenttype != 1 ? 'krc' : 'lrc';
        const body = await requestJson(`http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=${fmt}&charset=utf8`, { headers: KG_HEADERS });
        if (body?.fmt === 'krc') return decodeKrc(body.content);
        if (body?.fmt === 'lrc') return { lyric: utf8Decode(base64Decode(body.content)) };
        throw new Error('歌词格式未知');
    },
    boards: BOARDS.map(([bangid, name]) => ({ id: `kg__${bangid}`, source: 'kg', name, bangid }) as Board),
    async getBoardList(bangid, page = 1) {
        const limit = 100;
        const body = await requestJson(`http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=${limit}&area_code=1&page=${page}&rankid=${bangid}&with_res_tag=0&show_portrait_mv=1`);
        const list = (body?.data?.info || []).map(fromRank);
        return { list, total: Number(body?.data?.total) || list.length, page, limit };
    },
    songListSorts: [
        { id: '5', name: '推荐' },
        { id: '6', name: '最热' },
        { id: '7', name: '最新' },
        { id: '8', name: '飙升' },
    ],
    async getSongLists(sortId = '5', page = 1) {
        const body = await requestJson(`http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_ajax=1&cdn=cdn&t=${sortId}&c=&p=${page}`);
        const list = (body?.special_db || []).map((item: any) => ({
            id: String(item.specialid),
            source: 'kg' as const,
            name: decodeEntities(item.specialname),
            cover: cover(item.img, 400),
            playCount: parseCount(item.total_play_count ?? item.play_count),
            author: item.nickname,
            desc: item.intro,
        }));
        return { list, total: 30 * 50, page, limit: 30 };
    },
    async getSongListDetail(id, page = 1) {
        const limit = 100;
        if (id.startsWith('collection_')) {
            const { count, info, songs } = await kgCollectionSongs(id, page, limit);
            const list = songs.map(fromCollection);
            return {
                list,
                total: count || list.length,
                page,
                limit,
                info: page === 1 ? { name: decodeEntities(info.name || ''), cover: cover(info.pic, 400), desc: info.intro ? decodeEntities(info.intro) : undefined, author: info.list_create_username } : undefined,
            };
        }
        const [songs, info] = await Promise.all([
            requestJson(`http://mobilecdnbj.kugou.com/api/v3/special/song?specialid=${id}&page=${page}&pagesize=${limit}&plat=2&version=8000&area_code=1`),
            page === 1 ? requestJson(`http://mobilecdnbj.kugou.com/api/v3/special/info?specialid=${id}`).catch(() => null) : Promise.resolve(null),
        ]);
        const list = (songs?.data?.info || []).map(fromRank);
        const data = info?.data;
        return {
            list,
            total: Number(songs?.data?.total) || list.length,
            page,
            limit,
            info: data ? { name: data.specialname, cover: cover(data.imgurl, 400), desc: data.intro, author: data.nickname, playCount: data.playcount } : undefined,
        };
    },
};

function parseCount(value: unknown): number {
    const text = String(value ?? '');
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return 0;
    if (text.includes('亿')) return n * 1e8;
    if (text.includes('万')) return n * 1e4;
    return n;
}
