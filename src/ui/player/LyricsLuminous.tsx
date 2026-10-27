/**
 * Luminous 歌词：每个字随演唱时间弹出，带种子化的随机偏移 / 旋转 / 缩放与波浪基线，
 * 正在唱的字发出强调色辉光，整行结束时模糊放大退场。实现为本项目独立编写。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { findLineIndex, type ParsedLyric } from '@/lib/lyric';
import { seededRandom } from '@/lib/util';
import { engine } from '@/player/engine';
import { useSettings, type LyricIntensity } from '@/store/settings';
import { useWindowSize } from '../hooks';
import { css, type RGB } from '../theme';
import { activeUnitIndex, buildUnits, isCjk, type Unit } from './lyricUnits';

const INTENSITY: Record<LyricIntensity, { rot: number; dy: number; dx: number; scale: number; wave: number }> = {
    calm: { rot: 2.5, dy: 5, dx: 0, scale: 0.04, wave: 6 },
    normal: { rot: 8, dy: 16, dx: 3, scale: 0.13, wave: 16 },
    chaotic: { rot: 18, dy: 34, dx: 10, scale: 0.28, wave: 28 },
};

interface Jitter { r: number; y: number; x: number; s: number }

function jitterFor(text: string, count: number, intensity: LyricIntensity): Jitter[] {
    const rand = seededRandom(text);
    const k = INTENSITY[intensity];
    const phase = rand() * Math.PI * 2;
    const freq = 0.45 + rand() * 0.35;
    return Array.from({ length: count }, (_, i) => {
        const wave = Math.sin(i * freq + phase);
        const slope = Math.cos(i * freq + phase);
        return {
            r: (rand() * 2 - 1) * k.rot + slope * k.rot * 0.6,
            y: wave * k.wave + (rand() * 2 - 1) * k.dy,
            x: (rand() * 2 - 1) * k.dx,
            s: 1 + (rand() * 2 - 1) * k.scale,
        };
    });
}

type GlyphState = 'waiting' | 'active' | 'passed';

const Glyph = memo(function Glyph({ unit, state, jitter, accent, soft, reduce }: { unit: Unit; state: GlyphState; jitter: Jitter; accent: RGB; soft: RGB; reduce: boolean }) {
    const variants = {
        waiting: { opacity: 0, scale: jitter.s * 0.55, y: jitter.y + 26, x: jitter.x, rotate: jitter.r * 2.2, filter: 'blur(10px)', textShadow: `0 0 0px ${css(accent, 0)}`, color: '#ffffff' },
        active: { opacity: 1, scale: jitter.s * 1.12, y: jitter.y - 6, x: jitter.x, rotate: jitter.r * 0.6, filter: 'blur(0px)', textShadow: `0 0 18px ${css(accent, 0.95)}, 0 0 46px ${css(accent, 0.55)}`, color: '#ffffff' },
        passed: { opacity: 0.86, scale: jitter.s, y: jitter.y, x: jitter.x, rotate: jitter.r, filter: 'blur(0px)', textShadow: `0 0 0px ${css(accent, 0)}`, color: css(soft) },
    };
    return (
        <motion.span
            className="inline-block whitespace-pre will-change-transform"
            initial="waiting"
            animate={state}
            variants={variants}
            transition={reduce ? { duration: 0.15 } : state === 'active' ? { type: 'spring', stiffness: 320, damping: 16, mass: 0.7 } : { type: 'spring', stiffness: 120, damping: 20 }}
        >
            {unit.text}
        </motion.span>
    );
});

export function LyricsLuminous({ lyric, accent, soft, title, singer }: { lyric: ParsedLyric; accent: RGB; soft: RGB; title: string; singer: string }) {
    const intensity = useSettings(s => s.lyricIntensity);
    const scale = useSettings(s => s.lyricScale);
    const font = useSettings(s => s.lyricFont);
    const offset = useSettings(s => s.lyricOffset);
    const showTrans = useSettings(s => s.showTranslation);
    const showRoma = useSettings(s => s.showRoma);
    const reduce = useSettings(s => s.reduceMotion);
    const { w, h } = useWindowSize();
    // line: 当前行；-1 前奏；-2 间奏/尾奏（after 记录刚唱完的行，用于预告下一行）
    const [pos, setPos] = useState({ line: -1, unit: -1, after: -1 });
    const posRef = useRef(pos);
    const lines = lyric.lines;
    const unitsCache = useMemo(() => lines.map(line => buildUnits(line)), [lines]);

    useEffect(() => {
        let frame = 0;
        const loop = () => {
            frame = requestAnimationFrame(loop);
            const t = engine.currentTime + offset / 1000;
            let line = findLineIndex(lines, t);
            const after = line;
            // 当前行已唱完且距下一行较远时视为间奏（最后一行之后为尾奏）
            if (line >= 0 && t > lines[line].end + 0.6 && (!lines[line + 1] || lines[line + 1].time - t > 1.2)) line = -2;
            const unit = line >= 0 ? activeUnitIndex(unitsCache[line], t) : -1;
            const finished = line >= 0 && unit >= 0 && t >= unitsCache[line][unit].end ? 1 : 0;
            const key = unit + finished * 0.5;
            if (line !== posRef.current.line || key !== posRef.current.unit || after !== posRef.current.after) {
                posRef.current = { line, unit: key, after };
                setPos(posRef.current);
            }
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [lines, unitsCache, offset]);

    const line = pos.line >= 0 ? lines[pos.line] : undefined;
    const units = pos.line >= 0 ? unitsCache[pos.line] : [];
    const activeIndex = Math.floor(pos.unit);
    const allDone = pos.unit % 1 !== 0;
    const jitters = useMemo(() => jitterFor(line?.text || '', units.length, intensity), [line?.text, units.length, intensity]);
    const weight = units.reduce((sum, u) => sum + (u.space ? 0.3 : u.cjk ? 1 : u.text.length * 0.56), 0);
    const fontSize = Math.round(Math.max(34, Math.min(132, w * 0.085, (w * 0.8) / Math.max(4.5, weight * 1.12), h * 0.15)) * scale);
    const nextLine = lines.slice(Math.max(0, pos.after + 1)).find(l => l.text.trim());
    const family = font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)';
    const intro = pos.line === -1;
    // 尾奏：最后一句之后不再显示等待圆点，改为回到歌曲标题
    const outro = pos.line === -2 && !nextLine;

    return (
        <div className="pointer-events-none absolute inset-0">
            <motion.div className="absolute inset-0" animate={reduce ? undefined : { y: [0, -7, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}>
                <AnimatePresence mode="popLayout">
                    {line && units.length > 0 ? (
                        <motion.div
                            key={`l${pos.line}`}
                            className="absolute inset-0 flex items-center justify-center px-[6vw]"
                            initial={{ opacity: 1 }}
                            exit={{ opacity: 0, scale: 1.08, y: -28, filter: 'blur(14px)', transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } }}
                        >
                            <div className="flex max-w-full flex-wrap items-center justify-center" style={{ fontSize, fontFamily: family, fontWeight: 900, lineHeight: 1.25, columnGap: fontSize * (isCjk(line.text) ? 0.26 : 0.1), rowGap: fontSize * 0.22, letterSpacing: '-0.01em' }}>
                                {units.map((unit, i) =>
                                    unit.space ? (
                                        <span key={i} style={{ width: fontSize * 0.18 }} />
                                    ) : (
                                        <Glyph key={i} unit={unit} jitter={jitters[i]} accent={accent} soft={soft} reduce={reduce} state={i < activeIndex || (i === activeIndex && allDone) ? 'passed' : i === activeIndex ? 'active' : 'waiting'} />
                                    ),
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key={intro ? 'intro' : outro ? 'outro' : 'gap'}
                            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-[8vw] text-center"
                            initial={{ opacity: 0, filter: 'blur(12px)', scale: 0.96 }}
                            animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
                            exit={{ opacity: 0, filter: 'blur(12px)', scale: 1.04 }}
                            transition={{ duration: 0.8 }}
                        >
                            {intro || outro ? (
                                <>
                                    <div className="max-w-full text-white/90" style={{ fontFamily: family, fontWeight: 900, fontSize: Math.min(96, Math.max(40, w * 0.06)) * scale, lineHeight: 1.1, textShadow: `0 0 40px ${css(accent, 0.35)}` }}>{title}</div>
                                    <div className="text-[18px] font-medium text-white/50">{singer}</div>
                                </>
                            ) : (
                                <div className="flex gap-3">
                                    {[0, 1, 2].map(i => (
                                        <motion.span key={i} className="h-3 w-3 rounded-full" style={{ background: css(soft) }} animate={reduce ? undefined : { opacity: [0.25, 1, 0.25], scale: [0.8, 1.15, 0.8] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.25 }} />
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            <div className="absolute inset-x-0 bottom-[132px] flex flex-col items-center gap-1.5 px-10 text-center">
                <AnimatePresence mode="wait">
                    {line && ((showTrans && line.trans) || (showRoma && line.roma)) && (
                        <motion.div key={`t${pos.line}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }} className="flex flex-col items-center gap-1">
                            {showRoma && line.roma && <div className="text-[14px] font-medium tracking-wide" style={{ color: css(soft, 0.7) }}>{line.roma}</div>}
                            {showTrans && line.trans && <div className="text-[17px] font-semibold" style={{ color: css(accent) }}>{line.trans}</div>}
                        </motion.div>
                    )}
                </AnimatePresence>
                {nextLine && (
                    <AnimatePresence mode="wait">
                        <motion.div key={`n${nextLine.time}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="max-w-[70vw] truncate text-[15px] font-medium text-white/30 blur-[0.3px]">
                            {nextLine.text}
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
