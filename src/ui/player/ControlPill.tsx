/**
 * 底部胶囊控制条（Folia 式）：收起只显示进度，悬停展开播放键、标题导航与模式 / 队列槽位，
 * 再往上是悬停 250ms 才出现的快捷操作条（音量 / 喜欢 / 收藏 / 随机 / 歌词样式 / 播放设置）。
 * 交互与布局值移植自 Folia 的 FloatingPlayerControls 系列组件；窄屏（手机）用常驻播放键的紧凑版。
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
    AlertTriangle, ArrowRightToLine, Captions, ChevronLeft, ChevronRight, Heart, LayoutGrid,
    ListMusic, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward,
    SlidersHorizontal, Star, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { engine } from '@/player/engine';
import { formatTime } from '@/lib/util';
import { cycleMode, MODE_NAMES, next, prev, retry, seek, toggle, usePlayer } from '@/store/player';
import { toggleFavorite } from '@/store/library';
import { setSetting, useSettings, type PlayMode } from '@/store/settings';
import { toast } from '@/store/toast';
import { ui } from '@/store/ui';
import { useCompact, useDuration, useIsFavorite } from '../hooks';
import { Slider, Spinner, cx } from '../components/common';
import { LikeButton } from '../components/LikeButton';
import type { Track } from '@/sdk/types';

export const MODE_ICONS: Record<PlayMode, typeof Repeat> = { loop: Repeat, one: Repeat1, shuffle: Shuffle, order: ArrowRightToLine };

export function ControlPill(props: { variant: 'home' | 'player'; idle?: boolean; /** 可用宽度不足时收窄（乐库布局的小窗口） */ maxWidth?: number }) {
    const compact = useCompact();
    return compact ? <CompactPill variant={props.variant} idle={props.idle} /> : <DesktopPill {...props} />;
}

/** 细指针（鼠标 / 触控板）才显示悬停快捷操作条 */
const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.(FINE_POINTER).matches;

/** 随机播放要切回原模式的记忆 */
let lastNonShuffle: PlayMode = 'loop';

// ---------------- 桌面胶囊 ----------------
const SPRING = { type: 'spring' as const, stiffness: 280, damping: 24 };

function DesktopPill({ variant, idle, maxWidth }: { variant: 'home' | 'player'; idle?: boolean; maxWidth?: number }) {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const queue = usePlayer(s => s.queue);
    const index = usePlayer(s => s.index);
    const mode = useSettings(s => s.playMode);
    const reduceMotion = useSettings(s => s.reduceMotion);
    const [hover, setHover] = useState(false);
    const [volumeOpen, setVolumeOpen] = useState(false);
    const [quickVisible, setQuickVisible] = useState(false);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const quickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const volumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    /** 拖完进度条松开的那次 click 不算「点胶囊本体」 */
    const seekRelease = useRef(0);

    // 悬停展开：进 20ms 出 100ms；音量弹层开着或有错时（播放页）也保持展开
    const expanded = Boolean(current) && (hover || volumeOpen || (variant === 'player' && status !== 'playing'));
    const W = Math.min(512, maxWidth ?? Infinity);
    const collapsedW = Math.max(240, Math.round(W * 0.6));
    const playing = status === 'playing';

    const onEnter = () => {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHover(true), 20);
        if (finePointer() && current) {
            clearTimeout(quickTimer.current);
            quickTimer.current = setTimeout(() => setQuickVisible(true), 250);
        }
    };
    const onLeave = () => {
        clearTimeout(hoverTimer.current);
        clearTimeout(quickTimer.current);
        hoverTimer.current = setTimeout(() => setHover(false), 100);
        setQuickVisible(false);
        if (volumeOpen) {
            clearTimeout(volumeTimer.current);
            volumeTimer.current = setTimeout(() => setVolumeOpen(false), 300);
        }
    };
    const reenterVolume = () => {
        clearTimeout(volumeTimer.current);
    };

    // 点胶囊本体（非按钮 / 非进度条）：进播放页或封面面板
    const onBodyClick = (event: React.MouseEvent) => {
        if (performance.now() - seekRelease.current < 350) return;
        if ((event.target as HTMLElement).closest('button, input, a, select, [role="button"], [role="slider"], [role="switch"]')) return;
        if (variant === 'home') ui.openPlayer();
        else ui.togglePanel('cover');
    };

    const shell = 'no-drag pointer-events-auto flex overflow-hidden rounded-full border backdrop-blur-xl lite:backdrop-blur-none shadow-2xl transition-opacity duration-500';
    if (!current) {
        return (
            <div className="pointer-events-auto -mb-8 pb-8">
                <button
                    type="button"
                    onClick={() => ui.openSearch()}
                    className={cx(shell, 'h-8 items-center gap-2 border-white/5 bg-black/20 px-4 py-2 text-[12px] txt-4 lite:bg-black/70 hover:bg-black/30 hover:txt-2')}
                    style={{ width: collapsedW }}
                >
                    <Music2 className="h-3.5 w-3.5" />
                    <span className="mx-auto">搜索或打开歌单，开始播放</span>
                </button>
            </div>
        );
    }

    return (
        <div
            className="pointer-events-auto relative -mb-8 pb-8"
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
        >
            {/* 悬停快捷操作条 + 音量弹层（胶囊上方） */}
            <QuickBar
                visible={quickVisible || volumeOpen}
                variant={variant}
                volumeOpen={volumeOpen}
                setVolumeOpen={setVolumeOpen}
                reenterVolume={reenterVolume}
            />
            <motion.div
                layout
                transition={reduceMotion ? { duration: 0 } : SPRING}
                onClick={onBodyClick}
                className={cx(
                    shell,
                    idle && !hover ? 'opacity-40' : 'opacity-100',
                    expanded
                        ? 'border-white/5 bg-black/40 lite:bg-black/70 p-3'
                        : 'border-white/5 bg-black/20 lite:bg-black/70 px-4 py-2 hover:bg-black/30',
                )}
                style={{ width: expanded ? W : collapsedW }}
            >
                {!expanded ? (
                    <ProgressRow seekRelease={seekRelease} />
                ) : (
                    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
                        <button
                            type="button"
                            title={playing ? '暂停（空格）' : '播放（空格）'}
                            onClick={() => (status === 'error' ? retry() : toggle())}
                            className="row-span-2 grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                        >
                            {status === 'loading' ? <Spinner className="h-5 w-5" /> : status === 'error' ? <AlertTriangle className="h-5 w-5" /> : playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
                        </button>
                        <TitleNavigator queue={queue} index={index} mode={mode} />
                        <ProgressRow seekRelease={seekRelease} />
                    </div>
                )}
            </motion.div>
        </div>
    );
}

// ---------------- 标题导航：左右悬停区预览相邻曲目，点击切歌 ----------------
function TitleNavigator({ queue, index, mode }: { queue: Track[]; index: number; mode: PlayMode }) {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const statusText = usePlayer(s => s.statusText);
    const error = usePlayer(s => s.error);
    const [entered, setEntered] = useState(false);
    const [zoneHover, setZoneHover] = useState<'prev' | 'next' | null>(null);
    const [dir, setDir] = useState(0);
    const confirmUntil = useRef(0);
    const shuffle = mode === 'shuffle';
    // 手动 prev/next 在任何模式都绕回（player.ts：prev 负值绕尾、next 越界回首）；只有 shuffle 不可预告
    const prevTrack = shuffle || !queue.length ? null : queue[index - 1] ?? queue[queue.length - 1];
    const nextTrack = shuffle || !queue.length ? null : queue[index + 1] ?? queue[0];
    const previewing = zoneHover && performance.now() > confirmUntil.current;
    const preview = previewing ? (zoneHover === 'prev' ? prevTrack : nextTrack) : null;

    const switchTo = (d: 'prev' | 'next') => {
        setDir(d === 'prev' ? -1 : 1);
        confirmUntil.current = performance.now() + 1100;
        setZoneHover(null);
        if (d === 'prev') prev();
        else next();
    };

    const title = status === 'loading' && statusText ? statusText : status === 'error' && error ? error : preview ? preview.name : current?.name ?? '';
    const zoneCls = 'absolute top-1/2 flex h-full w-14 -translate-y-1/2 items-center transition-opacity duration-200';
    return (
        <div
            className="relative flex h-6 min-w-0 items-center justify-center overflow-hidden"
            onMouseEnter={() => setEntered(true)}
            onMouseLeave={() => { setEntered(false); setZoneHover(null); }}
        >
            <button
                type="button"
                title="上一首（Ctrl ←）"
                onClick={() => switchTo('prev')}
                onMouseEnter={() => setZoneHover('prev')}
                onMouseLeave={() => setZoneHover(null)}
                className={cx(zoneCls, 'left-0 justify-start pl-1 text-white', entered || zoneHover ? 'opacity-70' : 'opacity-0')}
            >
                <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
            </button>
            <motion.span
                key={`${current?.id}-${dir}`}
                initial={{ x: dir * 14, opacity: 0 }}
                animate={{ x: 0, opacity: preview ? 0.55 : 1 }}
                transition={{ duration: 0.2 }}
                className={cx('block max-w-full truncate px-16 text-center text-[14px] font-bold', status === 'error' ? 'text-red-200' : 'text-white')}
                title={error || statusText || current?.name}
            >
                {title}
            </motion.span>
            <button
                type="button"
                title="下一首（Ctrl →）"
                onClick={() => switchTo('next')}
                onMouseEnter={() => setZoneHover('next')}
                onMouseLeave={() => setZoneHover(null)}
                className={cx(zoneCls, 'right-0 justify-end pr-1 text-white', entered || zoneHover ? 'opacity-70' : 'opacity-0')}
            >
                <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
            </button>
        </div>
    );
}

// ---------------- 进度行：时间 | 轨道 | 时长；rAF 直写 clip-path，不走 React 状态 ----------------
function ProgressRow({ seekRelease }: { seekRelease: React.MutableRefObject<number> }) {
    const duration = useDuration();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const fillRef = useRef<HTMLDivElement | null>(null);
    const timeRef = useRef<HTMLSpanElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const drag = useRef<{ on: boolean; value: number }>({ on: false, value: 0 });
    const lastPx = useRef(-1);
    const lastSec = useRef(-1);

    // 时间源：engine.currentTime，组件挂着就跑 rAF；填充与时间文本都直写 DOM
    useEffect(() => {
        let raf = 0;
        const minStep = 0.25 / (window.devicePixelRatio || 1);
        const loop = () => {
            const d = drag.current.on ? drag.current.value : engine.currentTime;
            const dur = engine.duration;
            const track = trackRef.current;
            const fill = fillRef.current;
            if (track && fill && dur > 0) {
                const w = track.clientWidth;
                const frac = Math.min(1, Math.max(0, d / dur));
                const px = frac * w;
                if (Math.abs(px - lastPx.current) >= minStep) {
                    lastPx.current = px;
                    fill.style.clipPath = `inset(0 ${(100 - frac * 100).toFixed(3)}% 0 0 round 999px)`;
                }
            }
            const sec = Math.floor(d);
            if (sec !== lastSec.current && timeRef.current) {
                lastSec.current = sec;
                timeRef.current.textContent = formatTime(sec);
            }
            // 非受控 input 的 DOM 值跟着播放走，方向键微调才落在当前位置附近；拖动时不写
            const input = inputRef.current;
            if (input && !drag.current.on && Number(input.value) !== d) input.value = String(Math.max(0, d));
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, []);

    const commitSeek = (v: number) => {
        drag.current.on = false;
        seekRelease.current = performance.now();
        seek(v);
    };

    return (
        <div className="flex h-8 w-full items-center gap-3">
            <span ref={timeRef} className="w-8 shrink-0 text-right font-mono text-[10px] font-medium opacity-60">0:00</span>
            <div ref={trackRef} className="relative h-1.5 min-w-0 flex-1 rounded-full bg-white/10">
                <div ref={fillRef} className="absolute inset-0 rounded-full bg-white/90" style={{ clipPath: 'inset(0 100% 0 0 round 999px)' }} />
                {/* 非受控：拖动中 React 的受控恢复会把 DOM 值钉回旧 props，thumb 会卡死在起点；
                    填充由 rAF 直写，原生 thumb 透明，进度只凭 pointer 事件与 change 提交 */}
                <input
                    ref={inputRef}
                    type="range"
                    aria-label="播放进度"
                    min={0}
                    max={Math.max(1, duration)}
                    step={0.1}
                    defaultValue={0}
                    onPointerDown={e => { drag.current.on = true; drag.current.value = Number((e.target as HTMLInputElement).value); }}
                    onInput={e => { drag.current.value = Number((e.target as HTMLInputElement).value); }}
                    onPointerUp={e => commitSeek(Number((e.target as HTMLInputElement).value))}
                    onPointerCancel={() => { drag.current.on = false; }}
                    onLostPointerCapture={() => { if (drag.current.on) commitSeek(drag.current.value); }}
                    onChange={e => { if (!drag.current.on) commitSeek(Number((e.target as HTMLInputElement).value)); }}
                    className="absolute -inset-y-2 inset-x-0 h-auto w-full cursor-pointer opacity-0"
                />
            </div>
            <span className="w-8 shrink-0 font-mono text-[10px] font-medium opacity-60">{formatTime(duration)}</span>
        </div>
    );
}

// ---------------- 悬停快捷操作条（Folia CapsuleQuickActions） ----------------
const QUICK_SHADOW = '0 25px 50px -12px rgba(0,0,0,.25), 0 0 0 1px rgb(255 255 255 / .08)';
const QUICK_BTN = 'grid place-items-center rounded-full p-2 opacity-70 transition-colors hover:bg-white/10 hover:opacity-100 disabled:opacity-30 disabled:hover:bg-transparent';

function QuickBar({ visible, variant, volumeOpen, setVolumeOpen, reenterVolume }: {
    visible: boolean; variant: 'home' | 'player'; volumeOpen: boolean;
    setVolumeOpen: (v: boolean) => void; reenterVolume: () => void;
}) {
    const current = usePlayer(s => s.current);
    const mode = useSettings(s => s.playMode);
    const volume = useSettings(s => s.volume);
    const muted = useSettings(s => s.muted);
    const liked = useIsFavorite(current?.id);
    const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    const toggleShuffle = () => {
        if (mode === 'shuffle') {
            setSetting('playMode', lastNonShuffle);
            toast(MODE_NAMES[lastNonShuffle], 'info', { duration: 1200 });
        } else {
            lastNonShuffle = mode;
            setSetting('playMode', 'shuffle');
            toast(MODE_NAMES.shuffle, 'info', { duration: 1200 });
        }
    };

    return (
        <div
            className="absolute inset-x-0 top-0 z-10 flex -translate-y-full justify-center pb-3"
            onPointerEnter={reenterVolume}
        >
            <motion.div
                initial={false}
                animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 6 }}
                transition={{ duration: 0.16 }}
                className="flex items-center gap-0.5 rounded-full bg-black/40 lite:bg-black/70 p-1 backdrop-blur-xl lite:backdrop-blur-none"
                style={{ boxShadow: QUICK_SHADOW, pointerEvents: visible ? 'auto' : 'none' }}
            >
                <div className="relative">
                    <button
                        type="button"
                        title="音量"
                        onClick={() => setVolumeOpen(!volumeOpen)}
                        onWheel={e => {
                            const next = Math.min(1, Math.max(0, volume + (e.deltaY < 0 ? 0.05 : -0.05)));
                            setSetting('volume', next);
                        }}
                        className={cx(QUICK_BTN, volumeOpen && 'bg-white/12')}
                    >
                        <VolIcon className="h-4 w-4" />
                    </button>
                    {volumeOpen && (
                        <div
                            className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-2xl bg-black/40 lite:bg-black/70 px-4 py-3.5 backdrop-blur-xl lite:backdrop-blur-none"
                            style={{ boxShadow: QUICK_SHADOW }}
                            onPointerEnter={reenterVolume}
                        >
                            <VolumePanel />
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    title="喜欢（L）"
                    disabled={!current}
                    onClick={() => { if (current) toast(toggleFavorite(current) ? '已添加到我喜欢' : '已从我喜欢移除', 'info', { duration: 1300, key: 'like' }); }}
                    className={QUICK_BTN}
                >
                    <Heart className={cx('h-4 w-4', liked && 'fill-rose-400 text-rose-400')} />
                </button>
                <button
                    type="button"
                    title="收藏到歌单"
                    disabled={!current}
                    onClick={() => current && ui.dialog({ type: 'addToPlaylist', tracks: [current] })}
                    className={QUICK_BTN}
                >
                    <Star className="h-4 w-4" />
                </button>
                <button type="button" title="随机播放" onClick={toggleShuffle} className={cx(QUICK_BTN, mode === 'shuffle' && 'bg-white/12 opacity-100')}>
                    <Shuffle className="h-4 w-4" />
                </button>
                <button type="button" title="歌词与翻译" disabled={!current} onClick={() => ui.openLyricStyle('subtitle')} className={QUICK_BTN}>
                    <Captions className="h-4 w-4" />
                </button>
                <button type="button" title="歌词动画" onClick={() => ui.openLyricStyle('style')} className={QUICK_BTN}>
                    <LayoutGrid className="h-4 w-4" />
                </button>
                <div className="mx-0.5 h-4 w-px bg-white/15" />
                <button
                    type="button"
                    title="播放设置"
                    data-panel-toggle
                    onClick={() => {
                        if (variant === 'player') ui.togglePanel();
                        else {
                            ui.openPlayer();
                            ui.togglePanel('controls');
                        }
                    }}
                    className={QUICK_BTN}
                >
                    <SlidersHorizontal className="h-4 w-4" />
                </button>
            </motion.div>
        </div>
    );
}

/** 音量弹层：图标点按静音（Folia 的命令面板音量卡样子：图标 + 大百分比 + 整宽滑杆） */
function VolumePanel() {
    const volume = useSettings(s => s.volume);
    const muted = useSettings(s => s.muted);
    const shown = muted ? 0 : volume;
    const PanelIcon = muted || shown === 0 ? VolumeX : shown < 0.5 ? Volume1 : Volume2;
    return (
        <div className="flex w-56 flex-col gap-3" onPointerDown={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
                <button
                    type="button"
                    title={muted ? '取消静音' : '静音'}
                    aria-pressed={muted}
                    aria-label={muted ? '取消静音' : '静音'}
                    onClick={() => setSetting('muted', !muted)}
                    className="-m-1.5 shrink-0 rounded-full p-1.5 transition-colors hover:bg-white/10"
                >
                    <PanelIcon className={cx('h-[18px] w-[18px]', muted ? 'opacity-45' : 'text-[rgb(var(--accent))]')} />
                </button>
                <span className="text-[13px] font-medium">音量</span>
                <span className="ml-auto text-sm font-semibold tabular-nums">{Math.round(shown * 100)}%</span>
            </div>
            <Slider
                value={shown}
                max={1}
                onChange={v => { setSetting('muted', false); setSetting('volume', v); }}
                trackClass="h-1.5"
                label="音量"
                valueText={`${Math.round(shown * 100)}%`}
            />
        </div>
    );
}

/** 手机竖屏：播放 / 切歌常驻，标题点开播放页（首页）或封面面板（播放页），进度条在下一行 */
function CompactPill({ variant, idle }: { variant: 'home' | 'player'; idle?: boolean }) {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const statusText = usePlayer(s => s.statusText);
    const error = usePlayer(s => s.error);
    const [time, setTime] = useState(0);
    const duration = useDuration();
    const playing = status === 'playing';
    useEffect(() => {
        const t = setInterval(() => setTime(engine.currentTime), 250);
        return () => clearInterval(t);
    }, []);
    const shell = 'no-drag pointer-events-auto w-full overflow-hidden rounded-[30px] border ln-weak bg-black/40 lite:bg-black/70 shadow-[var(--shadow-float)] backdrop-blur-2xl transition-opacity duration-500';
    if (!current) {
        return (
            <div className={cx(shell, 'flex h-12 items-center justify-center')}>
                <button type="button" onClick={() => ui.openSearch()} className="flex h-full items-center gap-2 px-6 text-[12.5px] txt-4 active:txt-2">
                    <Music2 className="h-3.5 w-3.5" />
                    搜索或打开歌单，开始播放
                </button>
            </div>
        );
    }
    const iconButton = 'grid h-9 w-9 shrink-0 place-items-center rounded-full txt-3 active:bg-white/10 active:text-white';
    return (
        <div className={cx(shell, 'px-2.5 pb-2 pt-2.5', idle && playing ? 'opacity-60' : 'opacity-100')}>
            <div className="flex items-center gap-1.5">
                <button
                    type="button"
                    aria-label={playing ? '暂停' : '播放'}
                    onClick={() => (status === 'error' ? retry() : toggle())}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-black active:scale-95"
                >
                    {status === 'loading' ? <Spinner className="h-5 w-5" /> : status === 'error' ? <AlertTriangle className="h-5 w-5" /> : playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
                </button>
                <button
                    type="button"
                    onClick={() => (variant === 'home' ? ui.openPlayer() : ui.togglePanel('cover'))}
                    className="min-w-0 flex-1 px-1 text-left leading-tight"
                    title={error || statusText || current.name}
                >
                    <span className={cx('block truncate text-[14px] font-semibold', status === 'error' ? 'text-red-200' : 'text-white')}>
                        {status === 'loading' && statusText ? statusText : status === 'error' && error ? error : current.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] txt-4">{current.singer}</span>
                </button>
                <LikeButton track={current} iconClass="h-[18px] w-[18px]" className="h-9 w-9 active:bg-white/10" />
                <button type="button" aria-label="上一首" onClick={prev} className={iconButton}><SkipBack className="h-[18px] w-[18px]" fill="currentColor" /></button>
                <button type="button" aria-label="下一首" onClick={() => next()} className={iconButton}><SkipForward className="h-[18px] w-[18px]" fill="currentColor" /></button>
                <button
                    type="button"
                    aria-label="播放队列"
                    onClick={() => {
                        if (variant === 'home') {
                            ui.openPlayer();
                            ui.togglePanel('queue');
                        } else ui.togglePanel('queue');
                    }}
                    className={iconButton}
                >
                    <ListMusic className="h-[18px] w-[18px]" />
                </button>
            </div>
            <div className="mt-0.5 flex items-center gap-2 px-1.5">
                <span className="w-9 shrink-0 text-right font-mono text-[10px] txt-4">{formatTime(time)}</span>
                <Slider value={time} max={duration || 1} onCommit={v => seek(v)} className="flex-1" trackClass="h-[4px]" fillClass="bg-white" thumb={false} label="播放进度" valueText={`${formatTime(time)} / ${formatTime(duration)}`} />
                <span className="w-9 shrink-0 font-mono text-[10px] txt-4">{formatTime(duration)}</span>
            </div>
        </div>
    );
}
