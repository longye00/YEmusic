/**
 * 歌词获取：缓存 → 平台接口 → 洛雪音源 lyric 动作 → 其他平台同名歌曲 → LRCLIB；
 * 本地歌曲：内嵌歌词 → 同名 .lrc → 在线匹配。
 */
import { host } from '@/lib/host';
import { requestJson } from '@/lib/http';
import * as db from '@/lib/idb';
import { buildLyric, type ParsedLyric } from '@/lib/lyric';
import { normalizeArtist } from '@/lib/util';
import { sdks } from '@/sdk';
import { PLATFORMS, type Platform, type RawLyric, type Track } from '@/sdk/types';
import { callSource, lyricSourcesFor } from '@/store/sources';
import { findAlternatives } from './resolver';
import { toLxMusicInfo } from './musicInfo';

interface CachedLyric { id: string; raw: RawLyric | null; from: string; time: number }
const NEGATIVE_TTL = 6 * 3600 * 1000;
const memory = new Map<string, Promise<{ lyric: ParsedLyric | null; from: string }>>();

const hasContent = (raw: RawLyric | null | undefined) => Boolean(raw && (String(raw.lyric || '').replace(/\[[^\]]*\]/g, '').trim() || raw.lxlyric));

async function fromPlatform(track: Track): Promise<RawLyric | null> {
    if (track.source === 'local') return null;
    const raw = await sdks[track.source].getLyric(track).catch(() => null);
    return hasContent(raw) ? raw : null;
}

async function fromSources(track: Track): Promise<RawLyric | null> {
    if (track.source === 'local') return null;
    for (const record of lyricSourcesFor(track.source as Platform).slice(0, 2)) {
        try {
            const res = (await callSource(record.id, track.source, 'lyric', { type: 'lyric', musicInfo: toLxMusicInfo(track) }, 12000)) as RawLyric;
            if (hasContent(res)) return { lyric: res.lyric, tlyric: res.tlyric || '', rlyric: res.rlyric || '', lxlyric: res.lxlyric || '' };
        } catch { /* 下一个 */ }
    }
    return null;
}

async function fromLrclib(track: Track): Promise<RawLyric | null> {
    const artist = normalizeArtist(track.singer)[0] || track.singer;
    const params = new URLSearchParams({ track_name: track.name, artist_name: artist });
    if (track.album) params.set('album_name', track.album);
    if (track.duration) params.set('duration', String(Math.round(track.duration)));
    try {
        const res = await requestJson<{ syncedLyrics?: string; plainLyrics?: string }>(`https://lrclib.net/api/get?${params}`, { timeout: 8000, headers: { 'User-Agent': 'YEmusic (https://github.com/)' } });
        const lyric = res?.syncedLyrics || res?.plainLyrics || '';
        if (lyric.trim()) return { lyric };
    } catch { /* ignore */ }
    try {
        const list = await requestJson<{ syncedLyrics?: string; duration?: number }[]>(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${track.name} ${artist}` })}`, { timeout: 8000 });
        const hit = list?.find(item => item.syncedLyrics && (!track.duration || !item.duration || Math.abs(item.duration - track.duration) < 6));
        if (hit?.syncedLyrics) return { lyric: hit.syncedLyrics };
    } catch { /* ignore */ }
    return null;
}

async function fromAlternatives(track: Track): Promise<RawLyric | null> {
    const platforms = (['wy', 'tx', 'kg', 'kw', 'mg'] as Platform[]).filter(p => PLATFORMS.includes(p));
    const alternatives = await findAlternatives(track, platforms).catch(() => []);
    for (const alt of alternatives.slice(0, 3)) {
        const raw = await fromPlatform(alt);
        if (raw) return raw;
    }
    return null;
}

async function sidecar(track: Track): Promise<RawLyric | null> {
    if (!track.path) return null;
    const file = await host.readSidecarLyric(track.path).catch(() => null);
    if (!file?.data?.length) return null;
    const data = new Uint8Array(file.data);
    let text: string;
    if (file.encoding === 'auto') {
        // 无 BOM：优先按 UTF-8 严格解码，失败则视为 GBK（老歌词文件常见）
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { text = new TextDecoder('gbk').decode(data); }
    } else {
        text = new TextDecoder(file.encoding === 'utf-16le' ? 'utf-16le' : 'utf-8').decode(data);
    }
    return text.trim() ? { lyric: text } : null;
}

async function load(track: Track, force: boolean): Promise<{ lyric: ParsedLyric | null; from: string }> {
    if (!force) {
        const cached = await db.get<CachedLyric>('lyrics', track.id).catch(() => undefined);
        if (cached?.raw && hasContent(cached.raw)) return { lyric: buildLyric(cached.raw), from: cached.from };
        if (cached && !cached.raw && Date.now() - cached.time < NEGATIVE_TTL) return { lyric: null, from: 'none' };
    }
    const steps: [string, () => Promise<RawLyric | null>][] = track.source === 'local'
        ? [['sidecar', () => sidecar(track)], ['match', () => fromAlternatives(track)], ['lrclib', () => fromLrclib(track)]]
        : [['platform', () => fromPlatform(track)], ['source', () => fromSources(track)], ['match', () => fromAlternatives(track)], ['lrclib', () => fromLrclib(track)]];
    for (const [from, step] of steps) {
        const raw = await step().catch(() => null);
        if (raw && hasContent(raw)) {
            await db.put('lyrics', { id: track.id, raw, from, time: Date.now() } satisfies CachedLyric).catch(() => {});
            return { lyric: buildLyric(raw), from };
        }
    }
    await db.put('lyrics', { id: track.id, raw: null, from: 'none', time: Date.now() } satisfies CachedLyric).catch(() => {});
    return { lyric: null, from: 'none' };
}

export function fetchLyric(track: Track, force = false) {
    const key = track.id;
    if (force) memory.delete(key);
    let promise = memory.get(key);
    if (!promise) {
        promise = load(track, force);
        memory.set(key, promise);
        promise.then(result => { if (!result.lyric) memory.delete(key); }, () => memory.delete(key));
        if (memory.size > 60) memory.delete(memory.keys().next().value!);
    }
    return promise;
}

/** 用户手动导入 .lrc */
export async function saveCustomLyric(track: Track, text: string) {
    const raw: RawLyric = { lyric: text };
    await db.put('lyrics', { id: track.id, raw, from: 'custom', time: Date.now() } satisfies CachedLyric);
    memory.delete(track.id);
    return buildLyric(raw);
}

export async function clearLyricCache() {
    memory.clear();
    await db.clear('lyrics');
}
