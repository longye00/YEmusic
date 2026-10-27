/** 酷我音乐（接口参考 lx-music-desktop，Apache-2.0）。 */
import { requestJson, requestRaw, requestText } from '@/lib/http';
import { base64Decode, utf8Decode, utf8Encode } from '@/lib/bytes';
import { inflate } from '@/lib/zlib';
import { decodeEntities } from '@/lib/util';
import { sortQualities, trackKey, type Board, type ListDetail, type PlatformSdk, type QualityInfo, type RawLyric, type Track } from './types';

const M_INFO = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;

function parseMinfo(minfo: string): QualityInfo[] {
    const list: QualityInfo[] = [];
    for (const part of String(minfo || '').split(';')) {
        const m = M_INFO.exec(part);
        if (!m) continue;
        const size = m[4].toUpperCase();
        if (m[2] === '4000') list.push({ type: 'flac24bit', size });
        else if (m[2] === '2000') list.push({ type: 'flac', size });
        else if (m[2] === '320') list.push({ type: '320k', size });
        else if (m[2] === '128') list.push({ type: '128k', size });
    }
    return sortQualities(list);
}

function parseFormats(formats: string): QualityInfo[] {
    const f = String(formats || '');
    const list: QualityInfo[] = [{ type: '128k' }];
    if (f.includes('MP3H')) list.push({ type: '320k' });
    if (f.includes('ALFLAC')) list.push({ type: 'flac' });
    if (f.includes('HIRFLAC')) list.push({ type: 'flac24bit' });
    return sortQualities(list);
}

const formatSinger = (text: string) => decodeEntities(text).replace(/&/g, '、');

function albumPic(short: string | undefined) {
    if (!short) return undefined;
    return `https://img1.kwcdn.kuwo.cn/star/albumcover/500/${String(short).replace(/^\d+\//, '')}`;
}

function makeTrack(raw: { id: string; name: string; singer: string; album: string; albumId?: string; duration: number; cover?: string; qualities: QualityInfo[] }): Track {
    return {
        id: trackKey('kw', raw.id),
        source: 'kw',
        songmid: String(raw.id),
        name: decodeEntities(raw.name),
        singer: formatSinger(raw.singer),
        album: decodeEntities(raw.album || ''),
        albumId: raw.albumId ? String(raw.albumId) : '',
        duration: Number(raw.duration) || 0,
        cover: raw.cover,
        qualities: raw.qualities,
    };
}

// ---------- 歌词（lrcx 逐字） ----------
const KEY = utf8Encode('yeelion');

async function decodeLrcx(raw: Uint8Array): Promise<string> {
    const head = utf8Decode(raw.subarray(0, 10)).toLowerCase();
    if (head !== 'tp=content') return '';
    let index = -1;
    for (let i = 0; i < raw.length - 3; i++) {
        if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) { index = i + 4; break; }
    }
    if (index < 0) return '';
    const inflated = await inflate(raw.subarray(index));
    const data = base64Decode(latin1Decode(inflated));
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ KEY[i % KEY.length];
    return utf8Decode(out);
}

function latin1Decode(bytes: Uint8Array) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return s;
}

const TIME_EXP = /^\[([\d:.]+)\]/;
const WORD_TIME = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;

/** 把 lrcx 转成 lxlyric（逐字时间相对行首，毫秒），并拆分翻译。 */
function parseKwLyric(text: string): RawLyric {
    let offset = 1;
    let offset2 = 1;
    const lines: { time: string; text: string }[] = [];
    const tags: string[] = [];
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
        const line = rawLine.trim();
        const tag = /^\[(ver|ti|ar|al|offset|by|kuwo):\s*(.*?)\s*\]$/.exec(line);
        if (tag) {
            if (tag[1] === 'kuwo') {
                const value = parseInt(tag[2], 8);
                offset = Math.trunc(value / 10);
                offset2 = Math.trunc(value % 10);
            } else {
                tags.push(line);
            }
            continue;
        }
        const t = TIME_EXP.exec(line);
        if (!t) continue;
        let time = t[1];
        if (/\.\d\d$/.test(time)) time += '0';
        lines.push({ time, text: line.slice(t[0].length).trim() });
    }
    // 翻译行与下一句原文同时间戳：遇到重复时间时，前一行是上一句的翻译
    const seen = new Set<string>();
    const lrc: { time: string; text: string }[] = [];
    const trans: { time: string; text: string }[] = [];
    for (const item of lines) {
        if (seen.has(item.time)) {
            if (lrc.length < 2) continue;
            const t = lrc.pop()!;
            t.time = lrc[lrc.length - 1].time;
            trans.push(t);
            lrc.push(item);
        } else {
            lrc.push(item);
            seen.add(item.time);
        }
    }
    const wordsOk = offset > 0 && offset2 > 0;
    const lxLines: string[] = [];
    const plainLines: string[] = [];
    for (const item of lrc) {
        plainLines.push(`[${item.time}]${item.text.replace(WORD_TIME, '')}`);
        if (!wordsOk) continue;
        let prev: { start: number; end: number } | null = null;
        let lx = '';
        const parts = item.text.split(/(<-?\d+,-?\d+(?:,-?\d+)?>)/).filter(Boolean);
        const words: { start: number; end: number; text: string }[] = [];
        let current: { start: number; end: number; text: string } | null = null;
        for (const part of parts) {
            const m = /^<(-?\d+),(-?\d+)(?:,-?\d+)?>$/.exec(part);
            if (m) {
                const o1 = parseInt(m[1]);
                const o2 = parseInt(m[2]);
                const start = Math.trunc(Math.abs((o1 + o2) / (offset * 2)));
                const end = Math.trunc(Math.abs((o1 - o2) / (offset2 * 2))) + start;
                if (prev && start < prev.end) prev.end = Math.max(prev.start, start);
                current = { start, end, text: '' };
                words.push(current);
                prev = current;
            } else if (current) {
                current.text += part;
            }
        }
        for (const w of words) lx += `<${w.start},${Math.max(0, w.end - w.start)}>${w.text}`;
        if (lx) lxLines.push(`[${item.time}]${lx}`);
    }
    const head = tags.length ? `${tags.join('\n')}\n` : '';
    return {
        lyric: decodeEntities(head + plainLines.join('\n')),
        tlyric: trans.length ? decodeEntities(trans.map(t => `[${t.time}]${t.text.replace(WORD_TIME, '')}`).join('\n')) : '',
        lxlyric: lxLines.length ? decodeEntities(lxLines.join('\n')) : '',
    };
}

const BOARDS: [string, string][] = [
    ['93', '飙升榜'], ['17', '新歌榜'], ['16', '热歌榜'], ['158', '抖音热歌榜'], ['187', '流行趋势榜'], ['26', '经典怀旧榜'],
    ['104', '华语榜'], ['182', '粤语榜'], ['22', '欧美榜'], ['184', '韩语榜'], ['183', '日语榜'], ['145', '会员畅听榜'],
    ['153', '网红新歌榜'], ['64', '影视金曲榜'], ['176', 'DJ嗨歌榜'], ['278', '古风音乐榜'], ['242', '电音榜'], ['185', '最强翻唱榜'],
    ['12', 'Billboard榜'], ['13', '英国UK榜'],
];

export const kw: PlatformSdk = {
    id: 'kw',
    name: '酷我',
    async search(keyword, page = 1, limit = 30) {
        const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
        let body: any = null;
        for (let i = 0; i < 3; i++) {
            body = await requestJson(url);
            if (body && !(body.TOTAL !== '0' && body.SHOW === '0')) break;
        }
        const list = (body?.abslist || []).map((item: any) =>
            makeTrack({
                id: String(item.MUSICRID || '').replace('MUSIC_', ''),
                name: item.SONGNAME || item.NAME,
                singer: item.ARTIST,
                album: item.ALBUM,
                albumId: item.ALBUMID,
                duration: parseInt(item.DURATION) || 0,
                cover: albumPic(item.web_albumpic_short),
                qualities: parseMinfo(item.N_MINFO || item.MINFO),
            }),
        );
        return { list, total: parseInt(body?.TOTAL) || list.length, page, limit, source: 'kw' as const };
    },
    async getLyric(track) {
        const res = await requestRaw(`http://mlyric.kuwo.cn/mobi.s?f=web&type=lyric&lrcx=1&rid=${track.songmid}&encode=utf8`);
        if (!res.ok || !res.bytes) throw new Error('歌词获取失败');
        const text = await decodeLrcx(res.bytes);
        if (!text) throw new Error('暂无歌词');
        return parseKwLyric(text);
    },
    async getPic(track) {
        const text = await requestText(`http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${track.songmid}`);
        if (!/^http/.test(text.trim())) throw new Error('封面获取失败');
        return text.trim().replace(/^http:/, 'https:');
    },
    boards: BOARDS.map(([bangid, name]) => ({ id: `kw__${bangid}`, source: 'kw', name, bangid }) as Board),
    async getBoardList(bangid, page = 1) {
        const limit = 100;
        const body = await requestJson(`http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${page - 1}&rn=${limit}&type=bang&data=content&id=${bangid}&show_copyright_off=0&pcmp4=1&isbang=1`);
        const list = (body?.musiclist || []).map((item: any) =>
            makeTrack({
                id: item.id,
                name: item.name,
                singer: item.artist,
                album: item.album,
                albumId: item.albumid,
                duration: parseInt(item.song_duration) || 0,
                qualities: parseFormats(item.formats),
            }),
        );
        return {
            list,
            total: parseInt(body?.num) || list.length,
            page,
            limit,
            info: { name: body?.name, desc: body?.info, cover: body?.pic && /\.(jpe?g|png)$/i.test(body.pic) ? body.pic : undefined },
        } as ListDetail;
    },
    songListSorts: [
        { id: 'hot', name: '最热' },
        { id: 'new', name: '最新' },
    ],
    async getSongLists(sortId = 'hot', page = 1) {
        const limit = 30;
        const body = await requestJson(`http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&rn=${limit}&order=${sortId}`);
        const data = body?.data || {};
        return {
            list: (data.data || []).map((item: any) => ({
                id: String(item.id),
                source: 'kw' as const,
                name: decodeEntities(item.name),
                cover: item.img,
                playCount: Number(item.listencnt) || 0,
                author: item.uname,
                desc: item.desc,
                total: Number(item.total) || 0,
            })),
            total: Number(data.total) || 0,
            page,
            limit,
        };
    },
    async getSongListDetail(id, page = 1) {
        const limit = 100;
        const body = await requestJson(`http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page - 1}&rn=${limit}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`);
        const list = (body?.musiclist || []).map((item: any) =>
            makeTrack({
                id: item.id,
                name: item.name,
                singer: item.artist,
                album: item.album,
                albumId: item.albumid,
                duration: parseInt(item.duration) || 0,
                qualities: parseMinfo(item.N_MINFO || item.MINFO),
            }),
        );
        return {
            list,
            total: Number(body?.total) || list.length,
            page,
            limit,
            info: { name: decodeEntities(body?.title), cover: body?.pic, desc: decodeEntities(String(body?.info || '').replace(/<br>/g, '\n')), author: body?.uname, playCount: body?.playnum },
        };
    },
    async hotSearch() {
        const body = await requestJson('http://hotword.kuwo.cn/hotword.s?prod=kwplayer_ar_9.3.0.1&corp=kuwo&newver=2&vipver=9.3.0.1&source=kwplayer_ar_9.3.0.1_40.apk&p2p=1&notrace=0&uid=0&plat=kwplayer_ar&rformat=json&encoding=utf8&tabid=1').catch(() => null);
        return (body?.tagvalue || []).map((item: any) => item.key).filter(Boolean);
    },
};

