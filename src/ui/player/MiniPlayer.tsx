/** 详情页 / 搜索页右下角的迷你播放器：封面 + 标题 + 播放控制，点击进入播放页 */
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, Pause, Play, SkipForward } from 'lucide-react';
import { next, toggle, usePlayer } from '@/store/player';
import { ui } from '@/store/ui';
import { useCompact, useDuration, usePlaybackTime } from '../hooks';
import { Cover, Spinner, cx } from '../components/common';
import { LikeButton } from '../components/LikeButton';

function Progress() {
    const time = usePlaybackTime(500);
    const duration = useDuration();
    const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
    return (
        <div className="absolute inset-x-5 bottom-0 h-[2px] overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-white/70 transition-[width] duration-500 ease-linear" style={{ width: `${ratio * 100}%` }} />
        </div>
    );
}

export function MiniPlayer({ className = '' }: { className?: string }) {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const coverUrl = usePlayer(s => s.coverUrl);
    const compact = useCompact();
    if (!current) return null;
    const playing = status === 'playing';
    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            className={cx('no-drag absolute z-30 flex h-[60px] items-center gap-1 overflow-hidden rounded-full border border-white/[0.07] bg-black/60 lite:bg-black/80 pl-2 pr-1.5 shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-2xl', compact ? 'inset-x-3 bottom-3' : 'bottom-6 right-6', className)}
        >
            <button type="button" onClick={ui.openPlayer} title="打开播放页 (Ctrl+P)" className={cx('flex min-w-0 items-center gap-3 rounded-full pr-2 text-left', compact && 'flex-1')}>
                <Cover src={current.cover || coverUrl} size={44} seed={current.name} className={cx('h-11 w-11 shrink-0', playing && 'spin-slow')} rounded="rounded-full" />
                <span className={cx('min-w-0 leading-tight', compact ? 'flex-1' : 'max-w-[180px]')}>
                    <span className="block truncate text-[13px] font-semibold text-white/90">{current.name}</span>
                    <span className="block truncate text-[11.5px] text-white/45">{status === 'error' ? '播放失败' : current.singer}</span>
                </span>
            </button>
            <LikeButton track={current} className="h-9 w-9 hover:bg-white/10" />
            <button type="button" onClick={toggle} title={playing ? '暂停 (空格)' : '播放 (空格)'} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/10">
                {status === 'loading' ? <Spinner /> : status === 'error' ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : playing ? <Pause className="h-[18px] w-[18px]" fill="currentColor" /> : <Play className="h-[18px] w-[18px]" fill="currentColor" />}
            </button>
            <button type="button" onClick={() => next()} title="下一首 (Ctrl+→)" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white">
                <SkipForward className="h-[17px] w-[17px]" fill="currentColor" />
            </button>
            <span className="mx-0.5 h-6 w-px bg-white/15" />
            <button type="button" onClick={ui.openPlayer} title="打开播放页" className="grid h-10 w-9 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white">
                <ChevronRight className="h-5 w-5" />
            </button>
            <Progress />
        </motion.div>
    );
}
