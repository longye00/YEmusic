/**
 * 猜我喜欢：根据“我喜欢的音乐”和最近播放，推荐你还没收藏的歌。全部在本机计算，不上传任何数据。
 *
 * 1. 给收藏 / 最近播放里的歌曲和歌手打分：越新、出现越多权重越高；
 * 2. 按权重随机抽几首“种子歌曲”（网易云相似歌曲接口；其它平台的歌先到网易云找到对应歌曲），
 *    再抽几位常听的歌手，搜他们的歌；
 * 3. 登录了网易云时，再掺入一部分“每日推荐”（那是网易云按账号口味算的）；
 * 4. 去掉已收藏 / 刚听过 / 重复的歌，同一歌手最多留几首，随机打散后取 30 首。
 *
 * 每次调用都会重新随机抽种子，所以“换一批”会得到不同的结果。
 */
import { sdks } from '@/sdk';
import type { Platform, Track } from '@/sdk/types';
import { dailySongs, similarSongs } from '@/sdk/wyApi';
import { FAVORITES_ID, useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { useWyAccount } from '@/store/wyAccount';

export const GUESS_SIZE = 30;
const MAX_PER_ARTIST = 3;

export const splitArtists = (singer: string) => String(singer || '').split(/\s*(?:[、,，/&;；]|\s(?:feat\.?|ft\.?)\s)\s*/i).map(s => s.trim()).filter(Boolean);
const norm = (text: string) => String(text || '').toLowerCase().replace(/[\s·.,，。!！?？'"“”‘’()（）[\]【】\-_~～]/g, '');
/** 去重用：歌名 + 第一位歌手 */
const keyOf = (track: Track) => `${norm(track.name)}|${norm(splitArtists(track.singer)[0] || '')}`;

function pickWeighted<T>(items: { item: T; w: number }[], count: number): T[] {
    const pool = items.filter(x => x.w > 0);
    const out: T[] = [];
    while (out.length < count && pool.length) {
        const total = pool.reduce((sum, x) => sum + x.w, 0);
        let r = Math.random() * total;
        let index = 0;
        for (; index < pool.length - 1; index++) {
            r -= pool[index].w;
            if (r <= 0) break;
        }
        out.push(pool[index].item);
        pool.splice(index, 1);
    }
    return out;
}

function shuffle<T>(list: T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
    Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

interface Signals {
    songs: { item: Track; w: number }[];
    artists: { item: string; w: number }[];
    /** 不要再推荐的歌：已收藏 + 最近听过 */
    seen: Set<string>;
    empty: boolean;
}

function collectSignals(): Signals {
    const { playlists, tracks, recent } = useLibrary.getState();
    const fav = playlists.find(p => p.id === FAVORITES_ID);
    const favTracks = (fav?.trackIds || []).map(id => tracks[id]).filter(Boolean);
    const recentTracks = recent.map(id => tracks[id]).filter(Boolean);
    const songs = new Map<string, { item: Track; w: number }>();
    const artists = new Map<string, number>();
    const seen = new Set<string>();
    const add = (track: Track, base: number, index: number) => {
        const w = base * Math.pow(0.97, index);
        const prev = songs.get(track.id);
        songs.set(track.id, { item: track, w: (prev?.w || 0) + w });
        for (const artist of splitArtists(track.singer)) artists.set(artist, (artists.get(artist) || 0) + w);
    };
    // 新收藏的排在前面；最近播放同样是新的在前
    favTracks.forEach((track, i) => {
        add(track, 3, i);
        seen.add(keyOf(track));
    });
    recentTracks.forEach((track, i) => {
        add(track, 1.2, i);
        if (i < 40) seen.add(keyOf(track));
    });
    return {
        songs: [...songs.values()],
        artists: [...artists.entries()].filter(([name]) => name && name !== '未知歌手' && name !== '未知').map(([item, w]) => ({ item, w })),
        seen,
        empty: !favTracks.length && !recentTracks.length,
    };
}

/** 把任意平台的歌曲对应到网易云的歌曲 id（用来取相似歌曲） */
async function toWySongId(track: Track): Promise<string | null> {
    if (track.source === 'wy') return track.songmid;
    const artist = splitArtists(track.singer)[0] || '';
    const res = await sdks.wy.search(`${track.name} ${artist}`.trim(), 1, 6);
    const name = norm(track.name);
    const hit = res.list.find(t => norm(t.name) === name && norm(t.singer).includes(norm(artist))) || res.list.find(t => norm(t.name) === name);
    return hit ? hit.songmid : null;
}

/** 搜歌手的歌：先用设置里的搜索平台，没结果再换别的平台 */
async function artistSongs(artist: string): Promise<Track[]> {
    const preferred = useSettings.getState().searchPlatform;
    const order = [...new Set<Platform>([preferred, 'wy', 'kw', 'kg'])];
    const wanted = norm(artist);
    for (const platform of order) {
        try {
            const res = await withTimeout(sdks[platform].search(artist, 1, 30), 9000);
            const list = res.list.filter(t => splitArtists(t.singer).some(a => norm(a) === wanted));
            if (list.length >= 3) return list;
        } catch { /* 换下一个平台 */ }
    }
    return [];
}

export interface GuessResult {
    list: Track[];
    desc: string;
}

export async function guessSongs(): Promise<GuessResult> {
    const signals = collectSignals();
    const wyLoggedIn = Boolean(useWyAccount.getState().profile);
    const seeds = signals.empty ? [] : pickWeighted(signals.songs.filter(x => x.item.source !== 'local'), 4);
    const artists = signals.empty ? [] : pickWeighted(signals.artists, 4);

    const jobs: { list: Promise<Track[]>; base: number }[] = [];
    for (const seed of seeds) {
        jobs.push({
            base: 3,
            list: withTimeout((async () => {
                const id = await toWySongId(seed);
                return id ? similarSongs(id, 15) : [];
            })(), 12000),
        });
    }
    for (const artist of artists) jobs.push({ base: 2, list: artistSongs(artist) });
    // 网易云每日推荐按账号口味生成；没有任何收藏 / 播放记录时用它兜底（游客也能用）
    if (wyLoggedIn || signals.empty) jobs.push({ base: signals.empty ? 3 : 1.6, list: withTimeout(dailySongs(), 12000) });

    const settled = await Promise.allSettled(jobs.map(job => job.list));
    const pool = new Map<string, { track: Track; score: number }>();
    let failures = 0;
    settled.forEach((res, index) => {
        if (res.status === 'rejected') {
            failures++;
            return;
        }
        const { base } = jobs[index];
        res.value.forEach((track, rank) => {
            if (!track?.name) return;
            const key = keyOf(track);
            if (!key || signals.seen.has(key)) return;
            const score = base * (1 - Math.min(rank, 30) / 60) + Math.random();
            const prev = pool.get(key);
            // 被多个来源同时推荐的歌加分
            if (prev) prev.score += score * 0.6;
            else pool.set(key, { track, score });
        });
    });
    if (!pool.size) throw new Error(failures ? '暂时无法获取推荐，请检查网络后点“换一批”重试' : '暂时没有可推荐的歌曲，多收藏几首喜欢的歌再来看看');

    const perArtist = new Map<string, number>();
    const list: Track[] = [];
    for (const { track } of [...pool.values()].sort((a, b) => b.score - a.score)) {
        const artist = norm(splitArtists(track.singer)[0] || '');
        const count = perArtist.get(artist) || 0;
        if (count >= MAX_PER_ARTIST) continue;
        perArtist.set(artist, count + 1);
        list.push(track);
        if (list.length >= GUESS_SIZE) break;
    }

    const favNames = artists.slice(0, 3);
    const desc = signals.empty
        ? '还没有收藏或播放记录，先随机推荐一些歌。收藏几首喜欢的歌，这里会越来越懂你。点「换一批」重新猜。'
        : `根据你常听的${favNames.length ? `「${favNames.join('、')}」等` : ''}歌曲与收藏生成，混合了相似歌曲${wyLoggedIn ? '与网易云每日推荐' : ''}。点「换一批」重新猜。`;
    return { list: shuffle(list), desc };
}
