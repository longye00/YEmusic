import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Music2, X } from 'lucide-react';
import { seededRandom, thumbUrl } from '@/lib/util';
import { PLATFORM_NAMES, QUALITY_SHORT, bestQuality, type Track, type TrackSource } from '@/sdk/types';
import { useCover } from '../hooks';
import { Surface } from './Surface';

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
                    <Music2 className="h-1/3 w-1/3 txt-4" strokeWidth={1.5} />
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
        ghost: active ? 'bg-[var(--ui-selected)] text-white' : 'txt-3 hover:bg-[var(--ui-hover)] hover:text-white',
        glass: active ? 'bg-[var(--ui-selected)] text-white' : 'bg-[var(--ui-idle)] txt-1 backdrop-blur-xl hover:bg-[var(--ui-hover)] hover:text-white',
        solid: 'bg-black/35 txt-1 backdrop-blur-xl hover:bg-black/50 hover:text-white',
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
        glass: 'bg-[var(--ui-idle)] hover:bg-[var(--ui-hover)] text-white border ln',
        white: 'bg-white text-black hover:bg-white/90',
        danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-400/20',
        ghost: 'txt-3 hover:text-white hover:bg-[var(--ui-hover)]',
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

/** 自绘滑块：拖动时实时回调，松开时 onCommit；键盘方向键 / Home / End / PageUp / PageDown 可用 */
export function Slider({ value, max = 1, min = 0, step = 0, onChange, onCommit, className = '', trackClass = 'h-1', fillClass = 'bg-white', thumb = true, buffered, disabled, label, valueText }: {
    value: number; max?: number; min?: number; step?: number; onChange?: (v: number) => void; onCommit?: (v: number) => void;
    className?: string; trackClass?: string; fillClass?: string; thumb?: boolean; buffered?: number; disabled?: boolean;
    /** 无障碍名称：读屏会念出来 */
    label?: string;
    /** 读屏播报的值；不传则念数字 */
    valueText?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<number | null>(null);
    const shown = drag ?? value;
    const range = max - min || 1;
    const pct = Math.max(0, Math.min(1, (shown - min) / range)) * 100;
    const clamp = (v: number) => Math.max(min, Math.min(max, v));
    // 没有 step 时按量程的 5% 走一格（音量、进度条都是这种）；有 step 就用 step
    const unit = step || range / 20;
    const calc = useCallback((clientX: number) => {
        const rect = ref.current!.getBoundingClientRect();
        let v = min + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * range;
        if (step) v = Math.round(v / step) * step;
        return v;
    }, [min, range, step]);

    /**
     * 键盘操作：原先只有指针事件，音量 / 进度 / 均衡器 / 歌词偏移全都点不到键盘，
     * 桌面端等于不可用。这里补齐 role / aria 与按键，并把结果对齐到 step。
     */
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        const big = unit * 5;
        let next: number | null = null;
        switch (event.key) {
            case 'ArrowLeft': case 'ArrowDown': next = clamp(value - unit); break;
            case 'ArrowRight': case 'ArrowUp': next = clamp(value + unit); break;
            case 'PageDown': next = clamp(value - big); break;
            case 'PageUp': next = clamp(value + big); break;
            case 'Home': next = min; break;
            case 'End': next = max; break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (step) next = clamp(Math.round(next / step) * step);
        // 浮点累加会留下 0.30000000000000004 这种尾巴，按 step 的小数位收一下
        if (step) { const d = (String(step).split('.')[1] || '').length; next = Number(next.toFixed(Math.min(d + 2, 6))); }
        if (next === value) return;
        onChange?.(next);
        onCommit?.(next);
    };

    return (
        <div
            ref={ref}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Number(shown.toFixed(4))}
            aria-valuetext={valueText}
            aria-disabled={disabled || undefined}
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
            className={cx('no-drag group relative flex h-4 cursor-pointer touch-none items-center outline-none touch:h-8', disabled ? 'pointer-events-none opacity-40' : 'focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-white/45', className)}
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
            {thumb && <div className={cx('absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white shadow-[var(--shadow-inset)] transition-transform', drag !== null ? 'scale-110' : 'scale-0 group-hover:scale-100 group-focus-visible:scale-100')} style={{ left: `${pct}%` }} />}
        </div>
    );
}

/** 开关：打开时用主题色（Folia 的紫色开关同理，随封面取色 / 自定义配色变化），圆点在深色轨道上留深色 */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
    return (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cx('no-drag relative h-6 w-[42px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-[rgb(var(--accent))]' : 'bg-white/[0.16]')}>
            <span className={cx('absolute top-[3px] h-[18px] w-[18px] rounded-full transition-all duration-300 ease-[cubic-bezier(.22,1,.36,1)]', checked ? 'left-[21px] bg-[#15141b]' : 'left-[3px] bg-white/85')} />
        </button>
    );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', className = '' }: { value: T; options: { value: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string }) {
    return (
        <div className={cx('no-drag inline-flex items-center gap-0.5 rounded-full bg-[var(--ui-idle)] p-1', className)}>
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={cx(
                        'relative inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors duration-200',
                        size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-8 px-4 text-[13px]',
                        value === option.value ? 'text-black' : 'txt-3 hover:text-white',
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
        <button type="button" onClick={onClick} className={cx('no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors', active ? 'bg-white text-black' : 'bg-[var(--ui-idle)] txt-2 hover:bg-[var(--ui-hover)]', className)}>
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
    local: 'txt-3 ln-strong',
};

export function PlatformTag({ source, className = '' }: { source: TrackSource; className?: string }) {
    return <span className={cx('inline-flex h-[18px] shrink-0 items-center rounded-full border px-1.5 text-[10px] font-medium leading-none', PLATFORM_COLORS[source], className)}>{source === 'local' ? '本地' : PLATFORM_NAMES[source].replace('音乐', '')}</span>;
}

export function QualityTag({ track }: { track: Track }) {
    const q = track.source === 'local' ? (track.lossless ? 'flac' : undefined) : bestQuality(track);
    if (!q || q === '128k' || q === '320k') return null;
    return <span className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-white/[0.12] px-1.5 font-mono text-[9.5px] font-semibold leading-none txt-2">{QUALITY_SHORT[q]}</span>;
}

/**
 * 通用模态框。
 *
 * 行为全部交给 Surface：Esc、遮罩点击、焦点陷阱、关闭后焦点归还。这里只剩外观与标题行，
 * 所以 Overlays.tsx 里那 8 个对话框不用逐个改，接上 Modal 就都有键盘焦点了。
 */
export function Modal({ open, onClose, children, className = '', title, wide }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; title?: ReactNode; wide?: boolean }) {
    return (
        <Surface
            open={open}
            onClose={onClose}
            label={typeof title === 'string' ? title : undefined}
            className={cx(wide ? 'w-[min(920px,100%)]' : 'w-[min(440px,100%)]', className)}
        >
            {title !== undefined && (
                <div className="flex items-center justify-between px-7 pb-2 pt-6">
                    <h2 className="text-[20px] font-bold tracking-tight">{title}</h2>
                    <IconButton label="关闭" size="sm" onClick={onClose}><X className="h-4 w-4" /></IconButton>
                </div>
            )}
            {children}
        </Surface>
    );
}

/**
 * 空状态。
 *
 * @param dense 窄容器（320px 的播放面板、设置里的单栏）用紧凑版：小图标、小标题、小留白。
 *   这些地方原先各写一句 `py-6 text-center text-[13px] txt-4`，
 *   留白 6/8 不一、字色 /40 与 /45 混用、有的带图标有的不带，看着不成一套。
 */
export function EmptyState({ icon, title, desc, children, dense }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode; dense?: boolean }) {
    if (dense) {
        return (
            <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-7 text-center">
                {icon && <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--ui-idle)] txt-4">{icon}</div>}
                <div className="text-[12.5px] font-semibold txt-3">{title}</div>
                {desc && <div className="max-w-[240px] break-words text-[11.5px] leading-relaxed txt-4">{desc}</div>}
                {children && <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">{children}</div>}
            </div>
        );
    }
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            {icon && <div className="grid h-20 w-20 place-items-center rounded-[22px] border ln bg-white/[0.05] txt-3">{icon}</div>}
            <div className="text-[20px] font-bold tracking-tight txt-1">{title}</div>
            {desc && <div className="max-w-md text-[13px] leading-relaxed txt-4">{desc}</div>}
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
