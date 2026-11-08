// 测试替身：音频引擎。镜像 src/player/engine.ts 里 store/player.ts 用到的接口
// （load / crossfade / play / pause / stop / seek / on / duration / currentTime /
// hasSource / setVolume / setEq / setOutputDevice），把「哪些链接被加载、哪些真的
// 播放过、每次 load 带了什么参数」都记下来，由测试用例直接断言。
// state.trial 里的链接在 load 时返回 { ok:false, error:'trial:<secs>' }——和真引擎一样，
// 这种链接不会走到 play。
import type { EngineEvent } from '@/player/engine';

export interface EngineLoadCall {
    url: string;
    options: { autoplay?: boolean; startAt?: number; timeoutMs?: number; expectedDuration?: number };
}

interface EngineState {
    /** load 时判为试听片段的链接（返回 trial:<trialSecs>） */
    trial: Set<string>;
    trialSecs: number;
    /** load 时返回普通错误的链接 */
    fail: Map<string, string>;
    loads: EngineLoadCall[];
    crossfades: { url: string; seconds: number; expectedDuration?: number }[];
    /** 真正开始播放过的次数（load 的 autoplay 与显式 play() 都算） */
    playCalls: number;
    /** 真正播放过的链接（试听的不会出现在这里） */
    playedUrls: string[];
    url: string;
    hasSource: boolean;
    currentTime: number;
    duration: number;
    listeners: Set<(event: EngineEvent) => void>;
}

const state = ((globalThis as any).__engineStub ??= {
    trial: new Set<string>(),
    trialSecs: 35,
    fail: new Map<string, string>(),
    loads: [],
    crossfades: [],
    playCalls: 0,
    playedUrls: [],
    url: '',
    hasSource: false,
    currentTime: 0,
    duration: 0,
    listeners: new Set(),
} as EngineState) as EngineState;
export const __state = state;

export const __emit = (event: EngineEvent) => {
    for (const listener of [...state.listeners]) listener(event);
};

/** 用例之间复位（不 touch listeners——player.ts 的 engine.on 只在模块加载时挂一次） */
export function __reset() {
    state.trial.clear();
    state.fail.clear();
    state.loads.length = 0;
    state.crossfades.length = 0;
    state.playCalls = 0;
    state.playedUrls.length = 0;
    state.url = '';
    state.hasSource = false;
    state.currentTime = 0;
    state.duration = 0;
}

const verdict = (url: string): { ok: boolean; error?: string } | null => {
    if (state.trial.has(url)) return { ok: false, error: `trial:${state.trialSecs}` };
    const error = state.fail.get(url);
    if (error) return { ok: false, error };
    return null;
};

export const engine = {
    async load(url: string, options: EngineLoadCall['options'] = {}) {
        state.loads.push({ url, options });
        const bad = verdict(url);
        if (bad) return bad;
        state.url = url;
        state.hasSource = true;
        if (options.startAt && options.startAt > 0) state.currentTime = options.startAt;
        if (options.autoplay !== false) {
            state.playCalls++;
            state.playedUrls.push(url);
            queueMicrotask(() => __emit({ type: 'playing' }));
        }
        return { ok: true };
    },
    async crossfade(url: string, seconds: number, expectedDuration?: number) {
        state.crossfades.push({ url, seconds, expectedDuration });
        const bad = verdict(url);
        if (bad) return bad;
        state.url = url;
        state.hasSource = true;
        state.playCalls++;
        state.playedUrls.push(url);
        queueMicrotask(() => __emit({ type: 'playing' }));
        return { ok: true };
    },
    async play() {
        state.playCalls++;
        if (state.url) state.playedUrls.push(state.url);
        __emit({ type: 'playing' });
    },
    pause() { __emit({ type: 'pause' }); },
    stop() { state.url = ''; state.hasSource = false; },
    seek(time: number) { if (state.hasSource) state.currentTime = time; },
    on(listener: (event: EngineEvent) => void) {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
    },
    get currentTime() { return state.currentTime; },
    get duration() { return state.duration; },
    get hasSource() { return state.hasSource; },
    setVolume() { /* noop */ },
    setEq() { /* noop */ },
    async setOutputDevice() { return true; },
};
