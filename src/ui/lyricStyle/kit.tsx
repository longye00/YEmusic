/**
 * 歌词样式窗口的设置控件（移植 Folia settings kit 的样子：深色卡片 + 行 + 堆叠滑杆 + 页签条）。
 * 配色变量在 lyricStyle.css 的 .ye-lyst 作用域里；开关 / 分段沿用 YEmusic 自己的控件。
 */
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cx, Switch } from '../components/common';

/** 一组行：小标题 + 一张圆角卡片；第一组离页签近一点 */
export function KitGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="mt-7 first:mt-5">
            <div className="mb-2 flex min-h-6 items-center justify-between gap-3 px-1">
                <h3 className="text-[13px] font-semibold leading-5 text-white/62">{title}</h3>
                {action}
            </div>
            <div className="ye-lyst-card overflow-hidden rounded-xl bg-[#232327] shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">{children}</div>
        </section>
    );
}

/** 一行：左侧标签（可有 hint），右侧控件；below 时控件占整行沉到标签下面 */
export function KitRow({ label, hint, disabled, below, children }: {
    label: ReactNode;
    hint?: ReactNode;
    disabled?: boolean;
    /** 占整行宽度的内容，放在标签行下面（滑杆轨道、按钮排等） */
    below?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className={cx('ye-lyst-row relative flex min-h-14 flex-wrap items-center gap-x-6 py-2.5 pl-4 pr-4', disabled && 'pointer-events-none')}>
            <div className="relative min-w-0 flex-[1_1_140px]">
                <div className={cx('text-sm leading-5 text-white', disabled && 'opacity-40')}>{label}</div>
                {hint && <div className={cx('mt-0.5 text-xs leading-[18px] text-white/62', disabled && 'opacity-40')}>{hint}</div>}
            </div>
            {children && (
                <div className={cx('relative ml-auto flex max-w-full flex-wrap items-center justify-end gap-2', disabled && 'opacity-40')}>
                    {children}
                </div>
            )}
            {below && <div className={cx('relative mb-1 mt-2.5 min-w-0 basis-full', disabled && 'opacity-40')}>{below}</div>}
        </div>
    );
}

/** 开关行：标签在左，Switch 在右 */
export function KitToggle({ label, hint, checked, disabled, onChange }: {
    label: string;
    hint?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <KitRow label={label} hint={hint} disabled={disabled}>
            <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
        </KitRow>
    );
}

/**
 * 堆叠滑杆行（Folia 的 stacked Slider）：数值收在标签行右端，轨道占整行宽。
 * 原生 input[type=range]，键盘左右键天然可用；marks 是轨道下面的小刻度（如 100%）。
 */
export function KitSliderRow({ label, hint, value, min, max, step = 1, format, marks, disabled, onChange }: {
    label: string;
    hint?: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    format: (value: number) => string;
    /** 轨道下面的刻度位置（取值为单位），拖到附近会吸过去 */
    marks?: number[];
    disabled?: boolean;
    onChange: (value: number) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const dragging = useRef(false);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    return (
        <div className="ye-lyst-row relative flex min-h-14 flex-wrap items-center gap-x-6 py-2.5 pl-4 pr-4">
            <div className={cx('relative min-w-0 flex-1', disabled && 'opacity-40')}>
                <div className="flex items-baseline gap-3 text-sm leading-5">
                    <span className="min-w-0 text-white">{label}</span>
                    <output className="ml-auto shrink-0 font-mono text-xs text-white/62">{format(value)}</output>
                </div>
                {hint && <div className="mt-0.5 text-xs leading-[18px] text-white/62">{hint}</div>}
                <div className="relative mb-1 mt-1">
                    {marks?.map(mark => (
                        <span
                            key={mark}
                            aria-hidden
                            className="pointer-events-none absolute top-[21px] h-1 w-px -translate-x-1/2 bg-white/42"
                            style={{ left: `${((mark - min) / (max - min)) * 100}%` }}
                        />
                    ))}
                    <input
                        ref={inputRef}
                        type="range"
                        className="ye-lyst-range"
                        aria-label={label}
                        aria-valuetext={format(value)}
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        disabled={disabled}
                        style={{ '--p': `${pct}%` } as CSSProperties}
                        onPointerDown={() => { dragging.current = true; }}
                        onPointerUp={() => { dragging.current = false; }}
                        onPointerCancel={() => { dragging.current = false; }}
                        onBlur={() => { dragging.current = false; }}
                        onKeyDown={() => { dragging.current = false; }}
                        onChange={event => {
                            const next = Number(event.currentTarget.value);
                            // 拖动中靠近刻度（约 6px 行程）就吸上去；键盘方向键始终按 step 走
                            if (dragging.current && marks?.length) {
                                const reach = ((max - min) * 6) / Math.max(1, event.currentTarget.offsetWidth - 16);
                                const nearest = marks.reduce((a, b) => (Math.abs(b - next) < Math.abs(a - next) ? b : a));
                                if (Math.abs(nearest - next) <= reach) { onChange(nearest); return; }
                            }
                            onChange(next);
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

export interface KitTab {
    id: string;
    label: string;
}

/** 页签条（Folia kit Tabs）：文字页签 + 滑动的强调色下划线，右端留给「默认」之类的动作 */
export function KitTabs({ tabs, active, onSelect, action }: {
    tabs: KitTab[];
    active: string;
    onSelect: (id: string) => void;
    action?: ReactNode;
}) {
    const stopId = tabs.some(t => t.id === active) ? active : tabs[0]?.id;

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const at = Array.from(event.currentTarget.children).indexOf(document.activeElement as Element);
        if (!step || at < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        const next = (at + step + tabs.length) % tabs.length;
        (event.currentTarget.children[next] as HTMLElement).focus();
        onSelect(tabs[next].id);
    };

    return (
        <div className="flex shrink-0 items-end border-b border-white/[0.08] pl-4 pr-3 sm:pl-6">
            <div role="tablist" aria-label="歌词样式" onKeyDown={onKeyDown} className="relative flex min-w-0 flex-1 gap-[18px] overflow-x-auto [scrollbar-width:none] md:gap-[22px]">
                {tabs.map(tab => {
                    const current = tab.id === active;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={current}
                            tabIndex={tab.id === stopId ? 0 : -1}
                            onClick={() => onSelect(tab.id)}
                            className={cx('relative -mx-1 h-9 shrink-0 whitespace-nowrap rounded-md px-1 text-[13px] transition-colors hover:text-white', current ? 'text-white' : 'text-white/62')}
                        >
                            {tab.label}
                            {current && (
                                // 五个页签共用一根下划线，framer 把它挪到新选中的那个
                                <motion.span
                                    layoutId="ye-lyst-tab-line"
                                    layoutDependency={active}
                                    transition={{ duration: 0.2 }}
                                    className="absolute inset-x-1 bottom-0 h-0.5 rounded-t-[2px] bg-[var(--st-accent)]"
                                />
                            )}
                        </button>
                    );
                })}
            </div>
            {action !== undefined && <div className="flex h-9 shrink-0 items-center self-end pl-3">{action}</div>}
        </div>
    );
}
