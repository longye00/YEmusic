/** 用户设置（localStorage 持久化，启动即同步可用） */
import { create } from 'zustand';
import type { Platform, Quality } from '@/sdk/types';
import { isFoliaMode, type FoliaModeId } from '@/ui/player/folia/modes';

/** luminous / flow 是 YEmusic 自带的歌词动画；其余 8 种移植自 Folia（见 ui/player/folia/modes.ts） */
export type LyricStyle = 'luminous' | 'flow' | FoliaModeId;
export type LyricIntensity = 'calm' | 'normal' | 'chaotic';
export type BackgroundMode = 'latent' | 'blur' | 'solid';
export type ThemeMode = 'default' | 'cover' | 'custom';
export type PlayMode = 'loop' | 'one' | 'shuffle' | 'order';
/** 首页布局：Folia 式“乐库”拼贴墙 / 3D 封面流 */
export type HomeLayout = 'library' | 'carousel';
export type LibraryTab = 'playlists' | 'radio' | 'albums' | 'local' | 'plaza' | 'boards';
export type LocalGroup = 'albums' | 'artists' | 'folders';
/** 乐库中间的“书签”：完整 / 书脊 / 收起（只剩屏幕边上的标签） */
export type SeamLevel = 'full' | 'spine' | 'hidden';
export type LibraryAccount = 'wy' | 'tx' | 'kg';
/** 精简模式：关闭毛玻璃、背景降帧等最吃 GPU 的效果。auto = Android / 旧版 WebView 自动开启 */
export type LiteMode = 'auto' | 'on' | 'off';

export interface Settings {
    quality: Quality;
    qualityFallback: boolean;
    autoSwitchSource: boolean;
    skipOnError: boolean;
    volume: number;
    muted: boolean;
    playMode: PlayMode;
    crossfade: number;
    resumePlayback: boolean;
    outputDevice: string;
    eqEnabled: boolean;
    eqGains: number[];
    lyricStyle: LyricStyle;
    lyricIntensity: LyricIntensity;
    lyricScale: number;
    lyricFont: 'sans' | 'serif';
    reactive: boolean;
    showTranslation: boolean;
    showRoma: boolean;
    lyricOffset: number;
    background: BackgroundMode;
    dither: boolean;
    reduceMotion: boolean;
    liteMode: LiteMode;
    theme: ThemeMode;
    customAccent: string;
    downloadDir: string;
    downloadQuality: Quality;
    fileNameTemplate: string;
    saveLyricFile: boolean;
    /** 下载时把歌名 / 歌手 / 专辑 / 封面 / 歌词写入文件标签 */
    embedMeta: boolean;
    closeToTray: boolean;
    searchPlatform: Platform;
    plazaPlatform: Platform;
    boardPlatform: Platform;
    homeTab: 'mine' | 'plaza' | 'boards';
    homeLayout: HomeLayout;
    libraryTab: LibraryTab;
    librarySeam: SeamLevel;
    /** 收起前的等级（点屏幕边上的标签恢复到它） */
    librarySeamRestore: Exclude<SeamLevel, 'hidden'>;
    /** 乐库歌单 / 专辑页显示哪个平台的账号收藏 */
    libraryAccount: LibraryAccount;
    localGroup: LocalGroup;
    localFolders: string[];
    blockedHosts: string[];
}

export const EQ_BANDS = [60, 230, 910, 3600, 14000];
export const EQ_PRESETS: Record<string, number[]> = {
    平直: [0, 0, 0, 0, 0],
    流行: [-1, 2, 4, 2, -1],
    摇滚: [4, 2, -2, 2, 4],
    低音增强: [6, 4, 0, 0, 0],
    人声: [-2, 0, 4, 3, 0],
    古典: [3, 1, -1, 1, 3],
    电子: [5, 2, 0, 2, 5],
};

export const DEFAULT_SETTINGS: Settings = {
    quality: '320k',
    qualityFallback: true,
    autoSwitchSource: true,
    skipOnError: true,
    volume: 0.8,
    muted: false,
    playMode: 'loop',
    crossfade: 0,
    resumePlayback: true,
    outputDevice: 'default',
    eqEnabled: false,
    eqGains: [0, 0, 0, 0, 0],
    lyricStyle: 'luminous',
    lyricIntensity: 'normal',
    lyricScale: 1,
    lyricFont: 'sans',
    reactive: true,
    showTranslation: true,
    showRoma: false,
    lyricOffset: 0,
    background: 'latent',
    dither: true,
    reduceMotion: false,
    liteMode: 'auto',
    theme: 'cover',
    customAccent: '#8ab4ff',
    downloadDir: '',
    downloadQuality: '320k',
    fileNameTemplate: '{name} - {singer}',
    saveLyricFile: true,
    embedMeta: true,
    closeToTray: false,
    searchPlatform: 'tx',
    plazaPlatform: 'wy',
    boardPlatform: 'tx',
    homeTab: 'mine',
    homeLayout: 'library',
    libraryTab: 'playlists',
    librarySeam: typeof window !== 'undefined' && window.innerWidth < 900 ? 'spine' : 'full',
    librarySeamRestore: 'full',
    libraryAccount: 'wy',
    localGroup: 'albums',
    localFolders: [],
    blockedHosts: [],
};

const KEY = 'ye.settings.v2';

function load(): Settings {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        const merged = { ...DEFAULT_SETTINGS, ...saved };
        if (!Array.isArray(merged.eqGains) || merged.eqGains.length !== EQ_BANDS.length) merged.eqGains = [...DEFAULT_SETTINGS.eqGains];
        if (merged.lyricStyle !== 'luminous' && merged.lyricStyle !== 'flow' && !isFoliaMode(merged.lyricStyle)) merged.lyricStyle = DEFAULT_SETTINGS.lyricStyle;
        return merged;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export const useSettings = create<Settings>(() => load());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useSettings.subscribe(state => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(KEY, JSON.stringify(state)), 200);
});

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    useSettings.setState({ [key]: value } as Pick<Settings, K>);
}

export function resetSettings() {
    useSettings.setState({ ...DEFAULT_SETTINGS, localFolders: useSettings.getState().localFolders });
}
