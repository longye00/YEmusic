/** 播放页右下角浮动面板：歌曲 / 歌词 / 控制 / 队列 / 音源 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, AudioLines, ChevronDown, ChevronLeft, ChevronRight, Copy, Disc3, Download, FileText, FileUp, Heart, Info, ListMusic, ListPlus, Minus, Moon, Plus, Radio, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Trash2, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import { host } from '@/lib/host';
import { formatTime } from '@/lib/util';
import { PLATFORM_NAMES, QUALITY_NAMES, QUALITY_ORDER, type Quality } from '@/sdk/types';
import { downloadTrack } from '@/store/downloads';
import { toggleFavorite } from '@/store/library';
import { clearQueue, cycleMode, MODE_NAMES, playTrack, reloadLyric, removeFromQueue, setLyric, switchPlayback, usePlayer } from '@/store/player';
import { setSetting, useSettings, type BackgroundMode, type LyricIntensity, type LyricStyle } from '@/store/settings';
import { useSources } from '@/store/sources';
import { toast } from '@/store/toast';
import { ui, useUi, type PanelTab } from '@/store/ui';
import { saveCustomLyric } from '@/player/lyrics';
import { useLite } from '@/lib/lite';
import { useCompact, useIsFavorite } from '../hooks';
import { Cover, PlatformTag, Segmented, Slider, Spinner, Switch, cx } from '../components/common';
import { css, type Theme } from '../theme';
import { MODE_ICONS } from './ControlPill';
import { FOLIA_MODES, FOLIA_MODE_NAMES, isFoliaMode, type FoliaModeId } from './folia/modes';

// Folia 动画的细调面板（含各动画的参数 UI），展开时才加载
const FoliaSettings = lazy(() => import('./folia/FoliaSettings'));

const TABS: { id: PanelTab; icon: typeof Disc3; label: string }[] = [
    { id: 'cover', icon: Disc3, label: '歌曲' },
    { id: 'lyrics', icon: FileText, label: '歌词' },
    { id: 'controls', icon: SlidersHorizontal, label: '控制' },
    { id: 'queue', icon: ListMusic, label: '队列' },
    { id: 'source', icon: Radio, label: '音源' },
];

const STYLE_NAMES: Record<LyricStyle, string> = { luminous: 'Luminous', flow: 'Flow', ...FOLIA_MODE_NAMES };
const ALL_STYLES: LyricStyle[] = ['luminous', 'flow', ...FOLIA_MODES.map(m => m.id)];
const INTENSITY_NAMES: Record<LyricIntensity, string> = { calm: '平静', normal: '标准', chaotic: '狂野' };
const BG_NAMES: Record<BackgroundMode, string> = { latent: 'Latent 流体', blur: 'Blur 模糊封面', solid: 'Solid 纯色' };

function cycle<T>(list: T[], value: T, dir: number): T {
    return list[(list.indexOf(value) + dir + list.length) % list.length];
}

function Tile({ active, onClick, children, label, text }: { active?: boolean; onClick: () => void; children: ReactNode; label: string; text?: string }) {
    return (
        <button type="button" title={label} aria-label={label} onClick={onClick} className={cx('flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl px-2 text-[12.5px] font-semibold transition-colors', active ? 'bg-white/[0.22] text-white' : 'bg-white/[0.09] text-white/80 hover:bg-white/[0.15] hover:text-white')}>
            {children}
            {text && <span className="truncate">{text}</span>}
        </button>
    );
}

function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <div className={cx('flex items-center gap-2 rounded-2xl bg-black/15 px-3 py-2', className)}>{children}</div>;
}

function Stepper({ label, icon, value, onPrev, onNext, extra }: { label?: string; icon?: ReactNode; value: ReactNode; onPrev: () => void; onNext: () => void; extra?: ReactNode }) {
    return (
        <div className="flex items-center gap-1">
            <button type="button" onClick={onPrev} className="grid h-8 w-6 place-items-center rounded-lg text-white/45 hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-white/[0.08] px-3">
                {icon && <span className="text-white/45 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
                {label && <span className="text-[11px] text-white/40">{label}</span>}
                <span className="truncate text-[13px] font-semibold">{value}</span>
            </div>
            {extra}
            <button type="button" onClick={onNext} className="grid h-8 w-6 place-items-center rounded-lg text-white/45 hover:text-white"><ChevronRight className="h-4 w-4" /></button>
        </div>
    );
}

function SongTab() {
    const current = usePlayer(s => s.current);
    const resolved = usePlayer(s => s.resolved);
    const liked = useIsFavorite(current?.id);
    if (!current) return <div className="py-6 text-center text-[13px] text-white/40">没有正在播放的歌曲</div>;
    return (
        <div className="space-y-3">
            <div>
                <div className="text-[18px] font-bold leading-snug">{current.name}</div>
                <button type="button" onClick={() => ui.openSearch(current.singer)} className="mt-1 text-left text-[13px] text-white/60 hover:text-white hover:underline">{current.singer}</button>
                {current.album && <div className="mt-0.5 truncate text-[12px] text-white/40">{current.album}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <PlatformTag source={current.source} />
                {resolved?.quality && <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/75">{QUALITY_NAMES[resolved.quality]}</span>}
                {resolved?.sourceName && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/65">{resolved.sourceName}</span>}
                {resolved?.via && <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[10px] text-amber-200">已换源：{PLATFORM_NAMES[resolved.via.source]}</span>}
                {current.source === 'local' && current.codec && <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/65">{current.codec}{current.bitrate ? ` · ${current.bitrate}k` : ''}</span>}
            </div>
            <div className="flex gap-2">
                <Tile label={liked ? '取消喜欢' : '喜欢'} active={liked} onClick={() => toggleFavorite(current)}><Heart className={cx('h-[18px] w-[18px]', liked && 'text-rose-400')} fill={liked ? 'currentColor' : 'none'} /></Tile>
                {current.source !== 'local' && <Tile label="下载" onClick={() => downloadTrack(current)}><Download className="h-[18px] w-[18px]" /></Tile>}
                <Tile label="添加到歌单" onClick={() => ui.dialog({ type: 'addToPlaylist', tracks: [current] })}><ListPlus className="h-[18px] w-[18px]" /></Tile>
                <Tile label="复制歌名" onClick={() => { void navigator.clipboard.writeText(`${current.name} - ${current.singer}`); toast('已复制', 'success'); }}><Copy className="h-[18px] w-[18px]" /></Tile>
                <Tile label="歌曲信息" onClick={() => ui.dialog({ type: 'trackInfo', track: current })}><Info className="h-[18px] w-[18px]" /></Tile>
            </div>
        </div>
    );
}

function StyleTile({ active, name, sub, onClick }: { active: boolean; name: string; sub: string; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className={cx('flex h-11 min-w-0 flex-col items-start justify-center rounded-xl px-3 text-left transition-colors', active ? 'bg-white/[0.22] text-white' : 'bg-white/[0.08] text-white/75 hover:bg-white/[0.14] hover:text-white')}>
            <span className="max-w-full truncate text-[12.5px] font-semibold leading-tight">{name}</span>
            <span className={cx('max-w-full truncate text-[10px] leading-tight', active ? 'text-white/60' : 'text-white/35')}>{sub}</span>
        </button>
    );
}

/** 歌词动画选择：10 种放在同一个网格里 */
function StylePicker({ value, onChange }: { value: LyricStyle; onChange: (value: LyricStyle) => void }) {
    return (
        <div className="grid grid-cols-2 gap-1.5">
            <StyleTile active={value === 'luminous'} name="光晕" sub="Luminous" onClick={() => onChange('luminous')} />
            <StyleTile active={value === 'flow'} name="滚动" sub="Flow" onClick={() => onChange('flow')} />
            {FOLIA_MODES.map(mode => <StyleTile key={mode.id} active={value === mode.id} name={mode.name} sub={mode.en} onClick={() => onChange(mode.id)} />)}
        </div>
    );
}

/** 当前 Folia 动画的专属参数（可折叠） */
function FoliaTuning({ mode, theme }: { mode: FoliaModeId; theme: Theme }) {
    const [open, setOpen] = useState(false);
    const info = FOLIA_MODES.find(m => m.id === mode)!;
    return (
        <div className="rounded-2xl bg-black/15">
            <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                <Sparkles className="h-3.5 w-3.5 text-white/50" />
                <span className="flex-1 text-[12px] text-white/80">{info.name} · 动画参数</span>
                <ChevronDown className={cx('h-4 w-4 text-white/40 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="px-3 pb-3">
                    <div className="mb-2 text-[11px] leading-relaxed text-white/40">{info.desc}。</div>
                    <Suspense fallback={<div className="grid place-items-center py-4"><Spinner className="h-4 w-4" /></div>}>
                        <FoliaSettings mode={mode} theme={theme} />
                    </Suspense>
                </div>
            )}
        </div>
    );
}

function LyricsTab({ theme }: { theme: Theme }) {
    const s = useSettings();
    const lyricState = usePlayer(p => p.lyricState);
    const lyricFrom = usePlayer(p => p.lyricFrom);
    const lyric = usePlayer(p => p.lyric);
    const current = usePlayer(p => p.current);
    const fileRef = useRef<HTMLInputElement>(null);
    const FROM: Record<string, string> = { platform: '平台接口', source: '洛雪音源', match: '其他平台匹配', lrclib: 'LRCLIB', embedded: '内嵌歌词', sidecar: '同名 .lrc 文件', custom: '手动导入', none: '无' };
    return (
        <div className="space-y-3">
            <StylePicker value={s.lyricStyle} onChange={v => setSetting('lyricStyle', v)} />
            {isFoliaMode(s.lyricStyle) && s.lyricStyle !== 'still' && <FoliaTuning mode={s.lyricStyle} theme={theme} />}
            <Segmented size="sm" className="w-full [&>button]:flex-1" value={s.lyricIntensity} onChange={v => setSetting('lyricIntensity', v)} options={(['calm', 'normal', 'chaotic'] as LyricIntensity[]).map(v => ({ value: v, label: INTENSITY_NAMES[v] }))} />
            <Segmented size="sm" className="w-full [&>button]:flex-1" value={s.lyricFont} onChange={v => setSetting('lyricFont', v)} options={[{ value: 'sans', label: '黑体' }, { value: 'serif', label: '宋体' }]} />
            <Row>
                <span className="w-12 text-[12px] text-white/50">字号</span>
                <Slider value={s.lyricScale} min={0.6} max={1.6} step={0.05} onChange={v => setSetting('lyricScale', v)} className="flex-1" />
                <span className="w-10 text-right font-mono text-[11px] text-white/60">{Math.round(s.lyricScale * 100)}%</span>
            </Row>
            <Row>
                <span className="flex-1 text-[12px] text-white/70">显示翻译{lyric && !lyric.hasTrans ? '（本曲无）' : ''}</span>
                <Switch checked={s.showTranslation} onChange={v => setSetting('showTranslation', v)} />
            </Row>
            <Row>
                <span className="flex-1 text-[12px] text-white/70">显示罗马音{lyric && !lyric.hasRoma ? '（本曲无）' : ''}</span>
                <Switch checked={s.showRoma} onChange={v => setSetting('showRoma', v)} />
            </Row>
            <Row>
                <span className="flex-1 text-[12px] text-white/70">歌词偏移</span>
                <button type="button" onClick={() => setSetting('lyricOffset', s.lyricOffset - 250)} className="grid h-7 w-7 place-items-center rounded-full bg-white/10 hover:bg-white/20" title="提前 0.25 秒"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-16 text-center font-mono text-[11px]">{s.lyricOffset > 0 ? '+' : ''}{(s.lyricOffset / 1000).toFixed(2)}s</span>
                <button type="button" onClick={() => setSetting('lyricOffset', s.lyricOffset + 250)} className="grid h-7 w-7 place-items-center rounded-full bg-white/10 hover:bg-white/20" title="延后 0.25 秒"><Plus className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => setSetting('lyricOffset', 0)} className="grid h-7 w-7 place-items-center rounded-full text-white/50 hover:text-white" title="重置"><RotateCcw className="h-3.5 w-3.5" /></button>
            </Row>
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => reloadLyric()} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.09] text-[12px] hover:bg-white/[0.15]">{lyricState === 'loading' ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}重新获取</button>
                <button type="button" onClick={() => fileRef.current?.click()} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.09] text-[12px] hover:bg-white/[0.15]"><FileUp className="h-3.5 w-3.5" />导入 .lrc</button>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".lrc,.txt"
                    className="hidden"
                    onChange={async event => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file || !current) return;
                        const buffer = new Uint8Array(await file.arrayBuffer());
                        let text: string;
                        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('gbk').decode(buffer); }
                        setLyric(await saveCustomLyric(current, text), 'custom');
                        toast('已导入歌词', 'success');
                    }}
                />
            </div>
            <div className="text-center font-mono text-[10.5px] text-white/35">歌词来源：{lyricState === 'loading' ? '获取中…' : FROM[lyricFrom] || lyricFrom || '无'}</div>
        </div>
    );
}

function ControlsTab({ theme }: { theme: Theme }) {
    const s = useSettings();
    const current = usePlayer(p => p.current);
    const liked = useIsFavorite(current?.id);
    const ModeIcon = MODE_ICONS[s.playMode];
    const VolumeIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 0.5 ? Volume1 : Volume2;
    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <Tile label="切换播放模式" text={MODE_NAMES[s.playMode]} active={s.playMode !== 'order'} onClick={() => toast(MODE_NAMES[cycleMode()], 'info', { duration: 1200 })}><ModeIcon className="h-[18px] w-[18px] shrink-0" /></Tile>
                <Tile label={liked ? '取消喜欢' : '喜欢'} text={liked ? '已喜欢' : '喜欢'} active={liked} onClick={() => current && toggleFavorite(current)}><Heart className={cx('h-[18px] w-[18px] shrink-0', liked && 'text-rose-400')} fill={liked ? 'currentColor' : 'none'} /></Tile>
            </div>
            <div className="h-px bg-white/[0.08]" />
            <Row className="bg-black/20">
                <button type="button" onClick={() => setSetting('muted', !s.muted)} className="text-white/60 hover:text-white" title={s.muted ? '取消静音' : '静音'}><VolumeIcon className="h-4 w-4" /></button>
                <Slider value={s.muted ? 0 : s.volume} onChange={v => { setSetting('volume', v); if (s.muted) setSetting('muted', false); }} className="flex-1" thumb />
                <span className="w-9 text-right font-mono text-[11px] font-semibold">{Math.round((s.muted ? 0 : s.volume) * 100)}%</span>
                <button type="button" title="均衡器" onClick={() => ui.openSettings('playback')} className={cx('hover:text-white', s.eqEnabled ? 'text-white' : 'text-white/50')}><AudioLines className="h-4 w-4" /></button>
            </Row>
            <Stepper
                icon={<FileText />}
                value={STYLE_NAMES[s.lyricStyle]}
                onPrev={() => setSetting('lyricStyle', cycle<LyricStyle>(ALL_STYLES, s.lyricStyle, -1))}
                onNext={() => setSetting('lyricStyle', cycle<LyricStyle>(ALL_STYLES, s.lyricStyle, 1))}
                extra={
                    <button type="button" onClick={() => setSetting('lyricIntensity', cycle<LyricIntensity>(['calm', 'normal', 'chaotic'], s.lyricIntensity, 1))} className="h-7 shrink-0 rounded-lg bg-white/[0.18] px-2 text-[11px] font-semibold hover:bg-white/25" title="动效强度">
                        {INTENSITY_NAMES[s.lyricIntensity]}
                    </button>
                }
            />
            <Stepper
                icon={<AudioLines />}
                value={BG_NAMES[s.background]}
                onPrev={() => setSetting('background', cycle<BackgroundMode>(['latent', 'blur', 'solid'], s.background, -1))}
                onNext={() => setSetting('background', cycle<BackgroundMode>(['latent', 'blur', 'solid'], s.background, 1))}
                extra={
                    <button type="button" onClick={() => setSetting('dither', !s.dither)} className={cx('h-7 shrink-0 rounded-lg px-2 text-[11px] font-semibold', s.dither ? 'bg-white/[0.18]' : 'bg-white/[0.06] text-white/45')} title="半色调网点">
                        网点
                    </button>
                }
            />
            <div className="flex items-center gap-1 rounded-2xl bg-black/20 p-1">
                {([['default', '默认', '#05050a'], ['cover', '封面取色', css(theme.accent)], ['custom', '自定义', s.customAccent]] as const).map(([value, label, dot]) => (
                    <button key={value} type="button" onClick={() => setSetting('theme', value)} className={cx('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl text-[11.5px] transition-colors', s.theme === value ? 'bg-white/[0.2] font-semibold text-white' : 'text-white/50 hover:text-white/80')}>
                        <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/30" style={{ background: dot }} />
                        {label}
                    </button>
                ))}
            </div>
            {s.theme === 'custom' && (
                <Row>
                    <span className="flex-1 text-[12px] text-white/60">自定义主色</span>
                    <input type="color" value={s.customAccent} onChange={e => setSetting('customAccent', e.target.value)} className="h-7 w-12 cursor-pointer rounded-md border-0 bg-transparent" />
                </Row>
            )}
            <div className="h-px bg-white/[0.08]" />
            <div className="flex items-center gap-2 px-1 text-[13px] font-semibold"><Moon className="h-4 w-4" style={{ color: css(theme.accent) }} />{theme.name}</div>
        </div>
    );
}

function QueueTab() {
    const queue = usePlayer(s => s.queue);
    const index = usePlayer(s => s.index);
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = listRef.current?.children[index] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'center' });
    }, [index]);
    if (!queue.length) return <div className="py-8 text-center text-[13px] text-white/40">播放队列为空</div>;
    return (
        <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-mono text-[11px] text-white/45">{index + 1} / {queue.length}</span>
                <button type="button" onClick={() => ui.confirm('清空播放队列', '确定清空当前播放队列吗？', clearQueue, { danger: true, confirmText: '清空' })} className="flex items-center gap-1 text-[11px] text-white/45 hover:text-white"><Trash2 className="h-3.5 w-3.5" />清空</button>
            </div>
            <div ref={listRef} className="scroll-thin max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {queue.map((track, i) => (
                    <div key={`${track.id}-${i}`} className={cx('group flex items-center gap-2.5 rounded-xl px-2 py-1.5', i === index ? 'bg-white/[0.14]' : 'hover:bg-white/[0.07]')}>
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => playTrack(track)}>
                            <Cover src={track.cover} size={36} seed={track.name} className="h-9 w-9 shrink-0" rounded="rounded-lg" />
                            <div className="min-w-0 flex-1">
                                <div className={cx('truncate text-[12.5px] font-semibold', i === index ? 'text-white' : 'text-white/85')}>{track.name}</div>
                                <div className="truncate text-[11px] text-white/40">{track.singer}</div>
                            </div>
                        </button>
                        <span className="font-mono text-[10px] text-white/35 group-hover:hidden">{formatTime(track.duration)}</span>
                        <button type="button" title="移出队列" onClick={() => removeFromQueue(i)} className="hidden h-6 w-6 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white group-hover:grid"><X className="h-3.5 w-3.5" /></button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SourceTab() {
    const current = usePlayer(s => s.current);
    const resolved = usePlayer(s => s.resolved);
    const status = usePlayer(s => s.status);
    const error = usePlayer(s => s.error);
    const details = usePlayer(s => s.errorDetails);
    const records = useSources(s => s.records);
    const runtime = useSources(s => s.runtime);
    if (!current) return <div className="py-6 text-center text-[13px] text-white/40">没有正在播放的歌曲</div>;
    if (current.source === 'local') return <div className="py-6 text-center text-[13px] leading-relaxed text-white/45">本地文件直接播放<br /><span className="break-all font-mono text-[10.5px] text-white/30">{current.path}</span></div>;
    const available = new Set((current.qualities || []).map(q => q.type));
    const qualities = QUALITY_ORDER.filter(q => !available.size || available.has(q)).reverse();
    const platform = current.source;
    return (
        <div className="space-y-3">
            {status === 'error' && error && (
                <div className="rounded-2xl border border-red-300/20 bg-red-500/10 p-3 text-[12px] text-red-100">
                    <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{error}</div>
                    {details.length > 0 && <ul className="scroll-thin mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[10.5px] text-red-100/70">{details.map((d, i) => <li key={i}>· {d}</li>)}</ul>}
                </div>
            )}
            <div>
                <div className="mb-1.5 px-1 text-[11px] text-white/45">音质（当前：{resolved?.quality ? QUALITY_NAMES[resolved.quality] : '—'}）</div>
                <div className="grid grid-cols-2 gap-1.5">
                    {qualities.map(q => {
                        const size = current.qualities?.find(x => x.type === q)?.size;
                        return (
                            <button key={q} type="button" onClick={() => switchPlayback({ quality: q as Quality })} className={cx('flex h-10 flex-col items-center justify-center rounded-xl text-[12px] transition-colors', resolved?.quality === q ? 'bg-white text-black' : 'bg-white/[0.08] hover:bg-white/[0.15]')}>
                                <span className="font-semibold leading-tight">{QUALITY_NAMES[q]}</span>
                                {size && <span className={cx('font-mono text-[9.5px] leading-tight', resolved?.quality === q ? 'text-black/55' : 'text-white/40')}>{size}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>
            <div>
                <div className="mb-1.5 px-1 text-[11px] text-white/45">{PLATFORM_NAMES[platform as keyof typeof PLATFORM_NAMES]} 可用音源</div>
                <div className="space-y-1">
                    {records.filter(r => r.enabled).map(r => {
                        const rt = runtime[r.id];
                        const supports = rt?.sources?.[platform as 'kw'];
                        const usable = rt?.status === 'ready' && supports?.actions.includes('musicUrl');
                        const fails = rt?.platformFailures?.[platform] || 0;
                        return (
                            <button key={r.id} type="button" disabled={!usable} onClick={() => switchPlayback({ onlySource: r.id })} className={cx('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-40', resolved?.sourceId === r.id ? 'bg-white/[0.16]' : 'hover:bg-white/[0.08]')}>
                                <span className={cx('h-2 w-2 shrink-0 rounded-full', rt?.status === 'ready' ? (fails >= 2 ? 'bg-amber-300' : 'bg-emerald-400') : rt?.status === 'loading' ? 'bg-sky-300' : 'bg-red-400')} />
                                <span className="min-w-0 flex-1 truncate text-[12.5px]">{r.name}</span>
                                <span className="font-mono text-[10px] text-white/40">{usable ? (supports?.qualitys || []).map(q => q.replace('flac24bit', 'HR').replace('flac', 'SQ')).join('/') : rt?.status === 'loading' ? '启动中' : rt?.status === 'error' ? '失效' : '不支持'}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
            <button type="button" onClick={() => switchPlayback({})} className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.09] text-[12px] hover:bg-white/[0.15]"><RefreshCw className="h-3.5 w-3.5" />重新获取链接</button>
            <button type="button" onClick={() => ui.openSettings('sources')} className="w-full text-center text-[11px] text-white/40 hover:text-white/70">管理音源…</button>
        </div>
    );
}

export function Panel({ theme }: { theme: Theme }) {
    const tab = useUi(s => s.panelTab);
    const current = usePlayer(s => s.current);
    const coverUrl = usePlayer(s => s.coverUrl);
    const compact = useCompact();
    const lite = useLite();
    return (
        <motion.div
            className={cx(
                'no-drag absolute z-30 flex flex-col overflow-hidden rounded-[30px] border border-white/10 shadow-[0_30px_90px_rgba(0,0,0,.45)] backdrop-blur-3xl',
                compact ? 'inset-x-2 bottom-[110px] max-h-[calc(100%-176px)] p-4' : 'bottom-[104px] right-8 max-h-[calc(100vh-140px)] w-[320px] p-5',
            )}
            style={{ background: css(theme.panel, lite ? 0.94 : 0.72) }}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        >
            {tab !== 'queue' && !(compact && tab !== 'cover') && (
                <Cover src={coverUrl || current?.cover} seed={current?.name} className={cx('mb-4 aspect-square shrink-0 shadow-[0_12px_40px_rgba(0,0,0,.35)]', compact ? 'mx-auto h-[min(30vh,200px)]' : 'w-full max-h-[280px]')} rounded="rounded-[20px]" eager />
            )}
            <div className="mb-4 flex shrink-0 items-center gap-1 rounded-2xl bg-black/20 p-1">
                {TABS.map(t => (
                    <button key={t.id} type="button" title={t.label} onClick={() => useUi.setState({ panelTab: t.id })} className={cx('grid h-9 flex-1 place-items-center rounded-xl transition-colors', tab === t.id ? 'bg-white/[0.18] text-white' : 'text-white/45 hover:text-white/80')}>
                        <t.icon className="h-4 w-4" />
                    </button>
                ))}
            </div>
            <div className="scroll-thin -mx-1 min-h-0 overflow-y-auto px-1">
                {tab === 'cover' && <SongTab />}
                {tab === 'lyrics' && <LyricsTab theme={theme} />}
                {tab === 'controls' && <ControlsTab theme={theme} />}
                {tab === 'queue' && <QueueTab />}
                {tab === 'source' && <SourceTab />}
            </div>
        </motion.div>
    );
}

export function openExternalSafe(url: string) {
    if (/^https?:\/\//i.test(url)) void host.openExternal(url);
}
