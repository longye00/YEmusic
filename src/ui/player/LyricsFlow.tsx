/** Flow 歌词：经典滚动歌词，当前行放大高亮，逐字歌词按时间填充，点击任意行跳转 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { findLineIndex, type LyricLine, type ParsedLyric } from '@/lib/lyric';
import { engine } from '@/player/engine';
import { seek } from '@/store/player';
import { useSettings } from '@/store/settings';
import { css, type RGB } from '../theme';
import { buildUnits } from './lyricUnits';

const Line = memo(function Line({ line, active, distance, accent, showTrans, showRoma, fontSize, family, time }: {
    line: LyricLine; active: boolean; distance: number; accent: RGB; showTrans: boolean; showRoma: boolean; fontSize: number; family: string; time: number;
}) {
    const units = active && line.words?.length ? buildUnits(line) : null;
    const blur = active ? 0 : Math.min(3, Math.abs(distance) * 0.7);
    return (
        <div
            role="button"
            tabIndex={-1}
            onClick={() => seek(line.time)}
            className="pointer-events-auto origin-left cursor-pointer rounded-2xl px-4 py-3 transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(.22,1,.36,1)] hover:bg-white/[0.06]"
            style={{ transform: `scale(${active ? 1 : 0.92})`, opacity: active ? 1 : Math.max(0.16, 0.5 - Math.abs(distance) * 0.07), filter: `blur(${blur}px)` }}
        >
            <div style={{ fontSize, fontFamily: family, fontWeight: 800, lineHeight: 1.3 }} className={active ? 'text-white' : 'text-white/80'}>
                {units ? units.map((u, i) => {
                    if (u.space) return <span key={i}> </span>;
                    const done = time >= u.end;
                    const going = time >= u.start && !done;
                    const dur = Math.max(0.05, u.end - u.start);
                    return (
                        <span
                            key={i}
                            className="bg-clip-text text-transparent"
                            style={{
                                backgroundImage: 'linear-gradient(90deg, #fff 0%, #fff 50%, rgb(255 255 255 / .32) 50%, rgb(255 255 255 / .32) 100%)',
                                backgroundSize: '200% 100%',
                                backgroundPosition: done || going ? '0% 0' : '100% 0',
                                transition: going ? `background-position ${dur}s linear` : done ? 'background-position .15s linear' : 'none',
                                textShadow: going ? `0 0 24px ${css(accent, 0.45)}` : undefined,
                                WebkitBackgroundClip: 'text',
                            }}
                        >
                            {u.text}
                        </span>
                    );
                }) : line.text || '♪'}
            </div>
            {showRoma && line.roma && <div className="mt-1 text-[14px] font-medium text-white/45">{line.roma}</div>}
            {showTrans && line.trans && <div className="mt-1 text-[16px] font-semibold" style={{ color: active ? css(accent) : undefined }}>{line.trans}</div>}
        </div>
    );
});

export function LyricsFlow({ lyric, accent }: { lyric: ParsedLyric; accent: RGB }) {
    const offset = useSettings(s => s.lyricOffset);
    const scale = useSettings(s => s.lyricScale);
    const font = useSettings(s => s.lyricFont);
    const showTrans = useSettings(s => s.showTranslation);
    const showRoma = useSettings(s => s.showRoma);
    const [active, setActive] = useState(-1);
    const [time, setTime] = useState(0);
    const [shift, setShift] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const userScroll = useRef(0);
    const drag = useRef<{ y: number; moved: boolean } | null>(null);
    const suppressClick = useRef(false);
    const lines = lyric.lines;

    useEffect(() => {
        let frame = 0;
        let lastTime = 0;
        const loop = (now: number) => {
            frame = requestAnimationFrame(loop);
            const t = engine.currentTime + offset / 1000;
            const index = findLineIndex(lines, t);
            setActive(prev => (prev === index ? prev : index));
            // 逐字填充只需较低频率刷新
            if (now - lastTime > 90) {
                lastTime = now;
                setTime(t);
            }
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [lines, offset]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const list = listRef.current;
        if (!container || !list) return;
        const el = list.children[Math.max(0, active)] as HTMLElement | undefined;
        if (!el) return;
        if (Date.now() - userScroll.current < 2500) return;
        setShift(container.clientHeight * 0.42 - (el.offsetTop + el.offsetHeight / 2));
    }, [active, lines]);

    const fontSize = Math.round(32 * scale);
    const family = font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)';
    return (
        <div
            ref={containerRef}
            className="mask-fade-y absolute inset-y-0 left-1/2 w-[min(1000px,86vw)] -translate-x-1/2 touch-none overflow-hidden"
            onWheel={event => {
                userScroll.current = Date.now();
                setShift(s => s - event.deltaY);
            }}
            // 触屏：上下拖动手动滚动歌词；拖动结束后的那次 click 不触发跳转
            onPointerDown={event => {
                if (event.pointerType === 'touch') drag.current = { y: event.clientY, moved: false };
            }}
            onPointerMove={event => {
                const d = drag.current;
                if (!d) return;
                const dy = event.clientY - d.y;
                if (!d.moved && Math.abs(dy) < 6) return;
                d.moved = true;
                d.y = event.clientY;
                userScroll.current = Date.now();
                setShift(s => s + dy);
            }}
            onPointerUp={() => {
                if (drag.current?.moved) {
                    suppressClick.current = true;
                    setTimeout(() => { suppressClick.current = false; }, 80);
                }
                drag.current = null;
            }}
            onPointerCancel={() => { drag.current = null; }}
            onClickCapture={event => {
                if (suppressClick.current) { event.stopPropagation(); event.preventDefault(); }
            }}
        >
            <motion.div ref={listRef} className="absolute inset-x-0 top-0 flex flex-col gap-1 py-[30vh]" animate={{ y: shift }} transition={{ type: 'spring', stiffness: 90, damping: 22, mass: 0.9 }}>
                {lines.map((line, i) => (
                    <Line key={`${i}-${line.time}`} line={line} active={i === active} distance={i - active} accent={accent} showTrans={showTrans} showRoma={showRoma} fontSize={fontSize} family={family} time={i === active ? time : 0} />
                ))}
            </motion.div>
        </div>
    );
}
