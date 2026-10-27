import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Heart, MoreHorizontal } from 'lucide-react';
import { formatTime } from '@/lib/util';
import type { Track } from '@/sdk/types';
import { toggleFavorite } from '@/store/library';
import { usePlayer } from '@/store/player';
import { ui } from '@/store/ui';
import { useIsFavorite } from '../hooks';
import { Cover, PlatformTag, PlayingBars, QualityTag, cx } from './common';

export const ROW_HEIGHT = 72;

interface RowProps {
    track: Track;
    index: number;
    showIndex?: boolean;
    showPlatform?: boolean;
    onPlay: (track: Track, index: number) => void;
    onMenu?: (event: React.MouseEvent, track: Track, index: number) => void;
    trailing?: ReactNode;
    dense?: boolean;
}

export const TrackRow = memo(function TrackRow({ track, index, showIndex, showPlatform = true, onPlay, onMenu, trailing, dense }: RowProps) {
    const isCurrent = usePlayer(s => s.current?.id === track.id);
    const status = usePlayer(s => (s.current?.id === track.id ? s.status : 'idle'));
    const favorite = useIsFavorite(track.id);
    return (
        <div
            role="button"
            tabIndex={-1}
            onClick={() => onPlay(track, index)}
            onContextMenu={event => {
                event.preventDefault();
                onMenu?.(event, track, index);
            }}
            className={cx(
                'group flex items-center gap-3 rounded-2xl border px-3 transition-colors duration-150',
                dense ? 'h-[56px]' : 'h-[64px]',
                isCurrent ? 'border-white/20 bg-white/[0.1]' : 'border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.07]',
            )}
        >
            {showIndex && (
                <div className="w-7 shrink-0 text-center font-mono text-[12px] text-white/35 max-sm:hidden">
                    {isCurrent ? <PlayingBars paused={status !== 'playing'} className="text-white" /> : index + 1}
                </div>
            )}
            <Cover src={track.cover} size={dense ? 40 : 48} seed={track.name} className={dense ? 'h-10 w-10' : 'h-12 w-12'} rounded="rounded-[10px]">
                {isCurrent && (
                    <div className={cx('absolute inset-0 grid place-items-center bg-black/45', showIndex && 'sm:hidden')}>
                        <PlayingBars paused={status !== 'playing'} className="text-white" />
                    </div>
                )}
            </Cover>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={cx('truncate text-[14px] font-semibold', isCurrent ? 'text-white' : 'text-white/90')}>{track.name}</span>
                    <span className="contents max-sm:hidden">
                        <QualityTag track={track} />
                        {showPlatform && <PlatformTag source={track.source} />}
                    </span>
                </div>
                <div className="mt-0.5 truncate text-[12px] text-white/45">
                    {track.singer}
                    {track.album ? <span className="text-white/30"> • {track.album}</span> : null}
                </div>
            </div>
            {trailing}
            <div className={cx('flex items-center gap-0.5 transition-opacity', favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 touch:opacity-100')}>
                <button
                    type="button"
                    title={favorite ? '取消喜欢' : '喜欢'}
                    onClick={event => {
                        event.stopPropagation();
                        toggleFavorite(track);
                    }}
                    className={cx('grid h-8 w-8 place-items-center rounded-full hover:bg-white/10', favorite ? 'text-rose-400' : 'text-white/60 hover:text-white', 'touch:h-10 touch:w-10')}
                >
                    <Heart className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <button
                    type="button"
                    title="更多"
                    onClick={event => {
                        event.stopPropagation();
                        onMenu?.(event, track, index);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-full text-white/60 opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100 touch:h-10 touch:w-10 touch:opacity-100"
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>
            </div>
            <span className="w-11 shrink-0 text-right font-mono text-[12px] text-white/40 max-sm:hidden">{track.duration ? formatTime(track.duration) : '--:--'}</span>
        </div>
    );
});

/** 简易虚拟列表：固定行高，只渲染可见区域 */
export function VirtualTrackList({ tracks, onPlay, playlistId, showIndex, showPlatform, header, footer, onEndReached, className = '', rowHeight = ROW_HEIGHT, padding = 0, dense }: {
    tracks: Track[];
    onPlay: (track: Track, index: number) => void;
    playlistId?: string;
    showIndex?: boolean;
    showPlatform?: boolean;
    header?: ReactNode;
    footer?: ReactNode;
    onEndReached?: () => void;
    className?: string;
    rowHeight?: number;
    padding?: number;
    dense?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const [range, setRange] = useState({ start: 0, end: 30 });
    const [headerHeight, setHeaderHeight] = useState(0);
    const endRef = useRef(onEndReached);
    endRef.current = onEndReached;

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => {
            const top = Math.max(0, el.scrollTop - headerHeight - padding);
            const start = Math.max(0, Math.floor(top / rowHeight) - 8);
            const end = Math.min(tracks.length, Math.ceil((top + el.clientHeight) / rowHeight) + 8);
            setRange(r => (r.start === start && r.end === end ? r : { start, end }));
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) endRef.current?.();
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => {
            el.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, [tracks.length, rowHeight, headerHeight, padding]);

    useEffect(() => {
        if (!headerRef.current) return;
        const observer = new ResizeObserver(() => setHeaderHeight(headerRef.current?.offsetHeight || 0));
        observer.observe(headerRef.current);
        return () => observer.disconnect();
    }, []);

    const openMenu = (event: React.MouseEvent, track: Track) => ui.menu({ x: event.clientX, y: event.clientY, track, list: tracks, playlistId });

    return (
        <div ref={ref} className={cx('scroll-thin overflow-y-auto', className)} style={{ paddingTop: padding, paddingBottom: padding }}>
            <div ref={headerRef}>{header}</div>
            <div className="relative" style={{ height: tracks.length * rowHeight }}>
                {tracks.slice(range.start, range.end).map((track, i) => {
                    const index = range.start + i;
                    return (
                        <div key={`${track.id}-${index}`} className="absolute inset-x-0" style={{ top: index * rowHeight, height: rowHeight - 8 }}>
                            <TrackRow track={track} index={index} showIndex={showIndex} showPlatform={showPlatform} onPlay={onPlay} onMenu={openMenu} dense={dense} />
                        </div>
                    );
                })}
            </div>
            {footer}
        </div>
    );
}
