/** 沉浸式播放页：流体背景 + 歌词动画（Luminous / Flow / Folia 的 8 种） + 底部胶囊 + 右下角面板 */
import { lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronLeft, RefreshCw, Settings2, SkipForward, SlidersHorizontal, X } from 'lucide-react';
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
            <Cover src={coverUrl || current.cover} seed={current.name} className="aspect-square w-[min(40vh,360px)] shadow-[0_40px_120px_rgba(0,0,0,.55)] ring-1 ring-white/15" rounded="rounded-[28px]" eager />
            <div className="max-w-[70vw] text-center">
                <div className="truncate text-[30px] font-bold tracking-tight text-shadow-soft">{current.name}</div>
                <div className="mt-1 truncate text-[15px] text-white/60">{current.singer}{current.album ? ` • ${current.album}` : ''}</div>
            </div>
            {note && <div className="flex items-center gap-2 rounded-full bg-black/25 px-4 py-1.5 text-[12px] text-white/60 backdrop-blur-xl">{busy && <Spinner className="h-3.5 w-3.5" />}{note}</div>}
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
            <div className="w-[min(560px,100%)] rounded-[28px] border border-white/10 bg-black/35 p-7 text-center shadow-[0_30px_90px_rgba(0,0,0,.4)] backdrop-blur-2xl">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15 text-red-200"><AlertTriangle className="h-7 w-7" /></div>
                <div className="mt-4 text-[20px] font-bold">《{current?.name}》暂时无法播放</div>
                <div className="mt-2 text-[13px] leading-relaxed text-white/60">{error}</div>
                {details.length > 0 && (
                    <ul className="scroll-thin mx-auto mt-4 max-h-36 max-w-[460px] space-y-1 overflow-y-auto rounded-2xl bg-black/25 p-3 text-left font-mono text-[11px] text-white/50">
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
    const style = useSettings(s => s.lyricStyle);
    const theme = useTheme(palette);
    const compact = useCompact();
    const idle = useIdle(3200, !panelOpen);
    const hasLyric = Boolean(lyric?.lines.some(l => l.text.trim()));

    return (
        <motion.div
            className={cx('absolute inset-0 z-[60] overflow-hidden', idle && 'cursor-none')}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
            <Backdrop />
            <div className="drag absolute inset-x-0 top-0 h-16 touch:hidden" />

            <div className="absolute inset-0">
                {!current ? (
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
                <div className="absolute left-1/2 top-6 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/30 px-4 py-1.5 text-[12px] text-white/70 backdrop-blur-xl"><Spinner className="h-3.5 w-3.5" />{statusText || '正在加载…'}</div>
            )}

            <motion.div className={cx('absolute z-20 flex items-center gap-3', compact ? 'left-3 top-3' : 'left-6 top-6', idle && 'pointer-events-none')} animate={{ opacity: idle ? 0 : 1 }} transition={{ duration: 0.4 }}>
                <IconButton variant="solid" label="返回 (Esc)" onClick={ui.closePlayer}><ChevronLeft className="h-5 w-5" /></IconButton>
                {current && hasLyric && (
                    <div className={cx('leading-tight', compact ? 'max-w-[52vw]' : 'max-w-[40vw]')}>
                        <div className="truncate text-[13px] font-semibold text-white/85">{current.name}</div>
                        <div className="truncate text-[12px] text-white/45">{current.singer}</div>
                    </div>
                )}
            </motion.div>

            <div className={cx('pointer-events-none absolute inset-x-0 z-20 flex justify-center', compact ? 'bottom-[calc(0.5rem+var(--safe-bottom))] px-2' : 'bottom-7')}>
                <ControlPill variant="player" idle={idle} />
            </div>

            <AnimatePresence>{panelOpen && <Panel key="panel" theme={theme} />}</AnimatePresence>

            <motion.div className={cx('absolute z-40', compact ? 'right-3 top-3' : 'bottom-8 right-8', idle && 'pointer-events-none')} animate={{ opacity: idle ? 0 : 1 }} transition={{ duration: 0.4 }}>
                <IconButton
                    size={compact ? 'md' : 'lg'}
                    variant={panelOpen ? 'white' : 'solid'}
                    label={panelOpen ? '关闭面板' : '播放设置'}
                    onClick={() => ui.togglePanel()}
                    className="shadow-[0_10px_30px_rgba(0,0,0,.3)]"
                >
                    {panelOpen ? <X className="h-5 w-5" /> : <SlidersHorizontal className="h-5 w-5" />}
                </IconButton>
            </motion.div>
        </motion.div>
    );
}
