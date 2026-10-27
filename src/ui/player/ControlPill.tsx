/**
 * 底部胶囊控制条：收起时只显示进度，悬停展开播放键、标题与模式 / 队列按钮。
 * 窄屏（手机）没有悬停，改用常驻播放键的两行紧凑版。
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRightToLine, ListMusic, Music2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { formatTime } from '@/lib/util';
import { cycleMode, MODE_NAMES, next, prev, retry, seek, toggle, usePlayer } from '@/store/player';
import { useSettings, type PlayMode } from '@/store/settings';
import { toast } from '@/store/toast';
import { ui } from '@/store/ui';
import { useCompact, useDuration, usePlaybackTime } from '../hooks';
import { Slider, Spinner, cx } from '../components/common';
import { LikeButton } from '../components/LikeButton';

export const MODE_ICONS: Record<PlayMode, typeof Repeat> = { loop: Repeat, one: Repeat1, shuffle: Shuffle, order: ArrowRightToLine };

export function ControlPill(props: { variant: 'home' | 'player'; idle?: boolean; /** 可用宽度不足时收窄（乐库布局的小窗口） */ maxWidth?: number }) {
    const compact = useCompact();
    return compact ? <CompactPill variant={props.variant} idle={props.idle} /> : <DesktopPill {...props} />;
}

function DesktopPill({ variant, idle, maxWidth }: { variant: 'home' | 'player'; idle?: boolean; maxWidth?: number }) {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const statusText = usePlayer(s => s.statusText);
    const error = usePlayer(s => s.error);
    const mode = useSettings(s => s.playMode);
    const time = usePlaybackTime(200);
    const duration = useDuration();
    const [hover, setHover] = useState(false);
    const expanded = Boolean(current) && (hover || status !== 'playing');
    const ModeIcon = MODE_ICONS[mode];
    const playing = status === 'playing';

    return (
        <motion.div
            layout
            onHoverStart={() => setHover(true)}
            onHoverEnd={() => setHover(false)}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className={cx(
                'no-drag pointer-events-auto flex items-center overflow-hidden rounded-full border border-white/[0.06] bg-black/30 lite:bg-black/55 shadow-[0_10px_40px_rgba(0,0,0,.25)] backdrop-blur-2xl transition-opacity duration-500',
                expanded ? 'h-[72px] gap-3 pl-3 pr-4' : 'h-12 gap-3 px-9',
                idle && !hover ? 'opacity-40' : 'opacity-100',
            )}
            style={{ width: Math.min(expanded ? 560 : 288, maxWidth ?? Infinity) }}
        >
            {expanded && (
                <motion.button
                    layout="position"
                    type="button"
                    title={playing ? '暂停' : '播放'}
                    onClick={() => (status === 'error' ? retry() : toggle())}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                >
                    {status === 'loading' ? <Spinner className="h-5 w-5" /> : status === 'error' ? <AlertTriangle className="h-5 w-5" /> : playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
                </motion.button>
            )}
            <motion.div layout="position" className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1">
                {expanded && (
                    <button
                        type="button"
                        onClick={() => (variant === 'home' ? ui.openPlayer() : ui.togglePanel('cover'))}
                        className={cx('max-w-full truncate px-2 text-[13px] font-semibold hover:underline', status === 'error' ? 'text-red-200' : 'text-white')}
                        title={error || statusText || current?.name}
                    >
                        {status === 'loading' && statusText ? statusText : status === 'error' && error ? error : current ? `${current.name}` : ''}
                    </button>
                )}
                {current ? (
                    <div className="flex w-full items-center gap-3">
                        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-white/45">{formatTime(time)}</span>
                        <Slider value={time} max={duration || 1} onCommit={v => seek(v)} className="flex-1" trackClass="h-[5px]" fillClass="bg-white" thumb={expanded} />
                        <span className="w-10 shrink-0 font-mono text-[10px] text-white/45">{formatTime(duration)}</span>
                    </div>
                ) : (
                    // 还没有播放任何歌曲时，不显示空进度条，改为一句提示
                    <button type="button" onClick={() => ui.openSearch()} className="flex items-center gap-2 text-[12px] text-white/40 transition-colors hover:text-white/75">
                        <Music2 className="h-3.5 w-3.5" />
                        搜索或打开歌单，开始播放
                    </button>
                )}
            </motion.div>
            {expanded && (
                <motion.div layout="position" className="flex shrink-0 items-center gap-0.5 text-white/60">
                    <LikeButton track={current} iconClass="h-4 w-4" className="h-9 w-9 hover:bg-white/10" />
                    <button type="button" title="上一首" onClick={prev} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 hover:text-white"><SkipBack className="h-4 w-4" fill="currentColor" /></button>
                    <button type="button" title="下一首" onClick={() => next()} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 hover:text-white"><SkipForward className="h-4 w-4" fill="currentColor" /></button>
                    <button
                        type="button"
                        title={MODE_NAMES[mode]}
                        onClick={() => toast(MODE_NAMES[cycleMode()], 'info', { duration: 1200 })}
                        className={cx('grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 hover:text-white', mode !== 'order' && 'bg-white/10 text-white')}
                    >
                        <ModeIcon className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        title="播放队列"
                        onClick={() => {
                            if (variant === 'home') {
                                ui.openPlayer();
                                ui.togglePanel('queue');
                            } else ui.togglePanel('queue');
                        }}
                        className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 hover:text-white"
                    >
                        <ListMusic className="h-4 w-4" />
                    </button>
                </motion.div>
            )}
        </motion.div>
    );
}

/** 手机竖屏：播放 / 切歌常驻，标题点开播放页（首页）或封面面板（播放页），进度条在下一行 */
function CompactPill({ variant, idle }: { variant: 'home' | 'player'; idle?: boolean }) {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const statusText = usePlayer(s => s.statusText);
    const error = usePlayer(s => s.error);
    const time = usePlaybackTime(250);
    const duration = useDuration();
    const playing = status === 'playing';
    const shell = 'no-drag pointer-events-auto w-full overflow-hidden rounded-[30px] border border-white/[0.08] bg-black/45 lite:bg-black/70 shadow-[0_10px_40px_rgba(0,0,0,.3)] backdrop-blur-2xl transition-opacity duration-500';
    if (!current) {
        return (
            <div className={cx(shell, 'flex h-12 items-center justify-center')}>
                <button type="button" onClick={() => ui.openSearch()} className="flex h-full items-center gap-2 px-6 text-[12.5px] text-white/50 active:text-white/80">
                    <Music2 className="h-3.5 w-3.5" />
                    搜索或打开歌单，开始播放
                </button>
            </div>
        );
    }
    const iconButton = 'grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 active:bg-white/10 active:text-white';
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
                    <span className="mt-0.5 block truncate text-[12px] text-white/45">{current.singer}</span>
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
                <span className="w-9 shrink-0 text-right font-mono text-[10px] text-white/45">{formatTime(time)}</span>
                <Slider value={time} max={duration || 1} onCommit={v => seek(v)} className="flex-1" trackClass="h-[4px]" fillClass="bg-white" thumb={false} />
                <span className="w-9 shrink-0 font-mono text-[10px] text-white/45">{formatTime(duration)}</span>
            </div>
        </div>
    );
}
