import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Music2, X } from 'lucide-react';
import { seededRandom, thumbUrl } from '@/lib/util';
import { PLATFORM_NAMES, QUALITY_SHORT, bestQuality, type Track, type TrackSource } from '@/sdk/types';
import { useCover } from '../hooks';

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/** 封面图：自动解析本地封面，加载失败时显示基于名称的渐变占位 */
export function Cover({ src, seed = '', className = '', rounded = 'rounded-xl', alt = '', children, eager, size }: { src?: string; seed?: string; className?: string; rounded?: string; alt?: string; children?: ReactNode; eager?: boolean; /** 显示尺寸（CSS 像素），用于请求合适大小的缩略图 */ size?: number }) {
    const url = useCover(size ? thumbUrl(src, size) : src);
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [url]);
    const rand = seededRandom(seed || src || 'ye');
    const hue = Math.floor(rand() * 360);
    return (
        <div className={cx('relative overflow-hidden bg-white/[0.06]', rounded, className)}>
            {url && !failed ? (
                <img src={url} alt={alt} draggable={false} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
                <div className="absolute inset-0 grid place-items-center" style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 50) % 360} 55% 18%))` }}>
                    <Music2 className="h-1/3 w-1/3 text-white/35" strokeWidth={1.5} />
                </div>
            )}
            {children}
        </div>
    );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; active?: boolean; size?: 'sm' | 'md' | 'lg'; variant?: 'ghost' | 'glass' | 'solid' | 'white' };

/** 圆形图标按钮（Folia 风格的半透明圆钮） */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, active, size = 'md', variant = 'ghost', className = '', children, ...rest }, ref) {
    const sizes = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' };
    const variants = {
        ghost: active ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
        glass: active ? 'bg-white/25 text-white' : 'bg-white/10 text-white/85 backdrop-blur-xl hover:bg-white/20 hover:text-white',
        solid: 'bg-black/35 text-white/85 backdrop-blur-xl hover:bg-black/50 hover:text-white',
        white: 'bg-white text-black hover:bg-white/90',
    };
    return (
        <button ref={ref} type="button" title={label} aria-label={label} className={cx('no-drag grid shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35', sizes[size], variants[variant], className)} {...rest}>
            {children}
        </button>
    );
});

export function Button({ children, variant = 'glass', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'glass' | 'white' | 'danger' | 'ghost' }) {
    const variants = {
        glass: 'bg-white/10 hover:bg-white/[0.16] text-white border border-white/10',
        white: 'bg-white text-black hover:bg-white/90',
        danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-400/20',
        ghost: 'text-white/70 hover:text-white hover:bg-white/10',
    };
    return (
        <button type="button" className={cx('no-drag inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40', variants[variant], className)} {...rest}>
            {children}
        </button>
    );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
    return <Loader2 className={cx('animate-spin', className)} />;
}

/** 自绘滑块：拖动时实时回调，松开时 onCommit */
export function Slider({ value, max = 1, min = 0, step = 0, onChange, onCommit, className = '', trackClass = 'h-1', fillClass = 'bg-white', thumb = true, buffered, disabled }: {
    value: number; max?: number; min?: number; step?: number; onChange?: (v: number) => void; onCommit?: (v: number) => void;
    className?: string; trackClass?: string; fillClass?: string; thumb?: boolean; buffered?: number; disabled?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<number | null>(null);
    const shown = drag ?? value;
    const range = max - min || 1;
    const pct = Math.max(0, Math.min(1, (shown - min) / range)) * 100;
    const calc = useCallback((clientX: number) => {
        const rect = ref.current!.getBoundingClientRect();
        let v = min + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * range;
        if (step) v = Math.round(v / step) * step;
        return v;
    }, [min, range, step]);
    return (
        <div
            ref={ref}
            className={cx('no-drag group relative flex h-4 cursor-pointer touch-none items-center touch:h-8', disabled && 'pointer-events-none opacity-40', className)}
            onPointerDown={event => {
                (event.target as HTMLElement).setPointerCapture(event.pointerId);
                const v = calc(event.clientX);
                setDrag(v);
                onChange?.(v);
            }}
            onPointerMove={event => {
                if (drag === null) return;
                const v = calc(event.clientX);
                setDrag(v);
                onChange?.(v);
            }}
            onPointerUp={event => {
                if (drag === null) return;
                const v = calc(event.clientX);
                setDrag(null);
                onCommit?.(v);
            }}
            onPointerCancel={() => setDrag(null)}
        >
            <div className={cx('relative w-full overflow-hidden rounded-full bg-white/15', trackClass)}>
                {buffered !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-white/15" style={{ width: `${Math.max(0, Math.min(1, (buffered - min) / range)) * 100}%` }} />}
                <div className={cx('absolute inset-y-0 left-0 rounded-full', fillClass)} style={{ width: `${pct}%` }} />
            </div>
            {thumb && <div className={cx('absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,.35)] transition-transform', drag !== null ? 'scale-110' : 'scale-0 group-hover:scale-100')} style={{ left: `${pct}%` }} />}
        </div>
    );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cx('no-drag relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40', checked ? 'bg-white' : 'bg-white/15')}>
            <span className={cx('absolute top-0.5 h-5 w-5 rounded-full transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)]', checked ? 'left-[22px] bg-black' : 'left-0.5 bg-white/80')} />
        </button>
    );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', className = '' }: { value: T; options: { value: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string }) {
    return (
        <div className={cx('no-drag inline-flex items-center gap-0.5 rounded-full bg-white/[0.08] p-1', className)}>
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={cx(
                        'relative inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors duration-200',
                        size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-8 px-4 text-[13px]',
                        value === option.value ? 'text-black' : 'text-white/65 hover:text-white',
                    )}
                >
                    {value === option.value && <motion.span layoutId={`seg-${options.map(o => o.value).join('-')}`} className="absolute inset-0 rounded-full bg-white" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="relative z-10 inline-flex items-center gap-1.5">{option.icon}{option.label}</span>
                </button>
            ))}
        </div>
    );
}

export function Chip({ active, children, onClick, className = '' }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string }) {
    return (
        <button type="button" onClick={onClick} className={cx('no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors', active ? 'bg-white text-black' : 'bg-white/[0.08] text-white/80 hover:bg-white/[0.14]', className)}>
            {children}
        </button>
    );
}

const PLATFORM_COLORS: Record<TrackSource, string> = {
    tx: 'text-emerald-300 border-emerald-300/30',
    wy: 'text-red-300 border-red-300/30',
    kg: 'text-sky-300 border-sky-300/30',
    kw: 'text-amber-300 border-amber-300/30',
    mg: 'text-pink-300 border-pink-300/30',
    local: 'text-white/60 border-white/20',
};

export function PlatformTag({ source, className = '' }: { source: TrackSource; className?: string }) {
    return <span className={cx('inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium leading-none', PLATFORM_COLORS[source], className)}>{source === 'local' ? '本地' : PLATFORM_NAMES[source].replace('音乐', '')}</span>;
}

export function QualityTag({ track }: { track: Track }) {
    const q = track.source === 'local' ? (track.lossless ? 'flac' : undefined) : bestQuality(track);
    if (!q || q === '128k' || q === '320k') return null;
    return <span className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-white/[0.12] px-1.5 font-mono text-[9.5px] font-semibold leading-none text-white/80">{QUALITY_SHORT[q]}</span>;
}

/** 通用模态框 */
export function Modal({ open, onClose, children, className = '', title, wide }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; title?: ReactNode; wide?: boolean }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, onClose]);
    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-6 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
                    <motion.div
                        className={cx('relative max-h-full overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(23,22,31,0.95)] shadow-[0_40px_120px_rgba(0,0,0,.6)]', wide ? 'w-[min(920px,100%)]' : 'w-[min(440px,100%)]', className)}
                        initial={{ opacity: 0, scale: 0.94, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    >
                        {title !== undefined && (
                            <div className="flex items-center justify-between px-7 pb-2 pt-6">
                                <h2 className="text-[20px] font-bold tracking-tight">{title}</h2>
                                <IconButton label="关闭" size="sm" onClick={onClose}><X className="h-4 w-4" /></IconButton>
                            </div>
                        )}
                        {children}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export function EmptyState({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            {icon && <div className="grid h-20 w-20 place-items-center rounded-[22px] border border-white/10 bg-white/[0.05] text-white/55">{icon}</div>}
            <div className="text-[20px] font-bold tracking-tight text-white/90">{title}</div>
            {desc && <div className="max-w-md text-[13px] leading-relaxed text-white/50">{desc}</div>}
            {children && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>}
        </div>
    );
}

/** 播放中动态条 */
export function PlayingBars({ paused, className = '' }: { paused?: boolean; className?: string }) {
    return (
        <span className={cx('inline-flex h-3.5 items-end gap-[2px]', className)}>
            {[0, 1, 2].map(i => (
                <span key={i} className={cx('w-[3px] rounded-full bg-current', !paused && 'eq-bar')} style={{ height: paused ? `${[40, 70, 50][i]}%` : '100%', animationDelay: `${i * 0.18}s` }} />
            ))}
        </span>
    );
}
