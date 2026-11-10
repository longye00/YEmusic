/**
 * 歌词样式窗口左侧的实时预览：一个保持应用窗口长宽比的 SampleBox，
 * 里面先按框的大小画背景（Latent 流体 / 模糊封面 / 纯色），
 * 再把歌词渲染器画在与应用窗口等大的舞台上、整体缩放进框里 ——
 * 用窗口尺寸布局的动画（Luminous 的 useWindowSize、Folia 各样式的 vw/vh）
 * 因此排出来与播放页一致（Folia 的 VisPlaygroundSampleStage 思路）。
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pause, Play } from 'lucide-react';
import { engine } from '@/player/engine';
import { isAndroid } from '@/lib/host';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { toast } from '@/store/toast';
import { cx } from '../components/common';
import { DitherLayer, FluidBackground } from '../components/FluidBackground';
import { useCover, useWindowSize } from '../hooks';
import { css, type Theme } from '../theme';
import { LyricsFlow } from '../player/LyricsFlow';
import { LyricsLuminous } from '../player/LyricsLuminous';
import { FoliaBoundary } from '../player/folia/FoliaBoundary';
import { isFoliaMode } from '../player/folia/modes';
import { engineLyricTime, LyricTimeContext, type LyricTimeSource } from '../player/lyricTime';
import { SAMPLE_LOOP, SAMPLE_LYRIC, SAMPLE_PREVIEW } from './sampleLyric';

// Folia 的动画代码按需加载（与播放页同一个分包）
const FoliaLyrics = lazy(() => import('../player/folia/FoliaLyrics'));

interface PreviewClock extends LyricTimeSource {
    setPaused(paused: boolean): void;
}

/** 内置样例的循环时钟：不另开 rAF，now() 按 performance.now() 惰性推进，暂停时冻结 */
function loopClock(loop: number): PreviewClock {
    let base = 0;
    let stamp = performance.now();
    let paused = false;
    const now = () => ((paused ? 0 : (performance.now() - stamp) / 1000) + base) % loop;
    return {
        now,
        playing: () => !paused,
        setPaused(next) {
            if (next === paused) return;
            if (next) {
                base = now();
                stamp = performance.now();
            } else {
                stamp = performance.now();
            }
            paused = next;
        },
    };
}

/** 实时预览的时钟：正常时就是播放器；暂停时把歌词时间冻结在按下那一刻 */
function liveClock(): PreviewClock {
    let frozen: number | null = null;
    return {
        now: () => frozen ?? engineLyricTime.now(),
        playing: () => frozen === null && engine.playing,
        seek: engineLyricTime.seek,
        setPaused(next) {
            frozen = next ? engineLyricTime.now() : null;
        },
    };
}

/** 元素尺寸的实时值（ResizeObserver），未测到时为 null */
function useBoxSize(ref: RefObject<HTMLElement | null>) {
    const [box, setBox] = useState<{ width: number; height: number } | null>(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const measure = () => setBox(before => (
            before && before.width === node.clientWidth && before.height === node.clientHeight
                ? before
                : { width: node.clientWidth, height: node.clientHeight }
        ));
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [ref]);
    return box;
}

/** 预览框的背景层：按框的大小画（不缩放），与播放页 Backdrop / SharedBackground 同一套设置 */
function StageBackdrop({ theme, cover, paused }: { theme: Theme; cover?: string; paused: boolean }) {
    const background = useSettings(s => s.background);
    const dither = useSettings(s => s.dither);
    const reactive = useSettings(s => s.reactive);
    const reduceMotion = useSettings(s => s.reduceMotion);
    const energy = useCallback(() => engine.energy(), []);
    if (background === 'solid') {
        return (
            <div className="absolute inset-0" style={{ background: `radial-gradient(120% 100% at 30% 20%, ${css(theme.fluid[1])}, ${css(theme.base)} 70%)` }}>
                {dither && <DitherLayer back={theme.base} front={theme.fluid[2]} opacity={0.35} />}
            </div>
        );
    }
    if (background === 'blur') {
        return (
            <div className="absolute inset-0 overflow-hidden bg-black">
                {cover && <img src={cover} alt="" className="absolute left-1/2 top-1/2 h-[160%] w-[160%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover opacity-70 blur-[90px] saturate-150" />}
                <div className="absolute inset-0 bg-black/35" />
                {dither && <DitherLayer back={theme.base} front={theme.fluid[2]} opacity={0.3} />}
            </div>
        );
    }
    return (
        <FluidBackground
            colors={theme.fluid}
            dim={1}
            dither={dither}
            grain
            speed={reduceMotion ? 0.25 : 1}
            energy={reactive && !paused && !reduceMotion ? energy : undefined}
            paused={paused || reduceMotion}
        />
    );
}

export function LyricStage({ theme }: { theme: Theme }) {
    const current = usePlayer(s => s.current);
    const liveLyric = usePlayer(s => s.lyric);
    const coverRaw = usePlayer(s => s.coverUrl);
    const style = useSettings(s => s.lyricStyle);
    const accent = theme.accent;
    const hasLive = Boolean(liveLyric?.lines.some(l => l.text.trim()));
    // 载了带歌词的歌曲时默认「实时」，否则看内置样例（Folia 的 PreviewSource 语义）
    const [source, setSource] = useState<'builtin' | 'live'>(() => (hasLive ? 'live' : 'builtin'));
    // 安卓上预览默认暂停：预览舞台是「应用窗口等大再缩放」的完整歌词动画（Folia 各样式带 WebGL / Pixi），
    // 手机 GPU 跑它加上窗口自身的背景会把主线程拖到卡死。暂停钮就在预览右上角，想看动效点一下即可。
    const [paused, setPaused] = useState(isAndroid);
    const { w: winW, h: winH } = useWindowSize();
    const boxRef = useRef<HTMLDivElement>(null);
    const box = useBoxSize(boxRef);
    const cover = useCover(coverRaw || current?.cover);

    // 两个时钟各建一次；暂停钮统一拨它们（内置冻结循环、实时冻结当前值）
    const clocks = useMemo(() => ({ builtin: loopClock(SAMPLE_LOOP), live: liveClock() }), []);
    useEffect(() => {
        clocks.builtin.setPaused(paused);
        clocks.live.setPaused(paused);
    }, [clocks, paused]);
    const builtin = source === 'builtin' || !hasLive;
    const liveEmpty = source === 'live' && !hasLive;
    const timeSource = builtin ? clocks.builtin : clocks.live;

    const lyric = builtin ? SAMPLE_LYRIC : liveLyric!;
    const title = builtin ? SAMPLE_PREVIEW.title : current?.name ?? '';
    const singer = builtin ? SAMPLE_PREVIEW.singer : current?.singer ?? '';
    const preview = builtin ? { ...SAMPLE_PREVIEW, cover: coverRaw || current?.cover } : undefined;
    const scale = box ? box.width / winW : 0;

    const luminous = <LyricsLuminous lyric={lyric} accent={accent} soft={theme.accentSoft} title={title} singer={singer} />;
    const renderer: ReactNode = isFoliaMode(style) ? (
        <FoliaBoundary
            resetKey={`${style}:${builtin ? 'sample' : current?.id ?? 'none'}`}
            onError={() => toast('该歌词动画在当前设备上无法运行，已临时改用 Luminous', 'error')}
            fallback={luminous}
        >
            <Suspense fallback={null}><FoliaLyrics mode={style} lyric={lyric} theme={theme} preview={preview} /></Suspense>
        </FoliaBoundary>
    ) : style === 'flow' ? <LyricsFlow lyric={lyric} accent={accent} /> : luminous;

    return (
        <div className="grid min-h-[160px] flex-1 place-items-center [container-type:size]">
            <div
                ref={boxRef}
                data-lyst-preview
                className="relative overflow-hidden rounded-xl bg-[#151517] ring-1 ring-white/[0.08]"
                style={{ aspectRatio: `${winW} / ${winH}`, width: `min(100cqw, 100cqh * ${winW / winH})` }}
            >
                {/* 背景层：框的大小，不缩放 */}
                <StageBackdrop theme={theme} cover={cover} paused={paused} />
                {/* 歌词舞台：应用窗口大小 + 整体缩放，渲染结果只看不许点 */}
                {box && scale > 0 && (
                    <div
                        data-lyst-stage
                        className="pointer-events-none absolute left-0 top-0"
                        style={{ width: winW, height: winH, transform: `scale(${scale})`, transformOrigin: 'top left', contain: 'strict' }}
                    >
                        <LyricTimeContext.Provider value={timeSource}>{renderer}</LyricTimeContext.Provider>
                    </div>
                )}
                {/* 右上：内置 / 实时 切换 + 暂停（深色底板，浮在预览画面上） */}
                <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                    <div role="group" aria-label="预览来源" className="flex items-center gap-0.5 rounded-lg bg-black/45 p-0.5">
                        <button
                            type="button"
                            onClick={() => setSource('builtin')}
                            className={cx('h-7 rounded-md px-3 text-[12.5px] transition-colors', source === 'builtin' ? 'bg-white/[0.18] font-medium text-white' : 'text-white/62 hover:text-white')}
                        >
                            内置
                        </button>
                        <button
                            type="button"
                            onClick={() => setSource('live')}
                            className={cx('h-7 rounded-md px-3 text-[12.5px] transition-colors', source === 'live' ? 'bg-white/[0.18] font-medium text-white' : 'text-white/62 hover:text-white')}
                        >
                            实时
                        </button>
                    </div>
                    <button
                        type="button"
                        title={paused ? '继续预览' : '暂停预览'}
                        aria-label={paused ? '继续预览' : '暂停预览'}
                        onClick={() => setPaused(v => !v)}
                        className="grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/60"
                    >
                        {paused ? <Play size={14} /> : <Pause size={14} />}
                    </button>
                </div>
                {liveEmpty && (
                    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/75">
                        当前歌曲没有歌词，显示内置示例
                    </div>
                )}
            </div>
        </div>
    );
}
