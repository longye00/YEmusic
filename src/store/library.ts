/**
 * 曲库：收藏、自建/导入歌单、最近播放、本地音乐（文件夹扫描 + 标签/封面读取）。
 * 数据保存在 IndexedDB（yemusic2），首次启动时从 0.1.x 的旧库迁移歌单与收藏。
 */
import { create } from 'zustand';
import * as db from '@/lib/idb';
import { host, isDesktop } from '@/lib/host';
import { md5 } from '@/lib/md5';
import { uid } from '@/lib/util';
import type { Platform, Quality, Track } from '@/sdk/types';
import { PLATFORMS } from '@/sdk/types';
import { setSetting, useSettings } from './settings';
import { toast } from './toast';

export type PlaylistKind = 'favorites' | 'local' | 'user' | 'imported';

export interface UserPlaylist {
    id: string;
    name: string;
    kind: PlaylistKind;
    trackIds: string[];
    createdAt: number;
    updatedAt: number;
    cover?: string;
    desc?: string;
    origin?: { platform: Platform; id: string; type: 'songlist' | 'board' };
}

interface ScanState { active: boolean; done: number; total: number; current?: string }

interface LibraryState {
    loaded: boolean;
    tracks: Record<string, Track>;
    playlists: UserPlaylist[];
    recent: string[];
    scan: ScanState;
}

export const FAVORITES_ID = 'favorites';
export const LOCAL_ID = 'local';
export const RECENT_ID = 'recent';

export const useLibrary = create<LibraryState>(() => ({
    loaded: false,
    tracks: {},
    playlists: [],
    recent: [],
    scan: { active: false, done: 0, total: 0 },
}));

const now = () => Date.now();

function basePlaylists(): UserPlaylist[] {
    const t = now();
    return [
        { id: FAVORITES_ID, name: '我喜欢的音乐', kind: 'favorites', trackIds: [], createdAt: t, updatedAt: t },
        { id: LOCAL_ID, name: '本地音乐', kind: 'local', trackIds: [], createdAt: t, updatedAt: t },
    ];
}

// ---------------- 持久化 ----------------
const dirtyTracks = new Set<string>();
const dirtyPlaylists = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
}

async function flush() {
    const { tracks, playlists, recent } = useLibrary.getState();
    const trackRows = [...dirtyTracks].map(id => tracks[id]).filter(Boolean);
    const removedTracks = [...dirtyTracks].filter(id => !tracks[id]);
    const playlistRows = [...dirtyPlaylists].map(id => playlists.find(p => p.id === id)).filter(Boolean);
    const removedPlaylists = [...dirtyPlaylists].filter(id => !playlists.some(p => p.id === id));
    dirtyTracks.clear();
    dirtyPlaylists.clear();
    try {
        if (trackRows.length) await db.putMany('tracks', trackRows);
        if (removedTracks.length) await db.delMany('tracks', removedTracks);
        if (playlistRows.length) await db.putMany('playlists', playlistRows);
        if (removedPlaylists.length) await db.delMany('playlists', removedPlaylists);
        await db.kvSet('recent', recent);
    } catch (error) {
        console.error('[library] 保存失败', error);
    }
}

window.addEventListener('beforeunload', () => { void flush(); });

function slimTrack(track: Track): Track {
    const copy: Track = { ...track };
    for (const key of Object.keys(copy) as (keyof Track)[]) if (copy[key] === undefined || copy[key] === '') delete copy[key];
    return copy;
}

/** 写入/更新歌曲元数据（保留已有的本地字段） */
export function upsertTracks(list: Track[]) {
    if (!list.length) return;
    useLibrary.setState(state => {
        const tracks = { ...state.tracks };
        for (const track of list) {
            const prev = tracks[track.id];
            tracks[track.id] = slimTrack(prev ? { ...prev, ...track, cover: track.cover || prev.cover, qualities: track.qualities?.length ? track.qualities : prev.qualities } : track);
            dirtyTracks.add(track.id);
        }
        return { tracks };
    });
    scheduleFlush();
}

function updatePlaylist(id: string, fn: (p: UserPlaylist) => UserPlaylist | null) {
    useLibrary.setState(state => {
        const playlists: UserPlaylist[] = [];
        for (const p of state.playlists) {
            if (p.id !== id) { playlists.push(p); continue; }
            const next = fn(p);
            if (next) playlists.push({ ...next, updatedAt: now() });
        }
        return { playlists };
    });
    dirtyPlaylists.add(id);
    scheduleFlush();
}

// ---------------- 加载与迁移 ----------------
export async function loadLibrary() {
    if (useLibrary.getState().loaded) return;
    let [tracks, playlists, recent] = await Promise.all([
        db.getAll<Track>('tracks').catch(() => []),
        db.getAll<UserPlaylist>('playlists').catch(() => [] as UserPlaylist[]),
        db.kvGet<string[]>('recent', []).catch(() => [] as string[]),
    ]);
    const map: Record<string, Track> = {};
    for (const t of tracks) map[t.id] = t;
    const base = basePlaylists();
    for (const b of base) if (!playlists.some(p => p.id === b.id)) { playlists.push(b); dirtyPlaylists.add(b.id); }
    playlists.sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
    useLibrary.setState({ loaded: true, tracks: map, playlists, recent: recent.filter(id => map[id]) });
    scheduleFlush();
    if (!(await db.kvGet('library.migrated.v1', false))) {
        await migrateLegacy().catch(error => console.warn('[library] 旧版数据迁移失败', error));
        await db.kvSet('library.migrated.v1', true);
    }
}

const order = (p: UserPlaylist) => (p.kind === 'favorites' ? 0 : p.kind === 'local' ? 1 : 2);

interface LegacySong {
    id: string; name?: string; artist?: string; album?: string; origin?: string; duration?: number; coverUrl?: string;
    localRef?: { path?: string }; remoteRef?: { extraId?: string };
}

async function migrateLegacy() {
    const legacy = await db.readLegacyDb();
    if (!legacy) return;
    const songs = (legacy.songs || []) as LegacySong[];
    const idMap = new Map<string, string>();
    const remote: Track[] = [];
    const localPaths: string[] = [];
    for (const song of songs) {
        if (song.origin === 'local' && song.localRef?.path) {
            const id = localId(song.localRef.path);
            idMap.set(song.id, id);
            localPaths.push(song.localRef.path);
            continue;
        }
        try {
            const extra = JSON.parse(song.remoteRef?.extraId || '{}');
            if (!extra.platform || !extra.songmid || !PLATFORMS.includes(extra.platform)) continue;
            const track: Track = {
                id: `${extra.platform}_${extra.songmid}`,
                source: extra.platform,
                songmid: String(extra.songmid),
                name: extra.name || song.name || '未知歌曲',
                singer: extra.artist || song.artist || '未知歌手',
                album: extra.album || song.album || '',
                duration: Number(extra.duration || song.duration) || 0,
                cover: extra.coverUrl || song.coverUrl,
                qualities: (extra.qualities || []).map((type: Quality) => ({ type })),
                meta: { hash: extra.hash, copyrightId: extra.copyrightId },
            };
            idMap.set(song.id, track.id);
            remote.push(track);
        } catch { /* 忽略损坏的记录 */ }
    }
    upsertTracks(remote);
    if (localPaths.length && isDesktop) await importFiles(localPaths, { silent: true });
    const known = useLibrary.getState().tracks;
    let count = 0;
    for (const old of (legacy.playlists || []) as { id: string; name?: string; songIds?: string[]; createdAt?: number }[]) {
        const ids = (old.songIds || []).map(id => idMap.get(id)).filter((id): id is string => Boolean(id && known[id]));
        if (old.id === 'local') continue;
        if (old.id === 'favorites') {
            for (const id of ids) addToPlaylist(FAVORITES_ID, [id], { silent: true });
            continue;
        }
        if (!ids.length) continue;
        createPlaylist(old.name || '旧版歌单', ids, { createdAt: old.createdAt });
        count++;
    }
    if (remote.length || localPaths.length) toast(`已从旧版本迁移 ${remote.length + localPaths.length} 首歌曲、${count} 个歌单`, 'success');
}

// ---------------- 歌单操作 ----------------
export function getPlaylist(id: string) {
    return useLibrary.getState().playlists.find(p => p.id === id);
}

export function createPlaylist(name: string, trackIds: string[] = [], extra: Partial<UserPlaylist> = {}): UserPlaylist {
    const playlist: UserPlaylist = {
        id: uid('pl'),
        name: name.trim() || '新建歌单',
        kind: 'user',
        trackIds: [...new Set(trackIds)],
        createdAt: now(),
        updatedAt: now(),
        ...extra,
    };
    useLibrary.setState(state => ({ playlists: [...state.playlists, playlist] }));
    dirtyPlaylists.add(playlist.id);
    scheduleFlush();
    return playlist;
}

export function renamePlaylist(id: string, name: string) {
    updatePlaylist(id, p => ({ ...p, name: name.trim() || p.name }));
}

export function deletePlaylist(id: string) {
    if (id === FAVORITES_ID || id === LOCAL_ID) return;
    updatePlaylist(id, () => null);
}

export function addToPlaylist(id: string, trackIds: string[], options: { silent?: boolean; front?: boolean } = {}) {
    let added = 0;
    updatePlaylist(id, p => {
        const existing = new Set(p.trackIds);
        const fresh = trackIds.filter(t => !existing.has(t));
        added = fresh.length;
        return { ...p, trackIds: options.front ? [...fresh, ...p.trackIds] : [...p.trackIds, ...fresh] };
    });
    if (!options.silent) {
        const name = getPlaylist(id)?.name || '歌单';
        toast(added ? `已添加 ${added} 首到「${name}」` : `歌曲已在「${name}」中`, added ? 'success' : 'info');
    }
    return added;
}

export function removeFromPlaylist(id: string, trackIds: string[]) {
    const remove = new Set(trackIds);
    updatePlaylist(id, p => ({ ...p, trackIds: p.trackIds.filter(t => !remove.has(t)) }));
}

export function movePlaylistTrack(id: string, from: number, to: number) {
    updatePlaylist(id, p => {
        const list = [...p.trackIds];
        const [item] = list.splice(from, 1);
        list.splice(to, 0, item);
        return { ...p, trackIds: list };
    });
}

export function isFavorite(trackId: string) {
    return Boolean(getPlaylist(FAVORITES_ID)?.trackIds.includes(trackId));
}

export function toggleFavorite(track: Track) {
    upsertTracks([track]);
    if (isFavorite(track.id)) {
        removeFromPlaylist(FAVORITES_ID, [track.id]);
        return false;
    }
    addToPlaylist(FAVORITES_ID, [track.id], { silent: true, front: true });
    return true;
}

/** 收藏 / 导入在线歌单（保存快照，可刷新） */
export function saveOnlinePlaylist(info: { name: string; cover?: string; desc?: string; platform: Platform; id: string; type: 'songlist' | 'board' }, tracks: Track[]) {
    upsertTracks(tracks);
    const existing = useLibrary.getState().playlists.find(p => p.origin?.platform === info.platform && p.origin.id === info.id);
    if (existing) {
        updatePlaylist(existing.id, p => ({ ...p, name: info.name || p.name, cover: info.cover || p.cover, trackIds: tracks.map(t => t.id) }));
        return getPlaylist(existing.id)!;
    }
    return createPlaylist(info.name, tracks.map(t => t.id), {
        kind: 'imported',
        cover: info.cover,
        desc: info.desc,
        origin: { platform: info.platform, id: info.id, type: info.type },
    });
}

export function addRecent(track: Track) {
    upsertTracks([track]);
    useLibrary.setState(state => ({ recent: [track.id, ...state.recent.filter(id => id !== track.id)].slice(0, 300) }));
    scheduleFlush();
}

export function clearRecent() {
    useLibrary.setState({ recent: [] });
    scheduleFlush();
}

export function playlistTracks(playlist: UserPlaylist | undefined, tracks = useLibrary.getState().tracks): Track[] {
    if (!playlist) return [];
    return playlist.trackIds.map(id => tracks[id]).filter(Boolean);
}

// ---------------- 本地音乐 ----------------
export const localId = (path: string) => `local_${md5(path.replace(/\\/g, '/').toLowerCase()).slice(0, 16)}`;
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|wma|ape|alac|aiff?|webm)$/i;

async function runPool<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>) {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            await fn(items[index], index);
        }
    }));
}

async function saveCover(data: Uint8Array, format: string, key: string) {
    const id = `cover_${key}`;
    const existing = await db.get('covers', id).catch(() => undefined);
    if (!existing) await db.put('covers', { id, data, format: format || 'image/jpeg' });
    return `idb:${id}`;
}

async function readLocalTrack(file: { path: string; size?: number; mtime?: number; folder?: string }): Promise<Track> {
    const fileName = file.path.split(/[\\/]/).pop() || file.path;
    const stem = fileName.replace(/\.[^.]+$/, '');
    let tags;
    try {
        tags = await host.readTags(file.path, true);
    } catch {
        tags = null;
    }
    // 文件名形如 “歌手 - 歌名” 时作为兜底
    const dash = stem.split(/\s+-\s+/);
    const name = tags?.title || (dash.length >= 2 ? dash.slice(1).join(' - ') : stem);
    const singer = tags?.artist || (dash.length >= 2 ? dash[0] : '未知歌手');
    const album = tags?.album || '';
    const id = localId(file.path);
    let cover: string | undefined;
    if (tags?.cover?.data?.length) cover = await saveCover(tags.cover.data, tags.cover.format, md5(`${album || id}|${album ? singer : ''}`).slice(0, 16)).catch(() => undefined);
    if (tags?.lyrics) await db.put('lyrics', { id, raw: { lyric: tags.lyrics }, from: 'embedded', time: now() }).catch(() => {});
    return {
        id,
        source: 'local',
        songmid: id,
        name,
        singer,
        album,
        duration: Math.round(tags?.duration || 0),
        cover,
        path: file.path,
        fileSize: file.size,
        codec: tags?.codec,
        bitrate: tags?.bitrate ? Math.round(tags.bitrate / 1000) : undefined,
        lossless: tags?.lossless,
        mtime: file.mtime,
        folder: file.folder,
        addedAt: now(),
    };
}

function setLocalList(ids: string[]) {
    updatePlaylist(LOCAL_ID, p => ({ ...p, trackIds: ids }));
}

/** 导入若干音频文件 */
export async function importFiles(paths: string[], options: { silent?: boolean } = {}) {
    const files = paths.filter(p => AUDIO_EXT.test(p));
    if (!files.length) {
        if (!options.silent) toast('没有可导入的音频文件', 'info');
        return 0;
    }
    const result: Track[] = [];
    useLibrary.setState({ scan: { active: true, done: 0, total: files.length } });
    await runPool(files, 4, async (path, i) => {
        result[i] = await readLocalTrack({ path });
        useLibrary.setState(state => ({ scan: { ...state.scan, done: state.scan.done + 1, current: path } }));
    });
    upsertTracks(result);
    const local = getPlaylist(LOCAL_ID);
    setLocalList([...new Set([...(local?.trackIds || []), ...result.map(t => t.id)])]);
    useLibrary.setState({ scan: { active: false, done: 0, total: 0 } });
    if (!options.silent) toast(`已导入 ${result.length} 首本地歌曲`, 'success');
    return result.length;
}

/** 扫描已添加的本地文件夹（增量：未变化的文件不重复读取标签） */
export async function rescanLocal(folders = useSettings.getState().localFolders) {
    if (!isDesktop) {
        toast('网页版无法读取本地文件', 'error');
        return;
    }
    if (useLibrary.getState().scan.active) return;
    useLibrary.setState({ scan: { active: true, done: 0, total: 0, current: '正在查找音频文件…' } });
    try {
        const files = folders.length ? await host.scanAudio(folders) : [];
        const { tracks } = useLibrary.getState();
        const local = getPlaylist(LOCAL_ID);
        const loose = (local?.trackIds || []).map(id => tracks[id]).filter(t => t && t.path && !folders.some(f => isInside(t.path!, f)));
        const fresh: Track[] = [];
        const keep: string[] = [];
        const todo = files.filter(f => {
            const existing = tracks[localId(f.path)];
            if (existing && existing.mtime === f.mtime && existing.fileSize === f.size) {
                keep.push(existing.id);
                return false;
            }
            return true;
        });
        useLibrary.setState({ scan: { active: true, done: 0, total: todo.length } });
        await runPool(todo, 4, async file => {
            fresh.push(await readLocalTrack(file));
            useLibrary.setState(state => ({ scan: { ...state.scan, done: state.scan.done + 1, current: file.path } }));
        });
        upsertTracks(fresh);
        const order = new Map(files.map((f, i) => [localId(f.path), i]));
        const ids = [...keep, ...fresh.map(t => t.id)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        setLocalList([...loose.map(t => t.id), ...ids]);
        toast(`本地音乐扫描完成：共 ${ids.length + loose.length} 首${fresh.length ? `，新增/更新 ${fresh.length} 首` : ''}`, 'success');
    } catch (error) {
        toast(`扫描失败：${(error as Error).message}`, 'error');
    } finally {
        useLibrary.setState({ scan: { active: false, done: 0, total: 0 } });
    }
}

const isInside = (file: string, folder: string) => file.replace(/\\/g, '/').toLowerCase().startsWith(folder.replace(/\\/g, '/').toLowerCase().replace(/\/?$/, '/'));

export async function addLocalFolder() {
    const res = await host.showOpenDialog({ title: '选择音乐文件夹', directory: true, multiple: true });
    if (res.cancelled || !res.paths.length) return;
    const folders = [...new Set([...useSettings.getState().localFolders, ...res.paths])];
    setSetting('localFolders', folders);
    await rescanLocal(folders);
}

export async function removeLocalFolder(folder: string) {
    const folders = useSettings.getState().localFolders.filter(f => f !== folder);
    setSetting('localFolders', folders);
    const { tracks } = useLibrary.getState();
    const local = getPlaylist(LOCAL_ID);
    setLocalList((local?.trackIds || []).filter(id => !tracks[id]?.path || !isInside(tracks[id].path!, folder)));
}

export async function pickAudioFiles() {
    const res = await host.showOpenDialog({
        title: '选择音频文件',
        multiple: true,
        filters: [{ name: '音频文件', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'ape', 'webm'] }],
    });
    if (!res.cancelled && res.paths.length) await importFiles(res.paths);
}

// ---------------- 封面 ----------------
const coverUrls = new Map<string, Promise<string | undefined>>();

/** 把 track.cover 解析为可直接用于 <img> 的地址（本地封面存于 IndexedDB） */
export function resolveCover(cover: string | undefined): Promise<string | undefined> | string | undefined {
    if (!cover || !cover.startsWith('idb:')) return cover;
    const key = cover.slice(4);
    let promise = coverUrls.get(key);
    if (!promise) {
        promise = db.get<{ data: Uint8Array; format: string }>('covers', key)
            .then(row => (row ? URL.createObjectURL(new Blob([row.data as BlobPart], { type: row.format })) : undefined))
            .catch(() => undefined);
        coverUrls.set(key, promise);
    }
    return promise;
}

export async function clearCoverCache() {
    await db.clear('covers');
    coverUrls.clear();
}

// ---------------- 备份 ----------------
export async function exportBackup() {
    await flush();
    const { tracks, playlists, recent } = useLibrary.getState();
    const used = new Set(playlists.filter(p => p.kind !== 'local').flatMap(p => p.trackIds).concat(recent));
    const sources = await db.getAll<{ builtin?: boolean }>('sources');
    return JSON.stringify({
        app: 'YEmusic',
        version: 2,
        exportedAt: new Date().toISOString(),
        tracks: [...used].map(id => tracks[id]).filter(t => t && t.source !== 'local'),
        playlists: playlists.filter(p => p.kind !== 'local').map(p => ({ ...p, trackIds: p.trackIds.filter(id => !id.startsWith('local_')) })),
        sources: sources.filter(s => !s.builtin),
    });
}

export async function importBackup(text: string) {
    const data = JSON.parse(text);
    if (data?.app !== 'YEmusic' || !Array.isArray(data.playlists)) throw new Error('不是有效的 YEmusic 备份文件');
    upsertTracks((data.tracks || []).filter((t: Track) => t?.id && t.source && t.source !== 'local'));
    let count = 0;
    for (const p of data.playlists as UserPlaylist[]) {
        if (p.id === FAVORITES_ID) { addToPlaylist(FAVORITES_ID, p.trackIds, { silent: true }); continue; }
        if (useLibrary.getState().playlists.some(x => x.id === p.id)) continue;
        useLibrary.setState(state => ({ playlists: [...state.playlists, { ...p, kind: p.kind === 'imported' ? 'imported' : 'user' }] }));
        dirtyPlaylists.add(p.id);
        count++;
    }
    scheduleFlush();
    return { playlists: count, sources: (data.sources || []) as { script: string }[] };
}
