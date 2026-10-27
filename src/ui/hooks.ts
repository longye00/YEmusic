import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { engine } from '@/player/engine';
import { FAVORITES_ID, resolveCover, useLibrary } from '@/store/library';
import { getPendingSeek, usePlayer } from '@/store/player';

/** 播放进度（按指定间隔刷新，避免整树高频渲染） */
export function usePlaybackTime(intervalMs = 250) {
    const [time, setTime] = useState(() => (engine.hasSource ? engine.currentTime : getPendingSeek()));
    useEffect(() => {
        const timer = setInterval(() => setTime(engine.hasSource ? engine.currentTime : getPendingSeek()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return time;
}

export function useDuration() {
    const duration = usePlayer(s => s.duration);
    const fallback = usePlayer(s => s.current?.duration || 0);
    return duration || fallback;
}

/** 解析封面地址（本地封面存在 IndexedDB 中） */
export function useCover(cover?: string) {
    const [url, setUrl] = useState<string | undefined>(() => {
        const value = resolveCover(cover);
        return typeof value === 'string' ? value : undefined;
    });
    useEffect(() => {
        let alive = true;
        const value = resolveCover(cover);
        if (typeof value === 'string' || value === undefined) setUrl(value);
        else value.then(v => { if (alive) setUrl(v); });
        return () => { alive = false; };
    }, [cover]);
    return url;
}

export function useIsFavorite(id?: string) {
    return useLibrary(s => Boolean(id && s.playlists.find(p => p.id === FAVORITES_ID)?.trackIds.includes(id)));
}

export interface AsyncState<T> {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    reload: () => void;
}

const asyncCache = new Map<string, unknown>();

/** 带缓存的异步数据加载 */
export function useAsync<T>(key: string | null, fn: () => Promise<T>, options: { cache?: boolean } = {}): AsyncState<T> {
    const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>(() => ({
        data: key && options.cache !== false ? (asyncCache.get(key) as T | undefined) : undefined,
        loading: Boolean(key) && !(key && asyncCache.has(key)),
    }));
    const [nonce, setNonce] = useState(0);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    useEffect(() => {
        if (!key) {
            setState({ loading: false });
            return;
        }
        if (nonce === 0 && options.cache !== false && asyncCache.has(key)) {
            setState({ data: asyncCache.get(key) as T, loading: false });
            return;
        }
        let alive = true;
        setState(s => ({ data: s.data, loading: true }));
        fnRef.current().then(
            data => {
                if (!alive) return;
                if (options.cache !== false) asyncCache.set(key, data);
                setState({ data, loading: false });
            },
            error => { if (alive) setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false }); },
        );
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, nonce]);
    const reload = useCallback(() => {
        if (key) asyncCache.delete(key);
        setNonce(n => n + 1);
    }, [key]);
    return { ...state, reload } as AsyncState<T>;
}

/** 鼠标静止一段时间后进入“空闲”状态（沉浸模式隐藏控件） */
export function useIdle(ms = 3000, enabled = true) {
    const [idle, setIdle] = useState(false);
    useEffect(() => {
        if (!enabled) {
            setIdle(false);
            return;
        }
        let timer = setTimeout(() => setIdle(true), ms);
        const wake = () => {
            setIdle(false);
            clearTimeout(timer);
            timer = setTimeout(() => setIdle(true), ms);
        };
        window.addEventListener('pointermove', wake);
        window.addEventListener('pointerdown', wake);
        window.addEventListener('keydown', wake);
        window.addEventListener('wheel', wake);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointermove', wake);
            window.removeEventListener('pointerdown', wake);
            window.removeEventListener('keydown', wake);
            window.removeEventListener('wheel', wake);
        };
    }, [ms, enabled]);
    return idle;
}

export function useWindowSize() {
    const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
    useEffect(() => {
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return size;
}

/** 窄屏（手机竖屏）布局：窗口宽度 < 640px。与 Tailwind 的 max-sm 断点一致 */
const COMPACT_QUERY = '(max-width: 639px)';
export function useCompact() {
    return useSyncExternalStore(
        notify => {
            const media = window.matchMedia(COMPACT_QUERY);
            media.addEventListener('change', notify);
            return () => media.removeEventListener('change', notify);
        },
        () => window.matchMedia(COMPACT_QUERY).matches,
    );
}
