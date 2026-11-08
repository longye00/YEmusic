/**
 * 全屏搜索。0.6.0 起按 Folia 0.7.26 的「版面式」搜索设计重做（结构与数值直接移植自
 * Folia 的 search.css，AGPL-3.0，见 search.css 头注释与 THIRD_PARTY_NOTICES.md）：
 *
 *   - 直角、发丝线、大号标题字：不再有圆角胶囊与整片毛玻璃卡片。输入框只有一条 2px 下边线，
 *     左边一个 12px 主题色方块，搜索时方块转起来（Folia 的 .search-field-mark.is-busy）。
 *   - 两层导航：上排「来源」（平台，13px 粗体 + 3px 主题色下划线，滑块用 layoutId 平移），
 *     下排「类型」（歌曲 / 专辑 / 歌手，序号 01 02 03 + clamp(22px,3.2vw,34px) 900 字重大字）。
 *     Folia 的类型来自它的服务端；YEmusic 的平台 SDK 只有歌曲检索，
 *     所以专辑 / 歌手由本次结果在本地聚合出来（专辑能开详情就开详情，开不了就落成本地分组）。
 *   - 结果面板 .search-plane：76px 行、48px 方封面、行间发丝线、
 *     左侧 3px 主题色竖条从底部展开（高亮/悬停）、序号悬停变主题色、
 *     右侧操作按钮平时隐藏、悬停才浮到 .7（触屏常驻）。
 *   - 背景版面 .search-comp：斜切色块 / 圆环 / 圆点 / 横条 / 两条斜线 / 网点 / 竖排搜索词，
 *     按当前类型换一套位移（Folia 的 data-search-kind），换来源时扫过一道光带。
 *   - 空结果是「圆环 + 一道斜杠」（.search-void），加载是三个跳动的方块（.search-loader），
 *     按钮是带方块的直角描边按钮（.search-flat-button）。
 *
 * 键盘：↑↓ 跨组连续移动高亮、Enter 播放、Shift+Enter 加入队列、Tab / Shift+Tab 切来源、
 * ← → 切类型、Esc 关闭（交给全局 shortcuts.ts 的分层关闭，这里不再关一次）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ChevronDown, Clock, CornerDownLeft, Flame, ListPlus, Play, Plus, Trash2, X } from 'lucide-react';
import { isLite, useLite } from '@/lib/lite';
import { sdks } from '@/sdk';
import { bestQuality, PLATFORM_NAMES, PLATFORMS, QUALITY_SHORT, type Platform, type Track } from '@/sdk/types';
import { toggleFavorite, useLibrary } from '@/store/library';
import { toast } from '@/store/toast';
import { addToQueue, playTrack, usePlayer } from '@/store/player';
import { setSetting, useSettings } from '@/store/settings';
import { ui, useUi, type DetailTarget } from '@/store/ui';
import { useCompact, useIsFavorite } from '../hooks';
import { css, useTheme, type RGB } from '../theme';
import { Cover, IconButton, PlayingBars, cx } from '../components/common';
import { MOTION } from '../motion';
import { ControlPill } from '../player/ControlPill';
import './search.css';

type Scope = Platform | 'local' | 'all';
type Kind = 'song' | 'album' | 'artist';

const HISTORY_KEY = 'ye.searchHistory';
/** 每组先显示这么多，其余按需展开（避免一次渲染几百行） */
const GROUP_INITIAL = 6;
/** 本地结果一次渲染的行数上限：本地最多 500 条，每行带封面图，全渲染会卡 */
const LOCAL_INITIAL = 60;
/** 结果到了之后这么久，行的入场动画放完：再滚出来的行不再滑入（Folia 的 ROW_REVEAL_MS） */
const ROW_REVEAL_MS = 1000;
const DEBOUNCE_MS = 350;
const SCOPES: Scope[] = [...PLATFORMS, 'local', 'all'];
const KINDS: Kind[] = ['song', 'album', 'artist'];
const KIND_NAMES: Record<Kind, string> = { song: '歌曲', album: '专辑', artist: '歌手' };

function readHistory(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

const scopeLabel = (scope: Scope) => (scope === 'local' ? '本地曲库' : scope === 'all' ? '全部平台' : PLATFORM_NAMES[scope]);

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * 版面配色（Folia 的 --search-ink / accent / paper / hairline）。
 * 全部由当前主题派生，跟着封面取色 / 自定义主色一起变；
 * 不在 CSS 里用 color-mix()，Chrome 111 以前的 Android WebView 解析不了，
 * 所以每种颜色都同时给出「三元组」变量，供 rgb(var(--x-triple) / a) 调透明度。
 */
function searchTokens(theme: ReturnType<typeof useTheme>, lite: boolean): Record<string, string> {
    const ink = mix([255, 255, 255], theme.accentSoft, 0.14);
    const paper = mix([8, 8, 10], theme.panel, 0.14);
    const triple = (c: RGB) => `${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}`;
    return {
        '--search-ink': css(ink),
        '--search-ink-triple': triple(ink),
        '--search-ink-soft': `rgb(${triple(ink)} / ${lite ? 0.66 : 0.55})`,
        '--search-hairline': `rgb(${triple(ink)} / ${lite ? 0.16 : 0.09})`,
        '--search-accent': css(theme.accentSoft),
        '--search-accent-triple': triple(theme.accentSoft),
        // 纸色不透明（Folia 用实心的 #08080a）：整版盖住窗口，底下内容不透出来
        '--search-paper': css(paper),
        '--search-paper-triple': triple(paper),
    };
}

interface Group { key: Platform; list: Track[]; total: number; loading: boolean; error?: string }

/** 一行的稳定标识：歌曲用 track.id，专辑 / 歌手用聚合 key */
const rowKey = (row: Track | Collection) => ('key' in row ? row.key : row.id);

/** 本地聚合出来的专辑 / 歌手条目 */
interface Collection {
    key: string;
    name: string;
    sub: string;
    cover?: string;
    tracks: Track[];
    platform: Platform | 'local';
    albumId?: string;
}

/** 结果行：76px，方封面，发丝线，左侧主题色竖条 */
function SongRow({ track, index, active, onHover, onPlay, onQueue, onCollect, showPlatform }: {
    track: Track;
    index: number;
    active: boolean;
    onHover: () => void;
    onPlay: () => void;
    onQueue: () => void;
    onCollect: () => void;
    showPlatform: boolean;
}) {
    const isCurrent = usePlayer(s => s.current?.id === track.id);
    const status = usePlayer(s => (s.current?.id === track.id ? s.status : 'idle'));
    const liked = useIsFavorite(track.id);
    return (
        <div
            role="option"
            aria-selected={active}
            onPointerMove={onHover}
            onClick={onPlay}
            style={{ '--search-row-order': index } as React.CSSProperties}
            className={cx('search-row group cursor-pointer', active && 'is-active', isCurrent && 'is-current')}
        >
            <span className="search-row-index" aria-hidden>
                {isCurrent ? <PlayingBars paused={status !== 'playing'} className="text-[color:var(--search-accent)]" /> : String(index + 1).padStart(2, '0')}
            </span>
            <span className="search-row-cover">
                <Cover src={track.cover} size={96} seed={track.name} alt="" rounded="" className="h-full w-full" eager={index < 12}>
                    <span className="search-row-play" aria-hidden>
                        <Play className="h-[18px] w-[18px]" fill="currentColor" />
                    </span>
                </Cover>
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="search-row-title truncate">{track.name}</span>
                    {(() => { const q = bestQuality(track); return q === 'flac' || q === 'flac24bit' ? <span className="search-row-tag">{QUALITY_SHORT[q]}</span> : null; })()}
                    {showPlatform && <span className="search-row-tag">{PLATFORM_NAMES[track.source]}</span>}
                </div>
                <div className="search-row-sub mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{track.singer}</span>
                    {track.album && (
                        <>
                            <span className="shrink-0 opacity-40" aria-hidden>/</span>
                            <span className="max-w-[45%] truncate">{track.album}</span>
                        </>
                    )}
                </div>
            </div>
            <span className="search-row-time hidden shrink-0 sm:block">
                {track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : ''}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
                <button type="button" onClick={event => { event.stopPropagation(); onCollect(); }} className="search-row-action" title={liked ? '取消收藏' : '收藏'} aria-label={liked ? '取消收藏' : '收藏'}>
                    <Plus className={cx('h-4 w-4 transition-transform', liked && 'rotate-45')} />
                </button>
                <button type="button" onClick={event => { event.stopPropagation(); onQueue(); }} className="search-row-action" title="加入队列 (Shift + Enter)" aria-label="加入队列">
                    <ListPlus className="h-4 w-4" />
                </button>
                {active && (
                    <span className="search-row-enter hidden sm:inline-flex">
                        <CornerDownLeft className="h-3 w-3" />播放
                    </span>
                )}
            </span>
        </div>
    );
}

/** 专辑 / 歌手行：84px，方封面后面垫一张会滑开的主题色方块（Folia 的 .search-collection-*） */
function CollectionRow({ item, index, active, onHover, onOpen }: {
    item: Collection;
    index: number;
    active: boolean;
    onHover: () => void;
    onOpen: () => void;
}) {
    return (
        <div
            role="option"
            aria-selected={active}
            onPointerMove={onHover}
            onClick={onOpen}
            style={{ '--search-row-order': index } as React.CSSProperties}
            className={cx('search-row is-collection group cursor-pointer', active && 'is-active')}
        >
            <span className="search-row-index" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
            <span className="search-collection-art" aria-hidden>
                <span className={item.albumId ? 'search-collection-disc' : 'search-collection-shadow'} />
                <span className="search-row-cover">
                    <Cover src={item.cover} size={116} seed={item.name} alt="" rounded="" className="h-full w-full" />
                </span>
            </span>
            <div className="min-w-0 flex-1">
                <div className="search-row-title truncate">{item.name}</div>
                <div className="search-row-sub mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{item.sub}</span>
                </div>
            </div>
            <span className="search-row-count">{item.tracks.length} 首</span>
            <ArrowUpRight className="search-row-arrow h-4 w-4 shrink-0" aria-hidden />
        </div>
    );
}

export function SearchOverlay() {
    const query = useUi(s => s.searchQuery);
    // 在播放页上打开：浮到歌词之上，用更深的底；播放页自身的控件隐藏，只留一套传输控件
    const overPlayer = useUi(s => s.playerOpen);
    const compact = useCompact();
    const savedPlatform = useSettings(s => s.searchPlatform);
    const bgPalette = useUi(s => s.bgPalette);
    const playerPalette = usePlayer(s => s.palette);
    const theme = useTheme(overPlayer ? playerPalette : bgPalette || playerPalette);
    const lite = useLite();
    const [scope, setScope] = useState<Scope>(savedPlatform);
    const [kind, setKind] = useState<Kind>('song');
    const [text, setText] = useState(query);
    const [history, setHistory] = useState(readHistory);
    const [hot, setHot] = useState<string[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [entered, setEntered] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const tracks = useLibrary(s => s.tracks);
    const seq = useRef(0);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    // 热搜只与单一平台相关；「全部」和「本地」没有热搜
    useEffect(() => {
        if (scope === 'local' || scope === 'all') { setHot([]); return; }
        let alive = true;
        setHot([]);
        sdks[scope].hotSearch?.().then(list => { if (alive) setHot(list.slice(0, 12)); }).catch(() => {});
        return () => { alive = false; };
    }, [scope]);

    const keyword = text.trim();

    /** 本地 / 曲库：在已导入与收藏过的歌曲里过滤（不分页） */
    const localList = useMemo(() => {
        if (scope !== 'local' || !keyword) return [];
        const q = keyword.toLowerCase();
        return Object.values(tracks).filter(t => `${t.name} ${t.singer} ${t.album}`.toLowerCase().includes(q)).slice(0, 500);
    }, [scope, keyword, tracks]);

    // 边打边搜：防抖后按当前范围发请求；竞态用 seq 丢弃过期结果
    useEffect(() => {
        const id = ++seq.current;
        setActiveId(null);
        setExpanded({});
        if (!keyword || scope === 'local') { setGroups([]); return; }
        const targets: Platform[] = scope === 'all' ? PLATFORMS : [scope];
        // 先把目标平台铺成 loading 骨架，界面立刻有反馈
        setGroups(targets.map(p => ({ key: p, list: [], total: 0, loading: true })));
        const timer = setTimeout(() => {
            void Promise.all(targets.map(async (p): Promise<Group> => {
                try {
                    const res = await sdks[p].search(keyword, 1, 30);
                    return { key: p, list: res.list, total: res.total, loading: false };
                } catch (error) {
                    return { key: p, list: [], total: 0, loading: false, error: (error as Error).message || '搜索失败' };
                }
            })).then(result => {
                if (id !== seq.current) return;
                setGroups(result);
                // 只把真有结果的词写进历史，避免留下打错的半截词
                if (result.some(g => g.list.length)) {
                    const next = [keyword, ...readHistory().filter(h => h !== keyword)].slice(0, 20);
                    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* 存储不可用时只留在内存 */ }
                    setHistory(next);
                }
            });
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [keyword, scope]);

    /** 当前范围下的全部结果（含折叠部分）：播放上下文与专辑 / 歌手聚合都走这一份 */
    const allRows = useMemo(() => (scope === 'local' ? localList : groups.flatMap(g => g.list)), [groups, localList, scope]);

    /**
     * 专辑 / 歌手：把本次结果在本地聚合出来。
     * 平台 SDK 只有歌曲检索，Folia 的「专辑 / 歌手」两类在这里换成同一种做法 —— 按字段归堆。
     * 专辑有 albumId 且平台支持（网易云 / QQ音乐）就能开专辑详情页，否则落成本地分组页。
     */
    const collections = useMemo<Collection[]>(() => {
        if (kind === 'song') return [];
        const map = new Map<string, Collection>();
        for (const track of allRows) {
            const raw = kind === 'album' ? track.album : track.singer;
            const names = (raw || '').split(/[\/、,，]/).map(s => s.trim()).filter(Boolean);
            if (!names.length) continue;
            for (const name of kind === 'album' ? names.slice(0, 1) : names) {
                const key = `${track.source}:${name}`;
                const hit = map.get(key);
                if (hit) {
                    hit.tracks.push(track);
                    if (!hit.cover && track.cover) hit.cover = track.cover;
                } else {
                    map.set(key, {
                        key,
                        name,
                        sub: kind === 'album' ? track.singer : `${track.album || '单曲'} · ${PLATFORM_NAMES[track.source]}`,
                        cover: track.cover,
                        tracks: [track],
                        platform: track.source,
                        albumId: kind === 'album' && (track.source === 'wy' || track.source === 'tx') ? track.albumId : undefined,
                    });
                }
            }
        }
        return [...map.values()].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 200);
    }, [allRows, kind]);

    /** 当前「已渲染」的行 —— 键盘上下移动与 scrollIntoView 走这一份，跨组连续 */
    /** 当前「已渲染」的行 —— 键盘上下移动与 scrollIntoView 走这一份，跨组连续 */
    const flat = useMemo<(Track | Collection)[]>(() => {
        if (kind !== 'song') return collections.slice(0, expanded.collections ? collections.length : GROUP_INITIAL * 2);
        if (scope === 'local') return localList.slice(0, expanded.local ? localList.length : Math.min(LOCAL_INITIAL, localList.length));
        return groups.flatMap(g => g.list.slice(0, expanded[g.key] ? g.list.length : Math.min(GROUP_INITIAL, g.list.length)));
    }, [collections, expanded, groups, kind, localList, scope]);

    const activeIndex = flat.findIndex(row => rowKey(row) === activeId);

    const play = useCallback((track: Track) => {
        // 先关搜索再播：playTrack / loadIndex 会改 player store，本组件每行都订阅了
        // usePlayer；退出动画（MOTION.dur.move ≈ 0.22s）里子树一旦跟着重渲染，会把
        // AnimatePresence 的退出卡在终态——透明度 0 却一直挂在 DOM 里，隐形盖住整窗、
        // 吞掉后续所有点击。推迟到退出跑完再播。
        const list = allRows.length > 1 ? allRows : undefined;
        ui.closeSearch();
        setTimeout(() => playTrack(track, list), 300);
    }, [allRows]);

    const queue = useCallback((track: Track) => addToQueue([track]), []);

    const collect = useCallback((track: Track) => {
        const on = toggleFavorite(track);
        toast(on ? '已添加到「我喜欢的音乐」' : '已取消喜欢', on ? 'success' : 'info', { duration: 1300, key: 'like' });
    }, []);

    const openCollection = useCallback((item: Collection) => {
        const target: DetailTarget = item.albumId && (item.platform === 'wy' || item.platform === 'tx')
            ? { kind: 'album', platform: item.platform, id: item.albumId, info: { name: item.name, cover: item.cover } }
            : {
                kind: 'tracks',
                id: item.key,
                name: item.name,
                desc: item.sub,
                cover: item.cover,
                trackIds: item.tracks.map(t => t.id),
            };
        // 同 play()：openDetail 与 closeSearch 落在同一批渲染时，退出中的子树跟着
        // 重渲染会卡死 AnimatePresence 的退出（元素停在透明度 0 还挂在 DOM 里）。
        // 先只关搜索，等退出动画（≈0.22s）跑完再开详情。
        ui.closeSearch();
        setTimeout(() => ui.openDetail(target), 300);
    }, []);

    // 高亮行滚进视野
    useEffect(() => {
        if (!activeId) return;
        listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [activeId]);

    // 行入场动画只在「换了一组结果」时跑一次：结果挂上 ROW_REVEAL_MS 内列表没有
    // data-search-entered，行按序刷入；之后打上标记，再滚出来的行不再滑入（Folia 同规则）
    const revealKey = `${scope}:${kind}:${keyword}`;
    useEffect(() => {
        setEntered(null);
        const timer = setTimeout(() => setEntered(revealKey), ROW_REVEAL_MS);
        return () => clearTimeout(timer);
    }, [revealKey]);

    const changeScope = (next: Scope) => {
        setScope(next);
        setActiveId(null);
        if (next !== 'local' && next !== 'all') setSetting('searchPlatform', next);
    };

    const stepKind = (delta: number) => setKind(k => KINDS[(KINDS.indexOf(k) + delta + KINDS.length) % KINDS.length]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        // 输入法组合中（中文候选框）不抢方向键与回车
        if (event.nativeEvent.isComposing) return;
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (step) {
            event.preventDefault();
            if (!flat.length) return;
            const next = activeIndex < 0
                ? (step > 0 ? 0 : flat.length - 1)
                : Math.max(0, Math.min(flat.length - 1, activeIndex + step));
            setActiveId(rowKey(flat[next]));
            return;
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            stepKind(event.key === 'ArrowRight' ? 1 : -1);
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            const i = SCOPES.indexOf(scope);
            changeScope(SCOPES[(i + (event.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length]);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const item = activeIndex >= 0 ? flat[activeIndex] : null;
            if (item) {
                if (kind !== 'song') openCollection(item as Collection);
                else if (event.shiftKey) queue(item as Track);
                else play(item as Track);
            } else if (flat.length) {
                // 还没移动过高亮：第一次回车选中第一条，第二次才打开
                setActiveId(rowKey(flat[0]));
            }
            return;
        }
        // Escape 不在这里处理：全局 shortcuts.ts 已有分层关闭逻辑（菜单 → 对话框 / 设置 →
        // 面板 → 播放页 → 搜索 → 详情），在这里再关一次会让一次按键连关两层，
        // 把搜索底下的详情页一起带走。
    };

    const pickKeyword = (value: string) => {
        setText(value);
        inputRef.current?.focus();
    };

    const searching = groups.some(g => g.loading);
    const shownCount = kind === 'song' ? allRows.length : collections.length;
    const totalCount = kind === 'song'
        ? groups.reduce((sum, g) => sum + (g.total || g.list.length), 0) || allRows.length
        : collections.length;
    const empty = !keyword;
    const nothingFound = !empty && !searching && shownCount === 0;
    const unit = kind === 'song' ? '首' : kind === 'album' ? '张' : '位';

    return (
        <motion.div
            className={cx('search-workspace absolute inset-0 flex flex-col overflow-hidden px-4 py-5 sm:px-8 sm:py-7', overPlayer ? 'z-[70]' : 'z-50')}
            style={searchTokens(theme, lite)}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 28 }}
            transition={{ duration: MOTION.dur.move, ease: MOTION.ease.standard }}
        >
            <div className="drag absolute inset-x-0 top-0 z-10 h-10 touch:hidden" />

            {/* 背景版面：纯装饰，不接管指针。站位随来源序号换，换来源/类型扫一道光带 */}
            <SearchComposition kind={kind} query={keyword} stageKey={`${scope}:${kind}`} stageIndex={SCOPES.indexOf(scope)} />

            <header className="relative z-[1] mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-5 pt-8">
                <div className="flex items-center gap-4">
                    <div className="search-field flex-1">
                        <span className={cx('search-field-mark', searching && 'is-busy')} aria-hidden />
                        <input
                            ref={inputRef}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder={kind === 'song' ? '搜索歌曲、歌手、专辑' : kind === 'album' ? '搜索专辑' : '搜索歌手'}
                            aria-label="搜索"
                            role="combobox"
                            aria-expanded={flat.length > 0}
                            aria-controls="search-results"
                        />
                        {text ? (
                            <button type="button" onClick={() => { setText(''); inputRef.current?.focus(); }} className="search-field-clear" title="清空" aria-label="清空">
                                <X className="h-4 w-4" />
                            </button>
                        ) : null}
                    </div>
                    <button type="button" onClick={ui.closeSearch} className="search-close" aria-label="关闭搜索 (Esc)" title="关闭搜索 (Esc)">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <nav className="search-sources scrollbar-none" aria-label="搜索来源">
                    {SCOPES.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => changeScope(p)}
                            aria-current={scope === p ? 'true' : undefined}
                            className={cx('search-source', scope === p && 'is-active')}
                        >
                            {scopeLabel(p)}
                            {scope === p && (
                                <motion.span layoutId="ye-search-source-mark" className="search-source-mark" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                            )}
                        </button>
                    ))}
                </nav>

                <div className="search-kinds scrollbar-none" role="tablist" aria-label="结果类型">
                    {KINDS.map((k, i) => (
                        <button
                            key={k}
                            type="button"
                            role="tab"
                            aria-selected={kind === k}
                            onClick={() => { setKind(k); setActiveId(null); }}
                            className={cx('search-kind', kind === k && 'is-active')}
                        >
                            {kind === k && <motion.span layoutId="ye-search-kind-mark" className="search-kind-mark" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                            <span className="search-kind-number" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                            <span className="search-kind-label">{KIND_NAMES[k]}</span>
                        </button>
                    ))}
                </div>

                <div className="search-meta">
                    <span>{scopeLabel(scope)}</span>
                    {!empty && shownCount > 0 && <span>共 {totalCount}{unit}{kind === 'song' && totalCount > shownCount ? ` · 已取 ${shownCount}` : ''}</span>}
                    {searching && <span>搜索中</span>}
                </div>
            </header>

            <div id="search-results" className="search-plane relative z-[1] mx-auto mt-3 flex w-full max-w-5xl min-h-0 flex-1 flex-col">
                {empty ? (
                    <div className="scroll-thin space-y-8 overflow-y-auto px-2 py-6 sm:px-4">
                        {history.length > 0 && (
                            <section>
                                <div className="search-meta has-action mb-3">
                                    <Clock className="h-3.5 w-3.5" />最近搜索
                                    <span className="search-meta-rule" aria-hidden />
                                    <button type="button" onClick={() => { try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } setHistory([]); }} className="search-meta-btn">
                                        <Trash2 className="h-3 w-3" />清空
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {history.map(h => (
                                        <button key={h} type="button" onClick={() => pickKeyword(h)} className="search-chip">{h}</button>
                                    ))}
                                </div>
                            </section>
                        )}
                        {hot.length > 0 && (
                            <section>
                                <div className="search-meta mb-3"><Flame className="h-3.5 w-3.5" />{scopeLabel(scope)}热搜</div>
                                <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 md:grid-cols-3">
                                    {hot.map((h, i) => (
                                        <button key={h} type="button" onClick={() => pickKeyword(h)} className="search-hot">
                                            <span className={cx('search-hot-rank', i < 3 && 'is-top')}>{String(i + 1).padStart(2, '0')}</span>
                                            <span className="truncate">{h}</span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}
                        {!history.length && !hot.length && (
                            <div className="flex flex-col items-center gap-6 py-14 text-center">
                                <div className="search-void is-small" aria-hidden />
                                <p className="search-note">想听点什么？</p>
                                <p className="search-note is-soft">直接输入歌名、歌手或专辑，边打边搜。Tab 切来源，← → 切歌曲 / 专辑 / 歌手。</p>
                            </div>
                        )}
                    </div>
                ) : searching && shownCount === 0 ? (
                    <div className="grid flex-1 place-items-center">
                        <div className="search-loader" role="status" aria-label="搜索中"><i /><i /><i /></div>
                    </div>
                ) : nothingFound ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
                        <div className="search-void" aria-hidden />
                        <p className="search-note">{groups.some(g => g.error) ? '搜索出错了' : '没有找到结果'}</p>
                        {groups.some(g => g.error) ? (
                            <button type="button" onClick={() => { const s = scope; setScope('all'); changeScope(s === 'all' ? 'tx' : s); }} className="search-flat-button">重试</button>
                        ) : (
                            <p className="search-note is-soft">换个关键词，或按 Tab 缩小到单个平台。</p>
                        )}
                    </div>
                ) : (
                    <>
                        <div
                            ref={listRef}
                            role="listbox"
                            aria-label="搜索结果"
                            data-search-entered={entered === revealKey ? '' : undefined}
                            className="search-list scroll-thin min-h-0 flex-1 overflow-y-auto pb-24"
                        >
                            {kind !== 'song' ? (
                                <>
                                    {collections.slice(0, expanded.collections ? collections.length : GROUP_INITIAL * 2).map((item, i) => (
                                        <div key={item.key} data-active={item.key === activeId}>
                                            <CollectionRow item={item} index={i} active={item.key === activeId} onHover={() => setActiveId(item.key)} onOpen={() => openCollection(item)} />
                                        </div>
                                    ))}
                                    {collections.length > GROUP_INITIAL * 2 && (
                                        <div className="flex justify-center py-4">
                                            <button type="button" onClick={() => setExpanded(e => ({ ...e, collections: !e.collections }))} className="search-flat-button">
                                                {expanded.collections ? '收起' : `展开其余 ${collections.length - GROUP_INITIAL * 2} ${unit}`}
                                                <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', expanded.collections && 'rotate-180')} />
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : scope === 'local' ? (
                                <>
                                    {flat.map((item, i) => {
                                        const track = item as Track;
                                        return (
                                            <div key={track.id} data-active={track.id === activeId}>
                                                <SongRow track={track} index={i} active={track.id === activeId} onHover={() => setActiveId(track.id)} onPlay={() => play(track)} onQueue={() => queue(track)} onCollect={() => collect(track)} showPlatform={false} />
                                            </div>
                                        );
                                    })}
                                    {localList.length > LOCAL_INITIAL && (
                                        <div className="flex justify-center py-4">
                                            <button type="button" onClick={() => setExpanded(e => ({ ...e, local: !e.local }))} className="search-flat-button">
                                                {expanded.local ? '收起' : `展开其余 ${localList.length - LOCAL_INITIAL} 首`}
                                                <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', expanded.local && 'rotate-180')} />
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                groups.map(group => {
                                    const shown = expanded[group.key] ? group.list : group.list.slice(0, GROUP_INITIAL);
                                    return (
                                        <section key={group.key}>
                                            {groups.length > 1 && (
                                                <div className="search-meta search-group-head">
                                                    <span>{PLATFORM_NAMES[group.key]}</span>
                                                    {group.loading ? <span>…</span> : group.error ? <span className="search-error">{group.error}</span> : <span>{group.total || group.list.length} 首</span>}
                                                </div>
                                            )}
                                            {group.loading ? (
                                                <div>{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[76px]" />)}</div>
                                            ) : group.list.length ? (
                                                <>
                                                    {shown.map((track, i) => (
                                                        <div key={track.id} data-active={track.id === activeId}>
                                                            <SongRow track={track} index={i} active={track.id === activeId} onHover={() => setActiveId(track.id)} onPlay={() => play(track)} onQueue={() => queue(track)} onCollect={() => collect(track)} showPlatform={scope === 'all'} />
                                                        </div>
                                                    ))}
                                                    {group.list.length > GROUP_INITIAL && (
                                                        <div className="flex justify-center py-3">
                                                            <button type="button" onClick={() => setExpanded(e => ({ ...e, [group.key]: !e[group.key] }))} className="search-flat-button">
                                                                {expanded[group.key] ? '收起' : `展开其余 ${group.list.length - GROUP_INITIAL} 首`}
                                                                <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', expanded[group.key] && 'rotate-180')} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="search-note is-soft px-[18px] py-3">没有结果</div>
                                            )}
                                        </section>
                                    );
                                })
                            )}
                        </div>
                        <div className="search-hints shrink-0">
                            {kind === 'song' ? (
                                <>
                                    <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
                                    <span><kbd>Enter</kbd>播放</span>
                                    <span className="hidden sm:inline-flex"><kbd>Shift</kbd>+<kbd>Enter</kbd>加入队列</span>
                                </>
                            ) : (
                                <span><kbd>Enter</kbd>打开{KIND_NAMES[kind]}</span>
                            )}
                            <span><kbd>←</kbd><kbd>→</kbd>切类型</span>
                            <span className="hidden sm:inline-flex"><kbd>Tab</kbd>切来源</span>
                        </div>
                    </>
                )}
            </div>
            {/* 底部居中的胶囊播放栏，与详情页 / 首页一致 */}
            <div className={cx('pointer-events-none absolute inset-x-0 z-30 flex justify-center', compact ? 'bottom-[calc(0.5rem+var(--safe-bottom))] px-2' : 'bottom-6 px-4')}>
                <ControlPill variant="home" />
            </div>
        </motion.div>
    );
}

/**
 * 背景版面（Folia 的 .search-composition，按其原值复刻）：至上主义几何 + 竖排搜索词。
 * 外层 stage 按来源序号取站位（转角 / 横移 / 竖移），内层各形按类型换位（data-search-kind）。
 * 换来源 / 类型时扫过一道墨色宽带 + 主题色细线（sweep key 变化重挂载）；首次挂上只飞入不扫。
 * 精简模式（手机）整块不画：省掉 9 个大面积合成层。
 */
const STAGE_POSES: ReadonlyArray<{ turn: number; x: number; y: number }> = [
    { turn: 0, x: 0, y: 0 },
    { turn: -5, x: -3, y: 2 },
    { turn: 4, x: 2, y: -3 },
    { turn: -2, x: 4, y: 4 },
];

function SearchComposition({ kind, query, stageKey, stageIndex }: { kind: Kind; query: string; stageKey: string; stageIndex: number }) {
    // 挂上时不扫（那时有飞入），来源 / 类型换了才扫：每换一次换一个 key，扫带重新挂上、动画重新放
    const [sweep, setSweep] = useState(0);
    const shown = useRef(stageKey);
    useEffect(() => {
        if (shown.current === stageKey) return;
        shown.current = stageKey;
        setSweep(count => count + 1);
    }, [stageKey]);
    if (isLite()) return null;
    const pose = STAGE_POSES[Math.max(0, stageIndex) % STAGE_POSES.length];
    return (
        <div className="search-comp" data-search-kind={kind} aria-hidden>
            <div
                className="search-comp-stage"
                style={{
                    '--search-stage-turn': `${pose.turn}deg`,
                    '--search-stage-x': `${pose.x}vw`,
                    '--search-stage-y': `${pose.y}vh`,
                } as React.CSSProperties}
            >
                <div className="search-fig is-line is-first"><i /></div>
                <div className="search-fig is-line is-second"><i /></div>
                <div className="search-fig is-slab"><i /></div>
                <div className="search-fig is-disc"><i /></div>
                <div className="search-fig is-dot"><i /></div>
                <div className="search-fig is-bar"><i /></div>
                <div className="search-fig is-hatch"><i /></div>
                <div className="search-fig is-dots"><i>· · ·</i></div>
                {query && <div className="search-fig is-word"><i>{query}</i></div>}
            </div>
            {sweep > 0 && (
                <div key={sweep} className="search-sweep">
                    <i className="is-band" />
                    <i className="is-rule" />
                </div>
            )}
        </div>
    );
}
