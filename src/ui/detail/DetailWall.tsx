/**
 * 歌单 / 专辑详情页的「拼贴墙」模式（Folia 式）：歌曲排成可拖动的海报墙，中间的书签放返回、过滤、竖排标题与操作。
 * 墙与书签复用乐库首页的 Wall（拖动 / 滚轮 / 方向键平移、书签可被挤到屏幕边上留一个标签），
 * 这里只负责把歌曲变成海报、把详情页的信息与操作排进书签。（布局与交互为 YEmusic 独立实现，设计参考 Folia。）
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, LayoutList, ListEnd, ListFilter, Play, RefreshCw, X } from 'lucide-react';
import { useLite } from '@/lib/lite';
import type { Track } from '@/sdk/types';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { ui, useUi } from '@/store/ui';
import { Button, EmptyState, Spinner, cx } from '../components/common';
import { useWindowSize } from '../hooks';
import { NowPlayingButton } from '../home/NowPlayingButton';
import { ControlPill } from '../player/ControlPill';
import { PatternArt } from '../library/art';
import { Wall, seamLineFor, wallCellFor, type WallCard, type WallHandle } from '../library/Wall';

export const DETAIL_SEAM_WIDTH = 300;

export interface DetailAction {
    key: string;
    label: string;
    icon: ReactNode;
    run: () => void;
    disabled?: boolean;
    active?: boolean;
}

export interface DetailWallProps {
    /** 详情的唯一标识：换歌单时整面墙翻牌 */
    id: string;
    title: string;
    /** 「28 首 • 1 小时 40 分钟 • 网易云 …」，第一段作为大字的数量 */
    meta: string;
    cover?: string;
    /** 没有封面时封面海报的生成式背景（我喜欢 / 每日推荐等） */
    art?: ReactNode;
    /** 当前显示的歌曲（已按过滤词筛过） */
    tracks: Track[];
    playlistId?: string;
    filter: string;
    onFilter: (value: string) => void;
    loading: boolean;
    error?: string;
    /** 载入进度等一行说明 */
    status?: string;
    onRetry: () => void;
    emptyTitle: string;
    emptyDesc?: string;
    emptyActions?: ReactNode;
    play: (index: number) => void;
    playAll: () => void;
    queueAll: () => void;
    actions: DetailAction[];
    /** 本地音乐页的「添加文件夹 / 重新扫描」等 */
    extra?: ReactNode;
    onList: () => void;
}

/** 竖排标题：按字数与书签可用高度挑字号，长标题折成多列 */
function VerticalTitle({ title }: { title: string }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [boxH, setBoxH] = useState(360);
    useLayoutEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => setBoxH(entries[0]?.contentRect.height ?? 360));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const usable = Math.max(120, boxH - 64);
    const count = [...title].length || 1;
    const cols = count <= 7 ? 1 : count <= 18 ? 2 : 3;
    const size = Math.round(Math.max(16, Math.min(52, (usable * cols) / count / 1.06, 230 / (cols * 1.25))));
    return (
        <div ref={boxRef} className="relative min-h-0 flex-1">
            <span className="seam-quote right-1 top-1" aria-hidden>“</span>
            <div className="absolute inset-0 grid place-items-center overflow-hidden px-2 py-8">
                <h1 className="seam-vtitle overflow-hidden" style={{ fontSize: size, maxHeight: usable }} title={title}>{title}</h1>
            </div>
            <span className="seam-quote bottom-1 left-1" aria-hidden>”</span>
        </div>
    );
}

interface SeamProps extends Pick<DetailWallProps, 'title' | 'meta' | 'filter' | 'onFilter' | 'status' | 'actions' | 'extra' | 'onList' | 'playAll' | 'queueAll'> {
    empty: boolean;
    bottomSafe: number;
}

function DetailSeam({ title, meta, filter, onFilter, status, actions, extra, onList, playAll, queueAll, empty, bottomSafe }: SeamProps) {
    const lite = useLite();
    const reduce = useSettings(s => s.reduceMotion);
    const filterRef = useRef<HTMLInputElement>(null);
    const [count, ...rest] = meta.split(' • ');

    // 与乐库一致：按 / 直接去过滤框
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
            if ((event.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]')) return;
            const s = useUi.getState();
            if (s.searchOpen || s.playerOpen || s.settingsOpen || s.dialog || s.menu) return;
            event.preventDefault();
            filterRef.current?.focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return (
        <motion.div
            className="seam-content"
            style={{ width: DETAIL_SEAM_WIDTH, marginLeft: -DETAIL_SEAM_WIDTH / 2 }}
            initial={lite || reduce ? { opacity: 0 } : { rotateY: -90, opacity: 0 }}
            animate={lite || reduce ? { opacity: 1 } : { rotateY: 0, opacity: 1, transition: { duration: 0.28, ease: [0.2, 0.7, 0.25, 1] } }}
        >
            <div className="flex h-full flex-col px-[22px] pt-5" style={{ paddingBottom: bottomSafe }}>
                <div className="flex shrink-0 items-center gap-2.5">
                    <button type="button" className="seam-icon !h-8 !w-8 !rounded-full" aria-label="返回 (Esc)" title="返回 (Esc)" onClick={ui.closeDetail}><ChevronLeft /></button>
                    <div className="flex min-w-0 items-center gap-1 text-[11.5px] text-[color:var(--seam-ink-soft)]">
                        <button type="button" className="shrink-0 hover:text-[rgb(var(--ye-ink))]" onClick={ui.closeDetail}>乐库</button>
                        <ChevronRight className="h-3 w-3 shrink-0 opacity-70" />
                        <span className="truncate text-[rgb(var(--ye-ink)/0.9)]">{title}</span>
                    </div>
                </div>
                <div className="seam-rule mt-4" />
                <label className="seam-filter">
                    <ListFilter className="h-3.5 w-3.5 shrink-0" />
                    <input
                        ref={filterRef}
                        value={filter}
                        onChange={event => onFilter(event.target.value)}
                        onKeyDown={event => {
                            if (event.key !== 'Escape') return;
                            if (filter) {
                                event.stopPropagation();
                                onFilter('');
                            } else filterRef.current?.blur();
                        }}
                        placeholder="过滤当前页"
                        aria-label="过滤当前页"
                        spellCheck={false}
                    />
                    {filter && (
                        <button type="button" aria-label="清除过滤" onClick={() => { onFilter(''); filterRef.current?.focus(); }} className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-[rgb(var(--ye-ink)/0.12)]">
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </label>
                <div className="seam-rule" />
                <VerticalTitle title={title} />
                <div className="seam-rule" />
                <div className="mt-3 shrink-0">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-[14px] font-extrabold">{count}</span>
                        {status && <span className="flex items-center gap-1.5 truncate text-[11.5px] text-[color:var(--seam-ink-soft)]"><Spinner className="h-3 w-3" />{status}</span>}
                    </div>
                    {rest.length > 0 && <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[color:var(--seam-ink-soft)]">{rest.join(' • ')}</div>}
                    <div className="mt-3 flex items-center gap-2">
                        <button type="button" className="seam-btn is-primary" disabled={empty} onClick={playAll}><Play fill="currentColor" />播放全部</button>
                        <button type="button" className="seam-btn" disabled={empty} onClick={queueAll}><ListEnd />加入队列</button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        {actions.map(action => (
                            <button key={action.key} type="button" className={cx('seam-icon', action.active && 'is-active')} aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.run}>{action.icon}</button>
                        ))}
                        <button type="button" className="seam-btn" title="切换为列表布局" onClick={onList}><LayoutList />列表</button>
                    </div>
                    {extra}
                </div>
            </div>
        </motion.div>
    );
}

export function DetailWall(props: DetailWallProps) {
    const { id, title, meta, cover, art, tracks, playlistId, filter, onFilter, loading, error, status, onRetry, emptyTitle, emptyDesc, emptyActions, play, playAll, queueAll, actions, extra, onList } = props;
    const { w, h } = useWindowSize();
    const currentId = usePlayer(s => s.current?.id);
    const hasCurrent = usePlayer(s => Boolean(s.current));
    const overlay = useUi(s => Boolean(s.searchOpen || s.playerOpen || s.settingsOpen || s.dialog || s.menu));
    const wallRef = useRef<WallHandle | null>(null);
    const lastPlay = useRef({ index: -1, at: 0 });
    const cell = wallCellFor(w, h);
    const lineX = seamLineFor(w);
    const q = filter.trim();

    // 单击就播放；紧跟着的双击不再重复触发（否则同一首歌会被重新载入两次）
    const playOnce = useRef(play);
    playOnce.current = play;
    const trigger = useMemo(() => (index: number) => {
        const now = performance.now();
        if (lastPlay.current.index === index && now - lastPlay.current.at < 600) return;
        lastPlay.current = { index, at: now };
        playOnce.current(index);
    }, []);

    const cards = useMemo<WallCard[]>(() => {
        const list: WallCard[] = [];
        // 没有歌曲时不放封面海报：空墙配一句提示更干净
        if (!q && tracks.length) {
            list.push({
                key: 'cover',
                title,
                desc: meta.split(' • ')[0],
                badge: '歌单',
                cover,
                art: art ?? (cover ? undefined : <PatternArt seed={title} />),
                featured: true,
                stack: true,
                noFlight: true,
                onOpen: playAll,
                onPlay: playAll,
            });
        }
        tracks.forEach((track, index) => {
            list.push({
                key: `${track.id}:${index}`,
                title: track.name,
                desc: track.singer,
                badge: String(index + 1).padStart(2, '0'),
                cover: track.cover,
                active: track.id === currentId,
                noFlight: true,
                onOpen: () => trigger(index),
                onPlay: () => trigger(index),
                onMenu: event => ui.menu({ x: event.clientX, y: event.clientY, track, list: tracks, playlistId }),
            });
        });
        return list;
    }, [tracks, q, title, meta, cover, art, currentId, playlistId, playAll, trigger]);

    const empty = tracks.length === 0;
    const bottomSafe = 24 + (hasCurrent ? 72 : 48) + 8;
    const pillRight = (hasCurrent ? w - 140 : w) - 12;
    const pillWidth = Math.max(280, Math.min(560, w - 2 * (hasCurrent ? 152 : 24)));
    const pillCenter = Math.min(w / 2, pillRight - pillWidth / 2);
    const rightOf = lineX + DETAIL_SEAM_WIDTH / 2;

    return (
        <div className="absolute inset-0 overflow-hidden bg-[#070707]">
            {/* 窗口顶部的拖动区：必须渲染在书签之前（-webkit-app-region 按文档顺序叠加，见 Library.tsx） */}
            <div className="drag absolute inset-x-0 top-0 z-[4] h-6" />
            <Wall
                cards={cards}
                seed={`${id}:${q}:${cards.length}`}
                cell={cell}
                keyboard={!overlay}
                finite={Boolean(q) || cards.length < 4}
                handle={wallRef}
                seamWidth={DETAIL_SEAM_WIDTH}
                edgeLabel={title}
                onRestore={() => wallRef.current?.openHere(DETAIL_SEAM_WIDTH)}
                seam={<DetailSeam title={title} meta={meta} filter={filter} onFilter={onFilter} status={status} actions={actions} extra={extra} onList={onList} playAll={playAll} queueAll={queueAll} empty={empty} bottomSafe={bottomSafe} />}
            />

            {empty && (
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 grid place-items-center px-8" style={{ left: rightOf }}>
                    <div className="pointer-events-auto">
                        {loading ? (
                            <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-[13px] txt-3"><Spinner />正在载入「{title}」…</div>
                        ) : error ? (
                            <EmptyState title="加载失败" desc={error}><Button onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</Button></EmptyState>
                        ) : (
                            <EmptyState title={emptyTitle} desc={emptyDesc}>{emptyActions}</EmptyState>
                        )}
                    </div>
                </div>
            )}

            <footer className="pointer-events-none absolute bottom-6 z-20 flex justify-center" style={{ left: pillCenter - pillWidth / 2, width: pillWidth }}>
                <ControlPill variant="home" maxWidth={pillWidth} />
            </footer>
            <NowPlayingButton />
        </div>
    );
}
