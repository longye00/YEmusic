/** 沉浸式播放页：流体背景 + 歌词动画（Luminous / Flow / Folia 的 8 种） + 底部胶囊 + 右下角面板 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, RefreshCw, Settings2, SkipForward, SlidersHorizontal } from 'lucide-react';
import { next, retry, usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { ui, useUi } from '@/store/ui';
import { useCompact, useCover, useIdle } from '../hooks';
import { Button, Cover, EmptyState, IconButton, Spinner, cx } from '../components/common';
import { css, useTheme } from '../theme';
import { DitherLayer } from '../components/FluidBackground';
import { ControlPill } from './ControlPill';
import { LyricsFlow } from './LyricsFlow';
import { LyricsLuminous } from './LyricsLuminous';
import { Panel } from './Panel';
import { FoliaBoundary } from './folia/FoliaBoundary';
import { isFoliaMode } from './folia/modes';
import { toast } from '@/store/toast';
import { MOTION } from '../motion';

// Folia 的动画代码（pixi / three / 各动画）体积不小，选用时才下载
const FoliaLyrics = lazy(() => import('./folia/FoliaLyrics'));

function Backdrop() {
    const background = useSettings(s => s.background);
    const dither = useSettings(s => s.dither);
    const coverUrl = usePlayer(s => s.coverUrl);
    const palette = usePlayer(s => s.palette);
    const theme = useTheme(palette);
    const cover = useCover(coverUrl);
    if (background === 'latent') return null;
    if (background === 'solid') {
        return <div className="absolute inset-0" style={{ background: `radial-gradient(120% 100% at 30% 20%, ${css(theme.fluid[1])}, ${css(theme.base)} 70%)` }}>{dither && <DitherLayer back={theme.base} front={theme.fluid[2]} opacity={0.35} />}</div>;
    }
    return (
        <div className="absolute inset-0 overflow-hidden bg-black">
            {cover && <motion.img key={cover} src={cover} alt="" className="absolute left-1/2 top-1/2 h-[160%] w-[160%] max-w-none -translate-x-1/2 -translate-y-1/2 object-cover opacity-70 blur-[90px] saturate-150" initial={{ opacity: 0 }} animate={{ opacity: 0.7, rotate: [0, 8, 0] }} transition={{ opacity: { duration: 1 }, rotate: { duration: 40, repeat: Infinity, ease: 'easeInOut' } }} />}
            <div className="absolute inset-0 bg-black/35" />
            {dither && <DitherLayer back={theme.base} front={theme.fluid[2]} opacity={0.3} />}
        </div>
    );
}

function CoverHero({ note, busy }: { note?: string; busy?: boolean }) {
    const current = usePlayer(s => s.current);
    const coverUrl = usePlayer(s => s.coverUrl);
    if (!current) return null;
    return (
        <motion.div className="absolute inset-0 flex flex-col items-center justify-center gap-6 pb-16" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 26 }}>
            <Cover src={coverUrl || current.cover} seed={current.name} className="aspect-square w-[min(40vh,360px)] shadow-[var(--shadow-card)] ring-1 ring-white/15" rounded="rounded-[28px]" eager />
            <div className="max-w-[70vw] text-center">
                <div className="truncate text-[30px] font-bold tracking-tight text-shadow-soft">{current.name}</div>
                <div className="mt-1 truncate text-[15px] txt-3">{current.singer}{current.album ? ` • ${current.album}` : ''}</div>
            </div>
            {note && <div className="flex items-center gap-2 rounded-full bg-black/25 lite:bg-black/65 px-4 py-1.5 text-[12px] txt-3 lite:txt-2 backdrop-blur-xl">{busy && <Spinner className="h-3.5 w-3.5" />}{note}</div>}
        </motion.div>
    );
}

function ErrorCard() {
    const current = usePlayer(s => s.current);
    const error = usePlayer(s => s.error);
    const details = usePlayer(s => s.errorDetails);
    const queueLength = usePlayer(s => s.queue.length);
    return (
        <motion.div className="absolute inset-0 grid place-items-center px-6 pb-16" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-[min(560px,100%)] rounded-[28px] border ln bg-black/35 p-7 text-center shadow-[var(--shadow-panel)] backdrop-blur-2xl">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-200"><AlertTriangle className="h-7 w-7" /></div>
                <div className="mt-4 text-[20px] font-bold">《{current?.name}》暂时无法播放</div>
                <div className="mt-2 text-[13px] leading-relaxed txt-3">{error}</div>
                {details.length > 0 && (
                    <ul className="scroll-thin mx-auto mt-4 max-h-36 max-w-[460px] space-y-1 overflow-y-auto rounded-2xl bg-black/25 p-3 text-left font-mono text-[11px] txt-4">
                        {details.slice(0, 12).map((d, i) => <li key={i} className="truncate" title={d}>· {d}</li>)}
                    </ul>
                )}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Button variant="white" onClick={retry}><RefreshCw className="h-4 w-4" />重试</Button>
                    {queueLength > 1 && <Button onClick={() => next()}><SkipForward className="h-4 w-4" />下一首</Button>}
                    <Button onClick={() => ui.openSettings('sources')}><Settings2 className="h-4 w-4" />检查音源</Button>
                </div>
            </div>
        </motion.div>
    );
}

export function PlayerView() {
    const current = usePlayer(s => s.current);
    const status = usePlayer(s => s.status);
    const statusText = usePlayer(s => s.statusText);
    const lyric = usePlayer(s => s.lyric);
    const lyricState = usePlayer(s => s.lyricState);
    const palette = usePlayer(s => s.palette);
    const panelOpen = useUi(s => s.panelOpen);
    // 歌词样式窗口开着时，这里必须一个不剩地卸下所有歌词渲染器（只留 Backdrop）：
    // Folia 各动画读写模块级的 lyricClock / audioBands MotionValue，预览与播放页各挂一个会互相污染。
    // 关窗后的 350ms 里继续压着：窗口退场动画里预览还活着，两套 rAF 同写一个 MotionValue 会让歌词抖一下
    const lyricStyleOpen = useUi(s => Boolean(s.lyricStyle));
    const [suppressLyrics, setSuppressLyrics] = useState(lyricStyleOpen);
    useEffect(() => {
        if (lyricStyleOpen) { setSuppressLyrics(true); return; }
        const timer = setTimeout(() => setSuppressLyrics(false), 350);
        return () => clearTimeout(timer);
    }, [lyricStyleOpen]);

    // 面板轻按外部关闭：落在控件（胶囊、返回键、任何可交互元素）上的点击照常生效；
    // 落在歌词 / 封面舞台上时吞掉随后的 click，避免误触歌词行 seek（对话框 / 右键菜单开着时不收）
    useEffect(() => {
        if (!panelOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            // 只有主键收面板：右键留着弹菜单；标题栏拖动带也不收
            if (event.button !== 0) return;
            const target = event.target as HTMLElement;
            if (!target || useUi.getState().dialog || useUi.getState().menu) return;
            if (target.closest('[data-panel]') || target.closest('.drag') || target.closest('[data-panel-toggle]')) return;
            ui.togglePanel();
            if (target.closest('button, input, select, a, [role="button"], [role="slider"], [contenteditable="true"]')) return;
            const swallow = (e: MouseEvent) => {
                e.stopPropagation();
                e.preventDefault();
            };
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, true), 500);
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, [panelOpen]);
    const searchOpen = useUi(s => s.searchOpen);
    const style = useSettings(s => s.lyricStyle);
    const theme = useTheme(palette);
    const compact = useCompact();
    const idle = useIdle(3200, !panelOpen);
    const hasLyric = Boolean(lyric?.lines.some(l => l.text.trim()));

    return (
        <motion.div
            className={cx('absolute inset-0 z-[60] overflow-hidden', idle && 'cursor-none', searchOpen && 'invisible')}
            aria-hidden={searchOpen || undefined}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: MOTION.dur.show, ease: MOTION.ease.out }}
        >
            <Backdrop />
            <div className="drag absolute inset-x-0 top-0 h-16 touch:hidden" />

            <div className="absolute inset-0" data-player-stage>
                {suppressLyrics ? null : !current ? (
                    <div className="absolute inset-0 grid place-items-center">
                        <EmptyState title="还没有播放的歌曲" desc="去首页挑一个歌单，或按 Ctrl+K 搜索。"><Button onClick={ui.closePlayer}>返回首页</Button></EmptyState>
                    </div>
                ) : status === 'error' ? (
                    <ErrorCard />
                ) : hasLyric && lyric ? (
                    isFoliaMode(style) ? (
                        <FoliaBoundary
                            resetKey={`${style}:${current.id}`}
                            onError={() => toast('该歌词动画在当前设备上无法运行，已临时改用 Luminous', 'error')}
                            fallback={<LyricsLuminous lyric={lyric} accent={theme.accent} soft={theme.accentSoft} title={current.name} singer={current.singer} />}
                        >
                            <Suspense fallback={null}><FoliaLyrics mode={style} lyric={lyric} theme={theme} /></Suspense>
                        </FoliaBoundary>
                    ) : style === 'flow' ? <LyricsFlow lyric={lyric} accent={theme.accent} /> : <LyricsLuminous lyric={lyric} accent={theme.accent} soft={theme.accentSoft} title={current.name} singer={current.singer} />
                ) : (
                    <CoverHero busy={status === 'loading' || lyricState === 'loading'} note={status === 'loading' ? statusText || '正在加载…' : lyricState === 'loading' ? '正在加载歌词…' : '暂无歌词，纯享音乐'} />
                )}
            </div>

            {current && status === 'loading' && hasLyric && (
                <div className="absolute left-1/2 top-6 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/30 lite:bg-black/70 px-4 py-1.5 text-[12px] txt-3 lite:txt-1 backdrop-blur-xl"><Spinner className="h-3.5 w-3.5" />{statusText || '正在加载…'}</div>
            )}

            <motion.div className={cx('absolute z-20 flex items-center gap-3', compact ? 'left-3 top-3' : 'left-6 top-6', idle && 'pointer-events-none')} animate={{ opacity: idle ? 0 : 1 }} transition={{ duration: 0.4 }}>
                <IconButton variant="solid" label="返回 (Esc)" onClick={ui.closePlayer}><ChevronLeft className="h-5 w-5" /></IconButton>
                {current && hasLyric && (
                    <div className={cx('leading-tight', compact ? 'max-w-[52vw]' : 'max-w-[40vw]')}>
                        <div className="truncate text-[13px] font-semibold txt-1">{current.name}</div>
                        <div className="truncate text-[12px] txt-4">{current.singer}</div>
                    </div>
                )}
            </motion.div>

            <div className={cx('pointer-events-none absolute inset-x-0 z-20 flex justify-center', compact ? 'bottom-[calc(0.5rem+var(--safe-bottom))] px-2' : 'bottom-7')}>
                <ControlPill variant="player" idle={idle} />
            </div>

            <AnimatePresence>{panelOpen && <Panel key="panel" theme={theme} />}</AnimatePresence>

            {/* 面板开着时点外面就收掉（见上方 pointerdown 监听），不再提供 X 关闭按钮 */}
            {!panelOpen && (
                <motion.div className={cx('absolute z-40', compact ? 'right-3 top-3' : 'bottom-8 right-8', idle && 'pointer-events-none')} animate={{ opacity: idle ? 0 : 1 }} transition={{ duration: 0.4 }}>
                    <IconButton
                        size={compact ? 'md' : 'lg'}
                        variant="solid"
                        label="播放设置"
                        onClick={() => ui.togglePanel()}
                        className="shadow-[var(--shadow-float)]"
                    >
                        <SlidersHorizontal className="h-5 w-5" />
                    </IconButton>
                </motion.div>
            )}
        </motion.div>
    );
}
