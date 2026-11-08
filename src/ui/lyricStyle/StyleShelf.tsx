/**
 * 预览框下面的样式架：「样式 10」标题 + 缩略图网格（桌面 7 列、窄窗口 4 列）。
 * 缩略图是 scripts/capture-lyric-thumbs.mjs 生成的静态 webp；
 * 还没生成到时退回深色块 + 样式名。
 */
import { setSetting, useSettings, type LyricStyle } from '@/store/settings';
import { useUi } from '@/store/ui';
import { cx } from '../components/common';
import { css, type Theme } from '../theme';
import { FOLIA_MODES } from '../player/folia/modes';

const STYLES: { id: LyricStyle; name: string; en: string }[] = [
    { id: 'luminous', name: '光晕', en: 'Luminous' },
    { id: 'flow', name: '滚动', en: 'Flow' },
    ...FOLIA_MODES.map(m => ({ id: m.id as LyricStyle, name: m.name, en: m.en })),
];

// 缩略图存在与否取决于生成脚本跑没跑过，用 glob 找，缺图不报错
const THUMBS = import.meta.glob('./thumbs/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function StyleShelf({ theme }: { theme: Theme }) {
    const selected = useSettings(s => s.lyricStyle);
    return (
        <div className="shrink-0">
            <div className="mb-2 flex items-baseline gap-1.5 px-1">
                <h3 className="text-[13px] font-semibold leading-5 text-white/62">样式</h3>
                <span className="text-[13px] text-white/42">{STYLES.length}</span>
            </div>
            <div className="scroll-thin grid max-h-[250px] grid-cols-4 gap-2 overflow-y-auto pr-1 lg:grid-cols-7">
                {STYLES.map(style => {
                    const active = style.id === selected;
                    const thumb = THUMBS[`./thumbs/${style.id}.webp`];
                    return (
                        <button
                            key={style.id}
                            type="button"
                            title={`${style.name} · ${style.en}`}
                            onClick={() => {
                                setSetting('lyricStyle', style.id);
                                // 点了样式就把右栏切到动画参数，和 Folia 的选择行为一致
                                useUi.setState({ lyricStyle: 'style' });
                            }}
                            className="group min-w-0 text-left"
                        >
                            <span
                                className={cx(
                                    'block aspect-video w-full overflow-hidden rounded-lg ring-1 transition-[box-shadow,color]',
                                    active ? 'ring-transparent' : 'ring-white/[0.08] group-hover:ring-white/[0.16]',
                                )}
                                style={active ? { boxShadow: `0 0 0 2px ${css(theme.accent)}` } : undefined}
                            >
                                {thumb ? (
                                    <img src={thumb} alt={style.name} className="h-full w-full object-cover" draggable={false} />
                                ) : (
                                    <span className="grid h-full w-full place-items-center bg-[#151517] text-[11px] text-white/42">{style.en}</span>
                                )}
                            </span>
                            <span className={cx('mt-1 block truncate text-center text-[12px] leading-4 transition-colors', active ? 'text-white' : 'text-white/62 group-hover:text-white/80')}>
                                {style.name}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
