/** 界面状态：当前页、浮层、对话框、右键菜单 */
import { create } from 'zustand';
import type { Palette } from '@/lib/color';
import type { OnlinePlaylist, Platform, Track } from '@/sdk/types';
import type { AccountPlatform } from './accounts';

export type DetailTarget =
    | { kind: 'user'; id: string }
    | { kind: 'songlist'; platform: Platform; id: string; info?: Partial<OnlinePlaylist> }
    | { kind: 'board'; platform: Platform; id: string; name: string }
    /** 网易云 / QQ音乐专辑（QQ音乐的 id 为 albumMid） */
    | { kind: 'album'; platform: 'wy' | 'tx'; id: string; info?: Partial<OnlinePlaylist> }
    /** 网易云每日推荐 */
    | { kind: 'daily'; platform: 'wy'; id: 'daily' }
    /** 猜我喜欢（本机根据收藏 / 播放记录生成；platform 只是沿用“联网加载列表”的流程，没有实际含义） */
    | { kind: 'guess'; platform: 'wy'; id: 'guess' }
    /** 本地分组（专辑 / 歌手 / 文件夹）：按 id 列表从曲库取歌 */
    | { kind: 'tracks'; id: string; name: string; desc?: string; cover?: string; trackIds: string[] };

/** 需要联网加载歌曲列表的详情页 */
export type RemoteTarget = Extract<DetailTarget, { platform: Platform }>;
export const isRemoteTarget = (target: DetailTarget | null | undefined): target is RemoteTarget => Boolean(target && 'platform' in target);

export type PanelTab = 'cover' | 'lyrics' | 'controls' | 'queue' | 'source';
export type SettingsTab = 'playback' | 'sources' | 'lyrics' | 'appearance' | 'download' | 'library' | 'about';

export type Dialog =
    | { type: 'createPlaylist'; trackIds?: string[] }
    | { type: 'renamePlaylist'; id: string; name: string }
    | { type: 'addToPlaylist'; tracks: Track[] }
    | { type: 'importPlaylist' }
    | { type: 'confirm'; title: string; message: string; confirmText?: string; danger?: boolean; onConfirm: () => void }
    | { type: 'trackInfo'; track: Track }
    | { type: 'login'; platform: AccountPlatform };

export interface ContextMenuState {
    x: number;
    y: number;
    track: Track;
    list?: Track[];
    playlistId?: string;
}

/**
 * 共享元素过渡的起点：点开某张海报时这张海报在屏幕上的矩形。
 *
 * 为什么不用 framer-motion 的 layoutId：墙面（Home）在详情页打开时并没有卸载，只是被
 * 淡出隐藏，两个同 layoutId 的元素会同时存在，framer 会把动画派给错误的那一个。
 * 所以这里只记录一个「起点矩形 + 时间戳」，由详情页在挂载时量出终点、算出差值自己飞过去。
 *
 * t 用来判断这个矩形还新不新鲜：轮播首页、搜索页这些入口也走 openDetail()，
 * 但它们的来源不是墙面，如果沿用上一次遗留的矩形，封面会从莫名其妙的位置飞进来。
 */
export interface CoverFlight {
    x: number;
    y: number;
    w: number;
    h: number;
    t: number;
}

interface UiState {
    detail: DetailTarget | null;
    searchOpen: boolean;
    searchQuery: string;
    playerOpen: boolean;
    panelOpen: boolean;
    panelTab: PanelTab;
    settingsOpen: boolean;
    settingsTab: SettingsTab;
    dialog: Dialog | null;
    menu: ContextMenuState | null;
    idle: boolean;
    /** 墙面 → 详情页的封面飞行起点（见 CoverFlight 注释） */
    coverFlight: CoverFlight | null;
    /** 首页 / 详情页当前焦点封面的调色板，用于背景 */
    bgPalette: Palette | null;
}

export const useUi = create<UiState>(() => ({
    detail: null,
    searchOpen: false,
    searchQuery: '',
    playerOpen: false,
    panelOpen: false,
    panelTab: 'controls',
    settingsOpen: false,
    settingsTab: 'playback',
    dialog: null,
    menu: null,
    idle: false,
    coverFlight: null,
    bgPalette: null,
}));

export const ui = {
    // 保留 1.2 秒内的飞行起点，更早的丢弃（其他入口不该凭空飞封面）
    openDetail: (detail: DetailTarget) =>
        useUi.setState(s => ({
            detail,
            searchOpen: false,
            playerOpen: false,
            coverFlight: s.coverFlight && Date.now() - s.coverFlight.t < 1200 ? s.coverFlight : null,
        })),
    /** 记录共享元素的起点矩形（墙面海报点击时调用）；传 null 清空 */
    setCoverFlight: (rect: { x: number; y: number; width: number; height: number } | null) =>
        useUi.setState({ coverFlight: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height, t: Date.now() } : null }),
    clearCoverFlight: () => useUi.setState({ coverFlight: null }),
    closeDetail: () => useUi.setState({ detail: null }),
    openSearch: (query?: string) => useUi.setState(s => ({ searchOpen: true, searchQuery: query ?? s.searchQuery })),
    closeSearch: () => useUi.setState({ searchOpen: false }),
    openPlayer: () => useUi.setState({ playerOpen: true, searchOpen: false }),
    closePlayer: () => useUi.setState({ playerOpen: false, panelOpen: false }),
    togglePanel: (tab?: PanelTab) => useUi.setState(s => ({ panelOpen: tab ? !(s.panelOpen && s.panelTab === tab) : !s.panelOpen, panelTab: tab || s.panelTab })),
    openSettings: (tab?: SettingsTab) => useUi.setState(s => ({ settingsOpen: true, settingsTab: tab || s.settingsTab })),
    closeSettings: () => useUi.setState({ settingsOpen: false }),
    dialog: (dialog: Dialog | null) => useUi.setState({ dialog }),
    menu: (menu: ContextMenuState | null) => useUi.setState({ menu }),
    confirm: (title: string, message: string, onConfirm: () => void, options: { confirmText?: string; danger?: boolean } = {}) =>
        useUi.setState({ dialog: { type: 'confirm', title, message, onConfirm, ...options } }),
};
