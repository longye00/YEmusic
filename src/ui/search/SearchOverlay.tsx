/**
 * 全屏搜索。交互参考 Folia 0.7.25 的搜索面板：
 *   - 一个输入框，边打边搜（防抖 350ms），不必先按回车；
 *   - 结果按平台分组（Folia 按 歌曲 / 专辑 / 歌手 分组，YEmusic 的平台 SDK 只有歌曲检索，
 *     所以分组维度换成平台），每组有标题、计数、独立骨架与「展开其余」；
 *   - 全键盘驱动：↑↓ 跨组连续移动高亮、Tab 循环切换范围、Enter 播放、Shift+Enter 加入队列、Esc 关闭；
 *   - 一条常驻按键提示条，随「空输入 / 有结果」换文案。
 *
 * 提示条放在输入区下方而不是视口底部：右下角常驻 MiniPlayer（bottom-6 right-6），
 * 贴底会压住它。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Clock, CornerDownLeft, Flame, ListPlus, Loader2, Search, Trash2, X } from 'lucide-react';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, PLATFORMS, type Platform, type Track } from '@/sdk/types';
import { useLibrary } from '@/store/library';
import { addToQueue, playTrack, usePlayer } from '@/store/player';
import { setSetting, useSettings } from '@/store/settings';
import { ui, useUi } from '@/store/ui';
import { Cover, EmptyState, IconButton, PlayingBars, QualityTag, Spinner, cx } from '../components/common';
import { MiniPlayer } from '../player/MiniPlayer';

type Scope = Platform | 'local' | 'all';
const HISTORY_KEY = 'ye.searchHistory';
/** 每组先显示这么多，其余按需展开（避免一次渲染几百行） */
const GROUP_INITIAL = 6;
/** 本地结果一次渲染的行数上限：本地最多 500 条，每行带封面图，全渲染会卡 */
const LOCAL_INITIAL = 60;
const DEBOUNCE_MS = 350;
const SCOPES: Scope[] = [...PLATFORMS, 'local', 'all'];

function readHistory(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

const scopeLabel = (scope: Scope) => (scope === 'local' ? '本地 / 曲库' : scope === 'all' ? '全部平台' : PLATFORM_NAMES[scope]);

interface Group { key: Platform; list: Track[]; total: number; loading: boolean; error?: string }

/** 结果行：比曲库列表更紧凑（56px），带序号、封面、双行文字、音质角标 */
function ResultRow({ track, index, active, onHover, onPlay, onQueue }: {
    track: Track;
    index: number;
    active: boolean;
    onHover: () => void;
    onPlay: () => void;
    onQueue: () => void;
}) {
    const isCurrent = usePlayer(s => s.current?.id === track.id);
    const status = usePlayer(s => (s.current?.id === track.id ? s.status : 'idle'));
    return (
        <div
            role="option"
            aria-selected={active}
            onPointerMove={onHover}
            onClick={onPlay}
            className={cx(
                'group flex h-[56px] cursor-pointer items-center gap-3 rounded-2xl border px-3 transition-colors duration-100',
                active ? 'border-white/[0.22] bg-white/[0.12]' : isCurrent ? 'border-white/15 bg-white/[0.08]' : 'border-transparent hover:bg-white/[0.06]',
            )}
        >
            <div className="w-6 shrink-0 text-center font-mono text-[11px] text-white/30">
                {isCurrent ? <PlayingBars paused={status !== 'playing'} className="text-white" /> : index + 1}
            </div>
            <Cover src={track.cover} size={40} seed={track.name} className="h-10 w-10 shrink-0" rounded="rounded-[10px]" />
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={cx('truncate text-[13.5px] font-semibold', active || isCurrent ? 'text-white' : 'text-white/[0.88]')}>{track.name}</span>
                    <QualityTag track={track} />
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-white/45">
                    {track.singer}
                    {track.album ? <span className="text-white/[0.28]"> • {track.album}</span> : null}
                </div>
            </div>
            {/* 高亮时才露出手柄：比每行常驻一排按钮安静，也和键盘操作对上 */}
            {active ? (
                <div className="flex shrink-0 items-center gap-1.5">
                    <button
                        type="button"
                        onClick={event => { event.stopPropagation(); onQueue(); }}
                        title="加入队列 (Shift + Enter)"
                        className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/75 hover:bg-white/25 hover:text-white"
                    >
                        <ListPlus className="h-3.5 w-3.5" />
                    </button>
                    <span className="hidden items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10.5px] font-semibold text-black sm:flex">
                        <CornerDownLeft className="h-3 w-3" />播放
                    </span>
                </div>
            ) : (
                <span className="shrink-0 font-mono text-[11px] text-white/25">{track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : ''}</span>
            )}
        </div>
    );
}

export function SearchOverlay() {
    const query = useUi(s => s.searchQuery);
    const savedPlatform = useSettings(s => s.searchPlatform);
    const [scope, setScope] = useState<Scope>(savedPlatform);
    const [text, setText] = useState(query);
    const [history, setHistory] = useState(readHistory);
    const [hot, setHot] = useState<string[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

    /**
     * 当前「已渲染」的行 —— 键盘上下移动与 scrollIntoView 走这一份，跨组连续。
     * 折叠中的行不在其中，否则高亮会落到一个还不存在的元素上、滚动失效。
     */
    const flat = useMemo(() => {
        if (scope === 'local') return localList.slice(0, expanded.local ? localList.length : Math.min(LOCAL_INITIAL, localList.length));
        return groups.flatMap(g => g.list.slice(0, expanded[g.key] ? g.list.length : Math.min(GROUP_INITIAL, g.list.length)));
    }, [groups, localList, scope, expanded]);

    /** 播放上下文取全部结果（含折叠部分），这样播完可见的 60 首还能接着放 */
    const context = useMemo(() => (scope === 'local' ? localList : groups.flatMap(g => g.list)), [groups, localList, scope]);

    const activeIndex = flat.findIndex(t => t.id === activeId);
    const activeTrack = activeIndex >= 0 ? flat[activeIndex] : null;

    const play = useCallback((track: Track) => {
        playTrack(track, context.length > 1 ? context : undefined);
        ui.closeSearch();
    }, [context]);

    const queue = useCallback((track: Track) => addToQueue([track]), []);

    // 高亮行滚进视野
    useEffect(() => {
        if (!activeId) return;
        listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [activeId]);

    const changeScope = (next: Scope) => {
        setScope(next);
        if (next !== 'local' && next !== 'all') setSetting('searchPlatform', next);
    };

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
            setActiveId(flat[next].id);
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
            if (activeTrack) {
                if (event.shiftKey) queue(activeTrack);
                else play(activeTrack);
            } else if (flat.length) {
                // 还没移动过高亮：第一次回车选中第一条，第二次才播放
                setActiveId(flat[0].id);
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
    const totalCount = scope === 'local' ? localList.length : groups.reduce((sum, g) => sum + g.list.length, 0);
    const empty = !keyword;
    const nothingFound = !empty && !searching && flat.length === 0;

    return (
        <motion.div className="absolute inset-0 z-50 flex flex-col bg-[var(--surface-overlay)] backdrop-blur-2xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="drag absolute inset-x-0 top-0 h-10 touch:hidden" />
            <motion.div className="mx-auto flex w-full max-w-[900px] min-h-0 flex-1 flex-col px-8 pt-12 max-sm:px-4 max-sm:pt-4" initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
                <div className="flex items-center gap-2.5">
                    <div className="flex h-[52px] flex-1 items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.05] px-4 transition-colors focus-within:border-white/30 focus-within:bg-white/[0.07]">
                        {searching ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-white/55" /> : <Search className="h-[18px] w-[18px] shrink-0 text-white/45" />}
                        <input
                            ref={inputRef}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="搜索歌曲、歌手、专辑"
                            aria-label="搜索"
                            role="combobox"
                            aria-expanded={flat.length > 0}
                            aria-controls="search-results"
                            className="h-full flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-white/[0.28]"
                        />
                        {text ? (
                            <button type="button" onClick={() => { setText(''); inputRef.current?.focus(); }} title="清空" className="shrink-0 text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
                        ) : (
                            <kbd className="shrink-0 text-white/25">Esc</kbd>
                        )}
                    </div>
                    <IconButton variant="glass" size="lg" label="关闭搜索 (Esc)" onClick={ui.closeSearch}><X className="h-5 w-5" /></IconButton>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {SCOPES.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => changeScope(p)}
                            className={cx(
                                'h-7 rounded-full px-3 text-[12px] font-medium transition-colors',
                                scope === p ? 'bg-white text-black' : 'bg-white/[0.07] text-white/65 hover:bg-white/[0.14] hover:text-white',
                            )}
                        >
                            {scopeLabel(p)}
                        </button>
                    ))}
                    {!empty && totalCount > 0 && <span className="ml-auto font-mono text-[11px] text-white/30">共 {totalCount} 首</span>}
                </div>

                <div id="search-results" className="mt-4 flex min-h-0 flex-1 flex-col">
                    {empty ? (
                        <div className="scroll-thin space-y-7 overflow-y-auto pb-10">
                            {history.length > 0 && (
                                <section>
                                    <div className="mb-2.5 flex items-center justify-between">
                                        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/40"><Clock className="h-3.5 w-3.5" />最近搜索</h3>
                                        <button type="button" onClick={() => { try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } setHistory([]); }} className="flex items-center gap-1 text-[11.5px] text-white/30 hover:text-white/70"><Trash2 className="h-3 w-3" />清空</button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {history.map(h => (
                                            <button key={h} type="button" onClick={() => pickKeyword(h)} className="h-7 max-w-[240px] truncate rounded-full bg-white/[0.06] px-3 text-[12px] text-white/70 hover:bg-white/[0.13] hover:text-white">{h}</button>
                                        ))}
                                    </div>
                                </section>
                            )}
                            {hot.length > 0 && (
                                <section>
                                    <h3 className="mb-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/40"><Flame className="h-3.5 w-3.5" />{scopeLabel(scope)}热搜</h3>
                                    <div className="grid grid-cols-2 gap-x-5 gap-y-0.5 md:grid-cols-3">
                                        {hot.map((h, i) => (
                                            <button key={h} type="button" onClick={() => pickKeyword(h)} className="flex h-8 items-center gap-2.5 rounded-lg px-1.5 text-left text-[12.5px] text-white/70 hover:bg-white/[0.05] hover:text-white">
                                                <span className={cx('w-4 shrink-0 font-mono text-[11px]', i < 3 ? 'text-rose-300/90' : 'text-white/25')}>{i + 1}</span>
                                                <span className="truncate">{h}</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}
                            {!history.length && !hot.length && (
                                <EmptyState icon={<Search className="h-8 w-8" />} title="想听点什么？" desc="直接输入歌名、歌手或专辑，边打边搜。Tab 切换平台范围，「全部平台」一次搜完五家。" />
                            )}
                        </div>
                    ) : (
                        <div ref={listRef} role="listbox" aria-label="搜索结果" className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto pb-24">
                            {scope === 'local' ? (
                                localList.length ? (
                                    <section className="space-y-0.5">
                                        {flat.map((track, i) => (
                                            <div key={track.id} data-active={track.id === activeId}>
                                                <ResultRow track={track} index={i} active={track.id === activeId} onHover={() => setActiveId(track.id)} onPlay={() => play(track)} onQueue={() => queue(track)} />
                                            </div>
                                        ))}
                                        {localList.length > LOCAL_INITIAL && (
                                            <button
                                                type="button"
                                                onClick={() => setExpanded(e => ({ ...e, local: !e.local }))}
                                                className="flex h-8 items-center gap-1 rounded-lg px-3 text-[11.5px] text-white/40 hover:bg-white/[0.05] hover:text-white/80"
                                            >
                                                {expanded.local ? '收起' : `展开其余 ${localList.length - LOCAL_INITIAL} 首`}
                                                <ChevronDown className={cx('h-3 w-3 transition-transform', expanded.local && 'rotate-180')} />
                                            </button>
                                        )}
                                    </section>
                                ) : (
                                    <EmptyState title="曲库中没有匹配的歌曲" desc="换个关键词，或按 Tab 切换到在线平台。" />
                                )
                            ) : (
                                <>
                                    {groups.map(group => {
                                        const shown = expanded[group.key] ? group.list : group.list.slice(0, GROUP_INITIAL);
                                        return (
                                            <section key={group.key}>
                                                <div className="mb-1.5 flex items-center gap-2 px-1">
                                                    <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/40">{PLATFORM_NAMES[group.key]}</h3>
                                                    {group.loading ? (
                                                        <Spinner className="h-3 w-3 text-white/30" />
                                                    ) : group.error ? (
                                                        <span className="truncate text-[11px] text-rose-300/80">{group.error}</span>
                                                    ) : (
                                                        <span className="font-mono text-[10.5px] text-white/[0.22]">{group.total || group.list.length}</span>
                                                    )}
                                                    <span className="h-px flex-1 bg-white/[0.06]" />
                                                </div>
                                                {group.loading ? (
                                                    <div className="space-y-1">{Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[56px] rounded-2xl" />)}</div>
                                                ) : group.list.length ? (
                                                    <div className="space-y-0.5">
                                                        {shown.map((track, i) => (
                                                            <div key={track.id} data-active={track.id === activeId}>
                                                                <ResultRow track={track} index={i} active={track.id === activeId} onHover={() => setActiveId(track.id)} onPlay={() => play(track)} onQueue={() => queue(track)} />
                                                            </div>
                                                        ))}
                                                        {group.list.length > GROUP_INITIAL && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpanded(e => ({ ...e, [group.key]: !e[group.key] }))}
                                                                className="flex h-8 items-center gap-1 rounded-lg px-3 text-[11.5px] text-white/40 hover:bg-white/[0.05] hover:text-white/80"
                                                            >
                                                                {expanded[group.key] ? '收起' : `展开其余 ${group.list.length - GROUP_INITIAL} 首`}
                                                                <ChevronDown className={cx('h-3 w-3 transition-transform', expanded[group.key] && 'rotate-180')} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="px-3 py-2 text-[12px] text-white/[0.28]">没有结果</div>
                                                )}
                                            </section>
                                        );
                                    })}
                                    {nothingFound && <EmptyState title="没有找到结果" desc="换个关键词试试，或按 Tab 缩小到单个平台。" />}
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* 按键提示条：Folia 搜索面板底部那一条，随状态换文案。
                    放在输入区下方而不是视口底部，避免压住右下角的 MiniPlayer。 */}
                <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2.5 text-[11px] text-white/35">
                    {empty ? (
                        <>
                            <span className="flex items-center gap-1"><Search className="h-3 w-3" />边打边搜</span>
                            <span className="flex items-center gap-1"><kbd>Tab</kbd>切换平台</span>
                            <span className="flex items-center gap-1"><kbd>Esc</kbd>关闭</span>
                        </>
                    ) : (
                        <>
                            <span className="flex items-center gap-1"><kbd>↑↓</kbd>选择</span>
                            <span className="flex items-center gap-1"><kbd>Enter</kbd>播放</span>
                            <span className="flex items-center gap-1"><kbd>Shift</kbd>+<kbd>Enter</kbd>加入队列</span>
                            <span className="hidden items-center gap-1 sm:flex"><kbd>Tab</kbd>切换平台</span>
                        </>
                    )}
                </div>
            </motion.div>
            <MiniPlayer />
        </motion.div>
    );
}