/** 3D 封面流：中心大封面 + 两侧递减缩放、旋转、变暗；支持滚轮 / 拖动 / 方向键 */
import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { useWindowSize } from '../hooks';
import { Cover, cx } from '../components/common';

export interface CarouselItem {
    key: string;
    title: string;
    meta: string;
    cover?: string;
    seed?: string;
    art?: ReactNode;
    onOpen: () => void;
    onPlay?: () => void;
}

interface Props {
    items: CarouselItem[];
    focus: number;
    onFocus: (index: number) => void;
    keyboard?: boolean;
    reduceMotion?: boolean;
}

export function coverSize(w: number, h: number) {
    if (w < 640) return Math.round(Math.min(300, w * 0.6, h * 0.36));
    return Math.round(Math.max(200, Math.min(340, h * 0.38, w * 0.25)));
}

export function Carousel({ items, focus, onFocus, keyboard = true, reduceMotion }: Props) {
    const { w, h } = useWindowSize();
    const size = coverSize(w, h);
    const wheelAcc = useRef(0);
    const wheelLock = useRef(0);
    const drag = useRef<{ x: number; focus: number; moved: boolean } | null>(null);
    const focusRef = useRef(focus);
    focusRef.current = focus;
    const count = items.length;

    useEffect(() => {
        if (!keyboard) return;
        const onKey = (event: KeyboardEvent) => {
            if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                onFocus(Math.max(0, focusRef.current - 1));
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                onFocus(Math.min(count - 1, focusRef.current + 1));
            } else if (event.key === 'Enter') {
                items[focusRef.current]?.onOpen();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [keyboard, count, items, onFocus]);

    const step = (d: number) => {
        const a = Math.abs(d);
        const x = a === 0 ? 0 : a <= 1 ? a * size * 0.86 : a <= 2 ? size * 0.86 + (a - 1) * size * 0.84 : size * 1.7 + (a - 2) * size * 0.7;
        const scale = a === 0 ? 1 : a <= 1 ? 1 - a * 0.26 : a <= 2 ? 0.74 - (a - 1) * 0.14 : Math.max(0.4, 0.6 - (a - 2) * 0.1);
        const opacity = a === 0 ? 1 : a <= 1 ? 0.92 : a <= 2 ? 0.6 : Math.max(0, 0.6 - (a - 2) * 0.45);
        const brightness = a === 0 ? 1 : a <= 1 ? 0.62 : 0.48;
        return { x: Math.sign(d) * x, scale, opacity, brightness, rotateY: Math.max(-28, Math.min(28, -d * 16)), z: 100 - Math.round(a * 10) };
    };

    return (
        <div
            className="relative h-full w-full touch-none select-none"
            style={{ perspective: 1400 }}
            onWheel={event => {
                const now = Date.now();
                wheelAcc.current += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                if (now - wheelLock.current < 140 || Math.abs(wheelAcc.current) < 40) return;
                wheelLock.current = now;
                const dir = Math.sign(wheelAcc.current);
                wheelAcc.current = 0;
                onFocus(Math.max(0, Math.min(count - 1, focusRef.current + dir)));
            }}
            onPointerDown={event => {
                drag.current = { x: event.clientX, focus: focusRef.current, moved: false };
            }}
            onPointerMove={event => {
                if (!drag.current || !(event.buttons & 1)) return;
                const dx = event.clientX - drag.current.x;
                if (Math.abs(dx) > 6) drag.current.moved = true;
                const target = Math.max(0, Math.min(count - 1, drag.current.focus - Math.round(dx / (size * 0.6))));
                if (target !== focusRef.current) onFocus(target);
            }}
            onPointerUp={() => {
                setTimeout(() => { drag.current = null; }, 0);
            }}
        >
            {/* 装饰：中心圆环与水平细线 */}
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(to_right,rgba(255,255,255,0),rgba(255,255,255,0.09),rgba(255,255,255,0))]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]" style={{ width: size * 1.75, height: size * 1.75 }} />
            {items.map((item, index) => {
                const d = index - focus;
                if (Math.abs(d) > 4) return null;
                const s = step(d);
                const isCenter = d === 0;
                return (
                    <motion.div
                        key={item.key}
                        className="absolute left-1/2 top-1/2"
                        style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, zIndex: s.z, transformStyle: 'preserve-3d' }}
                        initial={false}
                        animate={{ x: s.x, scale: s.scale, rotateY: s.rotateY, opacity: s.opacity }}
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }}
                    >
                        <div
                            role="button"
                            tabIndex={-1}
                            onClick={() => {
                                if (drag.current?.moved) return;
                                if (isCenter) item.onOpen();
                                else onFocus(index);
                            }}
                            onDoubleClick={() => { if (isCenter) item.onPlay?.(); }}
                            className={cx(
                                'group relative h-full w-full overflow-hidden rounded-[18px] transition-[filter,box-shadow] duration-500',
                                isCenter ? 'shadow-[0_30px_80px_rgba(0,0,0,.55)] ring-1 ring-white/25' : 'shadow-[0_18px_50px_rgba(0,0,0,.45)] ring-1 ring-white/10',
                            )}
                            style={{ filter: `brightness(${s.brightness}) saturate(${isCenter ? 1 : 0.85})` }}
                        >
                            {item.art || <Cover src={item.cover} seed={item.seed || item.title} className="h-full w-full" rounded="rounded-[18px]" eager={Math.abs(d) <= 2} />}
                            {isCenter && item.onPlay && (
                                <button
                                    type="button"
                                    title="播放"
                                    onClick={event => {
                                        event.stopPropagation();
                                        item.onPlay?.();
                                    }}
                                    className="absolute bottom-4 right-4 grid h-12 w-12 translate-y-2 place-items-center rounded-full bg-white text-black opacity-0 shadow-[0_10px_30px_rgba(0,0,0,.4)] transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
                                >
                                    <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
                                </button>
                            )}
                        </div>
                    </motion.div>
                );
            })}
        </div>
    );
}

/** 排行榜等没有封面的条目：生成式海报 */
export function PosterArt({ title, subtitle, seed, icon, tone }: { title: string; subtitle?: string; seed: string; icon?: ReactNode; tone?: [number, number] }) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const hue = tone ? tone[0] : hash % 360;
    const hue2 = tone ? tone[1] : (hue + 40 + (hash % 80)) % 360;
    return (
        <div className="relative h-full w-full overflow-hidden" style={{ background: `radial-gradient(120% 90% at 85% 10%, hsl(${hue2} 75% 62% / .85), transparent 55%), radial-gradient(90% 90% at 10% 100%, hsl(${hue} 70% 40%), transparent 70%), linear-gradient(160deg, hsl(${hue} 55% 22%), hsl(${hue2} 50% 12%))` }}>
            <div className="halftone absolute inset-0 opacity-30" />
            <div className="absolute -right-6 -top-6 h-1/2 w-1/2 rounded-full border border-white/20" />
            <div className="absolute -right-2 top-6 h-1/3 w-1/3 rounded-full border border-white/10" />
            {icon && <div className="absolute left-[9%] top-[9%] text-white/85 [&>svg]:h-[22%] [&>svg]:w-[22%]">{icon}</div>}
            <div className="absolute inset-x-[9%] bottom-[9%]">
                {subtitle && <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">{subtitle}</div>}
                <div className="text-[clamp(20px,2.4vw,34px)] font-black leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,.3)]">{title}</div>
            </div>
        </div>
    );
}
