/**
 * 播放器状态与调度：队列、播放模式、错误恢复（有限次重试 + 自动跳过 + 连续失败停止）、
 * 预取下一首、交叉淡入淡出、歌词 / 取色 / 系统媒体控件（SMTC）/ 托盘同步、断点续播。
 */
import { create } from 'zustand';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '@/lib/color';
import { host } from '@/lib/host';
import type { ParsedLyric } from '@/lib/lyric';
import { engine } from '@/player/engine';
import { fetchLyric } from '@/player/lyrics';
import { invalidateUrl, playableUrl, reportBadLink, resolveUrl, ResolveError, type Resolved } from '@/player/resolver';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, type Platform, type Quality, type Track } from '@/sdk/types';
import { addRecent, resolveCover, upsertTracks } from './library';
import { setSetting, useSettings, type PlayMode } from './settings';
import { toast } from './toast';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface PlayerState {
    queue: Track[];
    index: number;
    current: Track | null;
    status: PlayerStatus;
    statusText: string;
    error: string | null;
    errorDetails: string[];
    resolved: Resolved | null;
    duration: number;
    buffering: boolean;
    lyric: ParsedLyric | null;
    lyricState: 'idle' | 'loading' | 'ready' | 'none';
    lyricFrom: string;
    palette: Palette;
    coverUrl?: string;
    /** 电台模式（私人FM 等）：播到队尾前自动续上新歌 */
    radio: RadioInfo | null;
}

export interface RadioInfo {
    id: string;
    name: string;
}

export const usePlayer = create<PlayerState>(() => ({
    queue: [],
    index: -1,
    current: null,
    status: 'idle',
    statusText: '',
    error: null,
    errorDetails: [],
    resolved: null,
    duration: 0,
    buffering: false,
    lyric: null,
    lyricState: 'idle',
    lyricFrom: '',
    palette: DEFAULT_PALETTE,
    radio: null,
}));

const set = usePlayer.setState;
const get = usePlayer.getState;

let seq = 0;
let exclude = new Set<string>();
/** 本首歌已给出过坏链接的“音源|平台”，重试时跳过 */
let excludeSources = new Set<string>();
let consecutiveFailures = 0;
let midErrors = 0;
let recovering = false;
let skipTimer: ReturnType<typeof setTimeout> | undefined;
let stallTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSeek = 0;
let crossfading = false;
let prefetchedFor = '';
const history: number[] = [];
let shufflePlayed = new Set<string>();
let radioFeeder: (() => Promise<Track[]>) | null = null;
let radioFetching: Promise<number> | null = null;

// ---------------- 队列操作 ----------------
/** 正在加载 / 播放的就是这首歌（双击、连点时不重复取链） */
function isBusyWith(track: Track | undefined) {
    const { current, status } = get();
    return Boolean(track && current && current.id === track.id && (status === 'loading' || status === 'playing'));
}

export function playList(tracks: Track[], start = 0, options: { shuffle?: boolean } = {}) {
    const list = tracks.filter(Boolean);
    if (!list.length) return;
    leaveRadio();
    if (options.shuffle) setSetting('playMode', 'shuffle');
    const index = options.shuffle ? Math.floor(Math.random() * list.length) : Math.max(0, Math.min(start, list.length - 1));
    history.length = 0;
    shufflePlayed = new Set();
    if (!options.shuffle && isBusyWith(list[index])) {
        set({ queue: list, index });
        persistSoon();
        return;
    }
    set({ queue: list });
    void loadIndex(index, { autoplay: true });
}

export function playTrack(track: Track, context?: Track[]) {
    if (context?.length) {
        const index = context.findIndex(t => t.id === track.id);
        playList(context, Math.max(0, index));
        return;
    }
    if (isBusyWith(track)) return;
    const { queue, index } = get();
    const existing = queue.findIndex(t => t.id === track.id);
    if (existing >= 0) {
        void loadIndex(existing, { autoplay: true });
        return;
    }
    const nextQueue = [...queue];
    nextQueue.splice(index + 1, 0, track);
    set({ queue: nextQueue });
    void loadIndex(index + 1, { autoplay: true });
}

export function playNext(tracks: Track | Track[]) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    const { queue, index, current } = get();
    if (!current) {
        playList(list);
        return;
    }
    const ids = new Set(list.map(t => t.id).filter(id => id !== current.id));
    const rest = queue.filter((t, i) => i === index || !ids.has(t.id));
    const curIndex = rest.indexOf(queue[index]);
    rest.splice(curIndex + 1, 0, ...list.filter(t => t.id !== current.id));
    set({ queue: rest, index: curIndex });
    toast(list.length > 1 ? `已添加 ${list.length} 首到下一首播放` : `《${list[0].name}》将在下一首播放`, 'success');
    persistSoon();
}

export function addToQueue(tracks: Track[]) {
    const { queue, current } = get();
    if (!current) {
        playList(tracks);
        return;
    }
    const ids = new Set(queue.map(t => t.id));
    const fresh = tracks.filter(t => !ids.has(t.id));
    set({ queue: [...queue, ...fresh] });
    toast(`已添加 ${fresh.length} 首到播放队列`, 'success');
    persistSoon();
}

export function removeFromQueue(position: number) {
    const { queue, index } = get();
    if (position < 0 || position >= queue.length) return;
    const next = queue.filter((_, i) => i !== position);
    if (position === index) {
        set({ queue: next });
        if (!next.length) {
            stop();
            return;
        }
        void loadIndex(Math.min(position, next.length - 1), { autoplay: get().status === 'playing' });
        return;
    }
    set({ queue: next, index: position < index ? index - 1 : index });
    persistSoon();
}

export function moveInQueue(from: number, to: number) {
    const { queue, index } = get();
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    const currentId = queue[index]?.id;
    set({ queue: next, index: next.findIndex(t => t.id === currentId) });
    persistSoon();
}

export function clearQueue() {
    leaveRadio();
    stop();
    set({ queue: [], index: -1, current: null, status: 'idle', lyric: null, lyricState: 'idle', resolved: null, error: null });
    persistSoon();
}

// ---------------- 电台模式 ----------------
function leaveRadio() {
    radioFeeder = null;
    radioFetching = null;
    if (get().radio) set({ radio: null });
}

/** 队列快播完时向电台要新歌；返回新增的歌曲数 */
function feedRadio(force = false): Promise<number> {
    const { radio, queue, index } = get();
    if (!radio || !radioFeeder) return Promise.resolve(0);
    if (!force && index < queue.length - 2) return Promise.resolve(0);
    if (radioFetching) return radioFetching;
    const feeder = radioFeeder;
    const id = radio.id;
    radioFetching = feeder()
        .then(list => {
            if (get().radio?.id !== id) return 0;
            const ids = new Set(get().queue.map(t => t.id));
            const fresh = list.filter(t => t && !ids.has(t.id));
            if (fresh.length) {
                upsertTracks(fresh.filter(t => t.source !== 'local'));
                set({ queue: [...get().queue, ...fresh] });
                persistSoon();
            }
            return fresh.length;
        })
        .catch(() => 0)
        .finally(() => { radioFetching = null; });
    return radioFetching;
}

/** 进入电台模式：先取一批歌开始播放，之后自动续播 */
export async function playRadio(radio: RadioInfo, feeder: () => Promise<Track[]>) {
    const state = get();
    if (state.radio?.id === radio.id && state.current) {
        if (state.status !== 'playing' && state.status !== 'loading') void play();
        return;
    }
    toast(`正在打开「${radio.name}」…`, 'info', { duration: 1500, key: 'radio' });
    let list: Track[] = [];
    try {
        list = (await feeder()).filter(Boolean);
    } catch (error) {
        toast(`「${radio.name}」获取失败：${(error as Error).message || '网络错误'}`, 'error', { key: 'radio' });
        return;
    }
    if (!list.length) {
        toast(`「${radio.name}」暂时没有内容`, 'warning', { key: 'radio' });
        return;
    }
    playList(list, 0);
    radioFeeder = feeder;
    set({ radio });
    void feedRadio();
}

export function exitRadio() {
    if (!get().radio) return;
    leaveRadio();
    toast('已退出电台模式，当前队列保留', 'info');
}

export function stop() {
    seq++;
    clearTimeout(skipTimer);
    engine.stop();
    set({ status: get().current ? 'paused' : 'idle', buffering: false });
}

// ---------------- 核心：加载与播放 ----------------
async function loadIndex(index: number, options: { autoplay?: boolean; startAt?: number } = {}) {
    const track = get().queue[index];
    if (!track) return;
    clearTimeout(skipTimer);
    clearTimeout(stallTimer);
    const token = ++seq;
    const prev = get().index;
    if (prev >= 0 && prev !== index) history.push(prev);
    if (history.length > 200) history.shift();
    shufflePlayed.add(track.id);
    exclude = new Set();
    excludeSources = new Set();
    midErrors = 0;
    prefetchedFor = '';
    set({
        index,
        current: track,
        status: 'loading',
        statusText: '正在获取播放链接…',
        error: null,
        errorDetails: [],
        resolved: null,
        duration: track.duration || 0,
        buffering: false,
        lyric: null,
        lyricState: 'loading',
        lyricFrom: '',
    });
    engine.stop();
    void loadExtras(track, token);
    addRecent(track);
    persistSoon();
    void feedRadio();
    await startPlayback(track, token, { autoplay: options.autoplay !== false, startAt: options.startAt });
}

async function startPlayback(track: Track, token: number, options: { autoplay: boolean; startAt?: number; quality?: Quality; onlySource?: string }) {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        set({ status: 'loading', statusText: attempt ? '链接无法播放，正在换源重试…' : '正在获取播放链接…' });
        let resolved: Resolved;
        try {
            resolved = await resolveUrl(track, {
                exclude,
                excludeSources,
                quality: options.quality,
                onlySource: options.onlySource,
                onStatus: text => { if (token === seq) set({ statusText: text }); },
            });
        } catch (error) {
            if (token !== seq) return false;
            failTrack(track, token, (error as Error).message, error instanceof ResolveError ? error.details : []);
            return false;
        }
        if (token !== seq) return false;
        set({ statusText: '正在缓冲…', resolved });
        const url = await playableUrl(resolved);
        if (token !== seq) return false;
        const result = await engine.load(url, { autoplay: options.autoplay, startAt: options.startAt || pendingSeek || undefined });
        if (token !== seq) return false;
        if (result.ok) {
            pendingSeek = 0;
            consecutiveFailures = 0;
            set({ status: options.autoplay ? 'playing' : 'paused', statusText: '', error: null, errorDetails: [], resolved, duration: engine.duration || track.duration });
            if (resolved.via) toast(`原平台无法播放，已自动切换到${PLATFORM_NAMES[resolved.via.source]}的同名歌曲`, 'info');
            return true;
        }
        lastError = result.error || '播放失败';
        if (resolved.local) break;
        exclude.add(resolved.url);
        invalidateUrl(resolved.url);
        const failedPlatform = resolved.platform || (resolved.via?.source as Platform | undefined);
        if (resolved.sourceId && failedPlatform) {
            excludeSources.add(`${resolved.sourceId}|${failedPlatform}`);
            reportBadLink(resolved.sourceId, failedPlatform);
        }
    }
    failTrack(track, token, lastError);
    return false;
}

function failTrack(track: Track, token: number, message: string, details: string[] = []) {
    engine.stop();
    consecutiveFailures++;
    set({ status: 'error', statusText: '', error: message, errorDetails: details, buffering: false });
    const { queue, radio } = get();
    const { skipOnError } = useSettings.getState();
    const limit = radio ? 4 : Math.min(4, queue.length);
    if (skipOnError && (queue.length > 1 || radio) && consecutiveFailures < limit) {
        toast(`《${track.name}》无法播放，已跳过：${message}`, 'error');
        skipTimer = setTimeout(() => {
            if (token === seq) next({ auto: true });
        }, 1500);
    } else {
        toast(`《${track.name}》无法播放：${message}`, 'error');
        if (consecutiveFailures >= limit && queue.length > 1) toast('连续多首无法播放，已停止。请在“设置 → 音源”检查音源状态或网络', 'error');
        consecutiveFailures = 0;
    }
}

async function loadExtras(track: Track, token: number) {
    // 封面：本地封面在 IndexedDB；在线歌曲缺封面时向平台补取
    let cover = await resolveCover(track.cover);
    if (!cover && track.source !== 'local') {
        const pic = await sdks[track.source as Platform].getPic?.(track).catch(() => '');
        if (pic) {
            cover = pic;
            const updated = { ...track, cover: pic };
            upsertTracks([updated]);
            if (token === seq) set(state => ({ current: updated, queue: state.queue.map(t => (t.id === track.id ? updated : t)) }));
        }
    }
    if (token !== seq) return;
    set({ coverUrl: cover });
    updateMediaSession(get().current || track, cover);
    extractPalette(cover).then(palette => { if (token === seq) set({ palette: palette || DEFAULT_PALETTE }); });
    fetchLyric(track).then(
        ({ lyric, from }) => { if (token === seq) set({ lyric, lyricState: lyric ? 'ready' : 'none', lyricFrom: from }); },
        () => { if (token === seq) set({ lyric: null, lyricState: 'none' }); },
    );
}

export async function reloadLyric() {
    const { current } = get();
    if (!current) return;
    const token = seq;
    set({ lyricState: 'loading' });
    const { lyric, from } = await fetchLyric(current, true).catch(() => ({ lyric: null, from: 'none' }));
    if (token === seq) set({ lyric, lyricState: lyric ? 'ready' : 'none', lyricFrom: from });
}

export function setLyric(lyric: ParsedLyric | null, from = 'custom') {
    set({ lyric, lyricState: lyric ? 'ready' : 'none', lyricFrom: from });
}

// ---------------- 控制 ----------------
export async function play() {
    const { current, status } = get();
    if (!current) {
        const { queue } = get();
        if (queue.length) void loadIndex(0, { autoplay: true });
        return;
    }
    if (status === 'loading') return;
    if (status === 'error' || !engine.hasSource) {
        const token = ++seq;
        exclude = new Set();
        excludeSources = new Set();
        set({ error: null });
        await startPlayback(current, token, { autoplay: true, startAt: pendingSeek });
        return;
    }
    set({ status: 'playing' });
    await engine.play().catch(error => toast(`无法播放：${(error as Error).message}`, 'error'));
}

export function pause() {
    if (get().status === 'playing') set({ status: 'paused' });
    engine.pause();
    persistNow();
}

export function toggle() {
    if (get().status === 'playing') pause();
    else void play();
}

export function seek(time: number) {
    if (!engine.hasSource) {
        pendingSeek = Math.max(0, time);
        return;
    }
    engine.seek(time);
    updatePositionState();
}

export function seekBy(delta: number) {
    seek(engine.currentTime + delta);
}

function nextIndex(auto: boolean): number {
    const { queue, index, current, radio } = get();
    if (!queue.length) return -1;
    const mode = useSettings.getState().playMode;
    if (mode === 'one' && auto) return index;
    // 电台按顺序往下播，到队尾时由 next() 续上新歌
    if (radio) return index + 1 < queue.length ? index + 1 : -1;
    if (mode === 'shuffle' && queue.length > 1) {
        let pool = queue.map((t, i) => ({ t, i })).filter(x => !shufflePlayed.has(x.t.id) && x.i !== index);
        if (!pool.length) {
            shufflePlayed = new Set(current ? [current.id] : []);
            pool = queue.map((t, i) => ({ t, i })).filter(x => x.i !== index);
        }
        return pool[Math.floor(Math.random() * pool.length)].i;
    }
    if (index + 1 < queue.length) return index + 1;
    if (mode === 'order' && auto) return -1;
    return 0;
}

export function next(options: { auto?: boolean } = {}) {
    const index = nextIndex(Boolean(options.auto));
    if (index < 0 && get().radio) {
        const from = get().index;
        void feedRadio(true).then(added => {
            if (added && get().radio && get().index === from) void loadIndex(from + 1, { autoplay: true });
            else if (!added) {
                toast('电台暂时没有更多歌曲了', 'warning', { key: 'radio' });
                stop();
            }
        });
        return;
    }
    if (index < 0) {
        stop();
        set({ status: 'paused' });
        engine.seek(0);
        return;
    }
    if (index === get().index && options.auto) {
        engine.seek(0);
        void engine.play();
        return;
    }
    void loadIndex(index, { autoplay: true });
}

export function prev() {
    if (engine.currentTime > 4 && engine.hasSource) {
        engine.seek(0);
        return;
    }
    const { queue, index } = get();
    if (!queue.length) return;
    const mode = useSettings.getState().playMode;
    let target = index - 1;
    if (mode === 'shuffle' && history.length) {
        target = history.pop()!;
        void loadIndexNoHistory(target);
        return;
    }
    if (target < 0) target = queue.length - 1;
    void loadIndex(target, { autoplay: true });
}

async function loadIndexNoHistory(index: number) {
    await loadIndex(index, { autoplay: true });
    history.pop();
}

export function cycleMode() {
    const order: PlayMode[] = ['loop', 'one', 'shuffle', 'order'];
    const mode = useSettings.getState().playMode;
    const nextMode = order[(order.indexOf(mode) + 1) % order.length];
    setSetting('playMode', nextMode);
    if (nextMode === 'shuffle') shufflePlayed = new Set(get().current ? [get().current!.id] : []);
    return nextMode;
}

export const MODE_NAMES: Record<PlayMode, string> = { loop: '列表循环', one: '单曲循环', shuffle: '随机播放', order: '顺序播放' };

/** 切换音质 / 指定音源重新取链（保持当前进度） */
export async function switchPlayback(options: { quality?: Quality; onlySource?: string }) {
    const { current } = get();
    if (!current || current.source === 'local') return;
    const time = engine.currentTime;
    const wasPlaying = get().status === 'playing' || get().status === 'loading';
    const token = ++seq;
    exclude = new Set();
    excludeSources = new Set();
    const ok = await startPlayback(current, token, { autoplay: wasPlaying, startAt: time, quality: options.quality, onlySource: options.onlySource });
    if (ok) toast(`已切换到${get().resolved?.sourceName || ''} ${options.quality ? `· ${options.quality}` : ''}`, 'success');
}

export function retry() {
    void play();
}

// ---------------- 引擎事件 ----------------
engine.on(event => {
    const state = get();
    switch (event.type) {
        case 'playing':
            clearTimeout(stallTimer);
            if (state.status !== 'loading') set({ status: 'playing', buffering: false });
            else set({ buffering: false });
            break;
        case 'pause':
            if (state.status === 'playing') set({ status: 'paused' });
            break;
        case 'waiting':
            set({ buffering: true });
            clearTimeout(stallTimer);
            if (state.status === 'playing') {
                const token = seq;
                stallTimer = setTimeout(() => {
                    if (token === seq && get().buffering) void recover('缓冲时间过长，网络或音源服务器异常');
                }, 20000);
            }
            break;
        case 'ended':
            if (!crossfading) next({ auto: true });
            break;
        case 'duration':
            set({ duration: event.duration });
            break;
        case 'error':
            if (state.status === 'playing' || state.status === 'paused') void recover(event.message);
            break;
    }
});

/** 播放中途出错：记录进度，换一个链接从断点继续（最多 2 次） */
async function recover(message: string) {
    if (recovering) return;
    const { current, resolved, status } = get();
    if (!current) return;
    recovering = true;
    try {
        const time = engine.currentTime;
        const token = ++seq;
        if (resolved && !resolved.local && midErrors < 2) {
            midErrors++;
            exclude.add(resolved.url);
            invalidateUrl(resolved.url);
            toast('播放中断，正在重新获取链接…', 'info');
            await startPlayback(current, token, { autoplay: status === 'playing', startAt: time });
            return;
        }
        failTrack(current, token, message);
    } finally {
        recovering = false;
    }
}

// ---------------- 定时任务：预取 / 交叉淡化 / 进度保存 ----------------
let lastPersist = 0;
let lastPosition = 0;
setInterval(() => {
    const state = get();
    if (state.status !== 'playing') return;
    const duration = engine.duration || state.duration;
    const position = engine.currentTime;
    const remaining = duration - position;
    const now = Date.now();
    if (now - lastPersist > 5000) persistNow();
    if (now - lastPosition > 2000) {
        lastPosition = now;
        updatePositionState();
    }
    if (!duration || remaining <= 0) return;
    const mode = useSettings.getState().playMode;
    const upcoming = mode === 'shuffle' || mode === 'one' ? -1 : nextIndex(true);
    const nextTrack = upcoming >= 0 && upcoming !== state.index ? state.queue[upcoming] : undefined;
    if (nextTrack && remaining < 30 && prefetchedFor !== nextTrack.id && nextTrack.source !== 'local') {
        prefetchedFor = nextTrack.id;
        resolveUrl(nextTrack, { allowSwitch: false }).catch(() => {});
    }
    const fade = useSettings.getState().crossfade;
    if (fade > 0 && nextTrack && !crossfading && remaining <= fade + 0.3 && duration > fade * 3) void crossfadeTo(upcoming, fade);
}, 400);

async function crossfadeTo(index: number, seconds: number) {
    const track = get().queue[index];
    if (!track) return;
    crossfading = true;
    try {
        const resolved = await resolveUrl(track, { allowSwitch: false });
        const url = await playableUrl(resolved);
        if (get().status !== 'playing') return;
        const token = ++seq;
        const result = await engine.crossfade(url, seconds);
        if (token !== seq || !result.ok) return;
        const prevIndex = get().index;
        history.push(prevIndex);
        shufflePlayed.add(track.id);
        exclude = new Set();
        excludeSources = new Set();
        midErrors = 0;
        set({ index, current: track, status: 'playing', resolved, error: null, duration: track.duration, lyric: null, lyricState: 'loading', statusText: '' });
        void loadExtras(track, token);
        addRecent(track);
        persistSoon();
    } catch {
        /* 交叉淡化失败时，等待 ended 后按正常流程切歌 */
    } finally {
        crossfading = false;
    }
}

// ---------------- 断点续播 ----------------
const PLAYBACK_KEY = 'ye.playback.v2';
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 800);
}

function persistNow() {
    lastPersist = Date.now();
    const { queue, index } = get();
    try {
        localStorage.setItem(PLAYBACK_KEY, JSON.stringify({ queue: queue.slice(0, 1000), index, time: engine.hasSource ? engine.currentTime : pendingSeek }));
    } catch { /* 存储已满时忽略 */ }
}

window.addEventListener('beforeunload', persistNow);

export function restorePlayback() {
    if (!useSettings.getState().resumePlayback) return;
    try {
        const saved = JSON.parse(localStorage.getItem(PLAYBACK_KEY) || 'null');
        if (!saved?.queue?.length) return;
        const index = Math.max(0, Math.min(saved.index ?? 0, saved.queue.length - 1));
        const track: Track = saved.queue[index];
        pendingSeek = Number(saved.time) || 0;
        set({ queue: saved.queue, index, current: track, status: 'paused', duration: track.duration || 0, lyricState: 'loading' });
        void loadExtras(track, seq);
    } catch { /* ignore */ }
}

export function getPendingSeek() {
    return pendingSeek;
}

// ---------------- 系统媒体控件 / 托盘 / 设置联动 ----------------
function updateMediaSession(track: Track, cover?: string) {
    document.title = `${track.name} - ${track.singer} · YEmusic`;
    syncNowPlaying(cover ?? null);
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.singer,
            album: track.album,
            artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
        });
    } catch { /* ignore */ }
}

function updatePositionState() {
    syncNowPlaying();
    if (!('mediaSession' in navigator) || !engine.hasSource) return;
    const duration = engine.duration;
    if (!duration) return;
    try {
        navigator.mediaSession.setPositionState({ duration, position: Math.min(engine.currentTime, duration), playbackRate: 1 });
    } catch { /* ignore */ }
}

if ('mediaSession' in navigator) {
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
        ['play', () => void play()],
        ['pause', () => pause()],
        ['previoustrack', () => prev()],
        ['nexttrack', () => next()],
        ['stop', () => pause()],
        ['seekto', details => { if (details.seekTime != null) seek(details.seekTime); }],
        ['seekbackward', details => seekBy(-(details.seekOffset || 10))],
        ['seekforward', details => seekBy(details.seekOffset || 10)],
    ];
    for (const [action, handler] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* 不支持的动作 */ }
    }
}

host.onMediaCommand(command => {
    // 桌面托盘 / 缩略图工具栏用 playpause、previous；Android 媒体通知与耳机线控用 play / pause / seek:<秒>
    if (command === 'play-pause' || command === 'playpause' || command === 'toggle') toggle();
    else if (command === 'play') { if (get().status !== 'playing') void play(); }
    else if (command === 'pause') pause();
    else if (command === 'next') next();
    else if (command === 'prev' || command === 'previous') prev();
    else if (command.startsWith('seek:')) {
        const time = Number(command.slice(5));
        if (Number.isFinite(time)) seek(time);
    }
});

/** 把当前播放信息交给原生媒体会话（仅 Android：通知栏控件 / 锁屏 / 耳机线控）。cover 省略表示沿用上一次的封面 */
function syncNowPlaying(cover?: string | null) {
    if (!host.setNowPlaying) return;
    const { current, status } = get();
    void host.setNowPlaying({
        hasTrack: Boolean(current),
        title: current?.name ?? '',
        artist: current?.singer ?? '',
        album: current?.album ?? '',
        duration: engine.duration || current?.duration || 0,
        position: engine.hasSource ? engine.currentTime : 0,
        playing: status === 'playing',
        cover: cover === undefined ? undefined : cover || '',
    }).catch(() => {});
}

usePlayer.subscribe((state, prevState) => {
    if (state.status !== prevState.status || state.current !== prevState.current) {
        const playing = state.status === 'playing';
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : state.current ? 'paused' : 'none';
        void host.setTrayState({ title: state.current ? `${state.current.name} - ${state.current.singer}` : 'YEmusic', playing }).catch(() => {});
        // 换歌时先清掉上一首的封面，新封面解析完成后由 updateMediaSession 补上
        syncNowPlaying(state.current !== prevState.current ? null : undefined);
        if (!state.current) document.title = 'YEmusic';
    }
});

const applyAudioSettings = () => {
    const s = useSettings.getState();
    engine.setVolume(s.volume, s.muted);
    engine.setEq(s.eqEnabled, s.eqGains);
};
applyAudioSettings();
let lastDevice = '';
useSettings.subscribe((s, p) => {
    if (s.volume !== p.volume || s.muted !== p.muted || s.eqEnabled !== p.eqEnabled || s.eqGains !== p.eqGains) applyAudioSettings();
    if (s.outputDevice !== lastDevice) {
        lastDevice = s.outputDevice;
        void engine.setOutputDevice(s.outputDevice);
    }
});
if (useSettings.getState().outputDevice !== 'default') {
    lastDevice = useSettings.getState().outputDevice;
    void engine.setOutputDevice(lastDevice);
}
