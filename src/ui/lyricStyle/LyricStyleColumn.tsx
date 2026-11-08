/**
 * 歌词样式窗口右栏：五个页签（歌词动画 / 背景 / 字体 / 字幕 / 全局）+ 右上角「默认」按页签恢复。
 * 所有控件直接绑全局设置，预览与播放页即时联动；Folia 动画的参数复用 FoliaSettings 面板。
 */
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { usePlayer } from '@/store/player';
import { DEFAULT_SETTINGS, setSetting, useSettings, type BackgroundMode, type LyricIntensity, type LiteMode, type Settings, type ThemeMode } from '@/store/settings';
import { useFoliaTunings, type FoliaTuningMode } from '@/store/foliaTunings';
import { useUi, type LyricStyleTab } from '@/store/ui';
import { useLite } from '@/lib/lite';
import { useCover } from '../hooks';
import { Segmented, Spinner, cx } from '../components/common';
import { css, type Theme } from '../theme';
import { LyricSourceButtons, useLyricFromText } from '../player/LyricSourceControls';
import { isFoliaMode, type FoliaModeId } from '../player/folia/modes';
import { KitGroup, KitRow, KitSliderRow, KitTabs, KitToggle } from './kit';

// Folia 动画的细调面板按需加载（与播放页同一分包）
const FoliaSettings = lazy(() => import('../player/folia/FoliaSettings'));

const TABS: { id: LyricStyleTab; label: string }[] = [
    { id: 'style', label: '歌词动画' },
    { id: 'background', label: '背景' },
    { id: 'font', label: '字体' },
    { id: 'subtitle', label: '字幕' },
    { id: 'global', label: '全局' },
];

/** 每个页签「默认」恢复的设置键（Folia 动画的细调参数在 style 页签里单独处理） */
const TAB_KEYS: Record<LyricStyleTab, (keyof Settings)[]> = {
    style: ['lyricIntensity'],
    background: ['background', 'dither', 'reactive', 'theme'],
    font: ['lyricFont', 'lyricScale'],
    subtitle: ['showTranslation', 'showRoma', 'lyricOffset'],
    global: ['reduceMotion', 'liteMode'],
};

const INTENSITY: { value: LyricIntensity; label: string }[] = [
    { value: 'calm', label: '平静' },
    { value: 'normal', label: '标准' },
    { value: 'chaotic', label: '狂野' },
];

/** 背景缩略块：三种模式各自画一小块实景（流体渐变 / 模糊封面 / 纯色） */
function BgTile({ mode, theme, cover, active, onClick }: { mode: BackgroundMode; theme: Theme; cover?: string; active: boolean; onClick: () => void }) {
    const NAMES: Record<BackgroundMode, string> = { latent: 'Latent 流体', blur: 'Blur 模糊封面', solid: 'Solid 纯色' };
    return (
        <button type="button" onClick={onClick} className="group min-w-0 text-left">
            <span
                className={cx('relative block aspect-video w-full overflow-hidden rounded-lg ring-1 transition-[box-shadow]', active ? 'ring-transparent' : 'ring-white/[0.08] group-hover:ring-white/[0.16]')}
                style={active ? { boxShadow: `0 0 0 2px ${css(theme.accent)}` } : undefined}
            >
                {mode === 'latent' && (
                    <span className="absolute inset-0" style={{ background: `linear-gradient(130deg, ${css(theme.fluid[0])}, ${css(theme.fluid[2])} 55%, ${css(theme.fluid[3])})` }} />
                )}
                {mode === 'blur' && (
                    <span className="absolute inset-0 bg-black">
                        {cover
                            ? <img src={cover} alt="" className="h-full w-full scale-150 object-cover opacity-80 blur-md saturate-150" draggable={false} />
                            : <span className="absolute inset-0" style={{ background: `linear-gradient(130deg, ${css(theme.fluid[1])}, ${css(theme.fluid[2])})` }} />}
                        <span className="absolute inset-0 bg-black/25" />
                    </span>
                )}
                {mode === 'solid' && <span className="absolute inset-0" style={{ background: css(theme.base) }} />}
            </span>
            <span className={cx('mt-1 block truncate text-center text-[12px] leading-4 transition-colors', active ? 'text-white' : 'text-white/62 group-hover:text-white/80')}>{NAMES[mode]}</span>
        </button>
    );
}

function StyleTab({ theme }: { theme: Theme }) {
    const s = useSettings();
    const foliaTunable = isFoliaMode(s.lyricStyle) && s.lyricStyle !== 'still';
    return (
        <>
            <KitGroup title="动效强度">
                <KitRow label="强度" hint="逐字动画与背景的活跃程度，作用于所有歌词样式">
                    <Segmented size="sm" value={s.lyricIntensity} onChange={v => setSetting('lyricIntensity', v)} options={INTENSITY} />
                </KitRow>
            </KitGroup>
            <div className="mb-2 mt-7 px-1">
                <h3 className="text-[13px] font-semibold leading-5 text-white/62">动画参数</h3>
            </div>
            {foliaTunable ? (
                <div className="ye-lyst-folia-panel">
                    <Suspense fallback={<div className="grid place-items-center py-8"><Spinner className="h-4 w-4" /></div>}>
                        <FoliaSettings mode={s.lyricStyle as FoliaModeId} theme={theme} hideReset controlCardBg="#232327" rangeInputClass="ye-lyst-range" />
                    </Suspense>
                </div>
            ) : (
                <div className="rounded-xl bg-[#232327] px-4 py-5 text-[13px] text-white/42 shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">此动画没有专属参数</div>
            )}
        </>
    );
}

function BackgroundTab({ theme }: { theme: Theme }) {
    const s = useSettings();
    const current = usePlayer(p => p.current);
    const coverRaw = usePlayer(p => p.coverUrl);
    const cover = useCover(coverRaw || current?.cover);
    return (
        <>
            <KitGroup title="背景">
                <KitRow
                    label="背景"
                    below={
                        <div className="grid grid-cols-3 gap-2">
                            {(['latent', 'blur', 'solid'] as BackgroundMode[]).map(mode => (
                                <BgTile key={mode} mode={mode} theme={theme} cover={cover} active={s.background === mode} onClick={() => setSetting('background', mode)} />
                            ))}
                        </div>
                    }
                />
                <KitToggle label="半色调网点" hint="在背景上叠一层报纸印刷感的网点" checked={s.dither} onChange={v => setSetting('dither', v)} />
                <KitToggle label="随音乐律动" hint="流体背景随低频能量起伏" checked={s.reactive} onChange={v => setSetting('reactive', v)} />
            </KitGroup>
            <KitGroup title="配色">
                <KitRow label="配色" hint="封面取色在每次换歌时从封面提取主色">
                    <Segmented
                        size="sm"
                        value={s.theme}
                        onChange={v => setSetting('theme', v)}
                        options={([['default', '默认'], ['cover', '封面取色'], ['custom', '自定义']] as [ThemeMode, string][]).map(([value, label]) => ({ value, label }))}
                    />
                </KitRow>
                {s.theme === 'custom' && (
                    <KitRow label="自定义主色">
                        <input type="color" value={s.customAccent} onChange={e => setSetting('customAccent', e.target.value)} className="h-7 w-12 cursor-pointer rounded-md border-0 bg-transparent" aria-label="自定义主色" />
                    </KitRow>
                )}
            </KitGroup>
        </>
    );
}

function FontTab() {
    const s = useSettings();
    const FONTS: { value: 'sans' | 'serif'; label: string; family: string }[] = [
        { value: 'sans', label: '黑体', family: 'var(--font-sans)' },
        { value: 'serif', label: '宋体', family: 'var(--font-serif)' },
    ];
    return (
        <KitGroup title="字体">
            <KitRow
                label="歌词字体"
                below={
                    <div className="grid grid-cols-2 gap-2">
                        {FONTS.map(font => (
                            <button key={font.value} type="button" onClick={() => setSetting('lyricFont', font.value)} className="group min-w-0 text-left">
                                <span
                                    className={cx('grid h-20 w-full place-items-center rounded-lg bg-white/[0.05] text-[26px] ring-1 transition-[box-shadow]', s.lyricFont === font.value ? 'ring-transparent' : 'ring-white/[0.08] group-hover:ring-white/[0.16]')}
                                    style={{ fontFamily: font.family, ...(s.lyricFont === font.value ? { boxShadow: `0 0 0 2px var(--st-accent)` } : {}) }}
                                >
                                    永 <span className="text-[20px]">Aa</span>
                                </span>
                                <span className={cx('mt-1 block text-center text-[12px] leading-4 transition-colors', s.lyricFont === font.value ? 'text-white' : 'text-white/62 group-hover:text-white/80')}>{font.label}</span>
                            </button>
                        ))}
                    </div>
                }
            />
            <KitSliderRow label="字号" value={s.lyricScale * 100} min={60} max={160} step={5} marks={[100]} format={v => `${Math.round(v)}%`} onChange={v => setSetting('lyricScale', v / 100)} />
        </KitGroup>
    );
}

function SubtitleTab() {
    const s = useSettings();
    const lyric = usePlayer(p => p.lyric);
    const fromText = useLyricFromText();
    const noTrans = Boolean(lyric && !lyric.hasTrans);
    const noRoma = Boolean(lyric && !lyric.hasRoma);
    const step = (dir: number) => setSetting('lyricOffset', Math.max(-3000, Math.min(3000, s.lyricOffset + dir * 250)));
    return (
        <>
            <KitGroup title="字幕">
                <KitToggle label="显示翻译" hint={noTrans ? '本曲没有翻译' : undefined} checked={s.showTranslation} disabled={noTrans} onChange={v => setSetting('showTranslation', v)} />
                <KitToggle label="显示罗马音" hint={noRoma ? '本曲没有罗马音' : undefined} checked={s.showRoma} disabled={noRoma} onChange={v => setSetting('showRoma', v)} />
                <KitRow label="歌词偏移" hint="正值让歌词更晚出现">
                    <button type="button" onClick={() => step(-1)} className="grid h-7 w-7 place-items-center rounded-md bg-white/[0.07] hover:bg-white/[0.12]" title="提前 0.25 秒" aria-label="提前 0.25 秒"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-16 text-center font-mono text-[12px] text-white/80">{s.lyricOffset > 0 ? '+' : ''}{(s.lyricOffset / 1000).toFixed(2)}s</span>
                    <button type="button" onClick={() => step(1)} className="grid h-7 w-7 place-items-center rounded-md bg-white/[0.07] hover:bg-white/[0.12]" title="延后 0.25 秒" aria-label="延后 0.25 秒"><Plus className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setSetting('lyricOffset', 0)} className="grid h-7 w-7 place-items-center rounded-md text-white/42 hover:bg-white/[0.07] hover:text-white" title="重置偏移" aria-label="重置偏移"><RotateCcw className="h-3.5 w-3.5" /></button>
                </KitRow>
            </KitGroup>
            <KitGroup title="歌词来源">
                <KitRow label="来源" hint={fromText}>
                    <LyricSourceButtons className="flex h-7 items-center gap-1.5 rounded-md bg-white/[0.07] px-2.5 text-[12px] text-white/80 hover:bg-white/[0.12] hover:text-white" iconClass="h-3.5 w-3.5" />
                </KitRow>
            </KitGroup>
        </>
    );
}

function GlobalTab() {
    const s = useSettings();
    const lite = useLite();
    return (
        <KitGroup title="全局">
            <KitToggle label="减少动效" hint="关闭逐字动画与背景流动，只保留淡入淡出" checked={s.reduceMotion} onChange={v => setSetting('reduceMotion', v)} />
            <KitRow label="精简模式" hint={lite ? '正在精简渲染：毛玻璃与高帧率背景已关闭' : '关闭毛玻璃与高帧率背景；自动档在 Android / 旧版 WebView 上自行开启'}>
                <Segmented
                    size="sm"
                    value={s.liteMode}
                    onChange={v => setSetting('liteMode', v)}
                    options={([['auto', '自动'], ['on', '开'], ['off', '关']] as [LiteMode, string][]).map(([value, label]) => ({ value, label }))}
                />
            </KitRow>
        </KitGroup>
    );
}

export function LyricStyleColumn({ theme }: { theme: Theme }) {
    const tab = useUi(s => s.lyricStyle) ?? 'style';
    const s = useSettings();
    const style = s.lyricStyle;
    const foliaTunable = isFoliaMode(style) && style !== 'still';

    // 「默认」只重置当前页签管辖的设置；style 页签附带还原选中动画的细调参数
    const dirty = TAB_KEYS[tab].some(k => s[k] !== DEFAULT_SETTINGS[k]);
    const resetEnabled = dirty || (tab === 'style' && foliaTunable);
    const reset = () => {
        const patch: Partial<Settings> = {};
        for (const k of TAB_KEYS[tab]) (patch as Record<string, unknown>)[k] = DEFAULT_SETTINGS[k];
        useSettings.setState(patch);
        if (tab === 'style' && foliaTunable) useFoliaTunings.getState().reset(style as FoliaTuningMode);
    };

    const content: Record<LyricStyleTab, ReactNode> = useMemo(() => ({
        style: <StyleTab theme={theme} />,
        background: <BackgroundTab theme={theme} />,
        font: <FontTab />,
        subtitle: <SubtitleTab />,
        global: <GlobalTab />,
    }), [theme]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <KitTabs
                tabs={TABS}
                active={tab}
                onSelect={id => useUi.setState({ lyricStyle: id as LyricStyleTab })}
                action={
                    <button
                        type="button"
                        onClick={reset}
                        disabled={!resetEnabled}
                        className={cx('h-7 rounded-md px-2.5 text-[12.5px] transition-colors', resetEnabled ? 'text-white/62 hover:bg-white/[0.07] hover:text-white' : 'cursor-not-allowed text-white/25')}
                    >
                        默认
                    </button>
                }
            />
            <div role="tabpanel" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-6">
                {content[tab]}
            </div>
        </div>
    );
}
