/** 应用外壳：共享流体背景 + 首页 + 详情 / 搜索 / 播放页浮层 + 全局对话框 */
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useCallback, useEffect } from 'react';
import { engine } from '@/player/engine';
import { useLite } from '@/lib/lite';
import { hideSplash } from '@/lib/splash';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { FluidBackground } from './ui/components/FluidBackground';
import { DetailView, WALL_MIN_WIDTH } from './ui/detail/DetailView';
import { useWindowSize } from './ui/hooks';
import { Home } from './ui/home/Home';
import { LyricStyleWindow } from './ui/lyricStyle/LyricStyleWindow';
import { ContextMenu, Dialogs, Toasts } from './ui/Overlays';
import { PlayerView } from './ui/player/PlayerView';
import { SearchOverlay } from './ui/search/SearchOverlay';
import { SettingsModal } from './ui/settings/SettingsModal';
import { useShortcuts } from './ui/shortcuts';
import { syncThemeVars, useTheme } from './ui/theme';
import { WindowControls } from './ui/WindowControls';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { Tooltips } from './ui/components/Tooltip';

/** 首帧绘制后隐藏启动遮罩（等一个 rAF，确保真实首帧已过） */
function SplashHider() {
    useEffect(() => {
        const raf = requestAnimationFrame(() => hideSplash());
        return () => cancelAnimationFrame(raf);
    }, []);
    return null;
}

function SharedBackground() {
    const playerOpen = useUi(s => s.playerOpen);
    const detailOpen = useUi(s => Boolean(s.detail));
    const searchOpen = useUi(s => s.searchOpen);
    const lyricStyleOpen = useUi(s => Boolean(s.lyricStyle));
    const detail = useUi(s => s.detail);
    const detailLayout = useSettings(s => s.detailLayout);
    const { w: winW } = useWindowSize();
    const bgPalette = useUi(s => s.bgPalette);
    const playerPalette = usePlayer(s => s.palette);
    const playing = usePlayer(s => s.status === 'playing');
    const background = useSettings(s => s.background);
    const dither = useSettings(s => s.dither);
    const reactive = useSettings(s => s.reactive);
    const reduceMotion = useSettings(s => s.reduceMotion);
    // 乐库拼贴墙是不透明的，首页时流体背景被完全遮住，暂停以节省 GPU
    const libraryHome = useSettings(s => s.homeLayout === 'library');
    const homeTheme = useTheme(bgPalette || playerPalette);
    const playerTheme = useTheme(playerPalette);
    const theme = playerOpen ? playerTheme : homeTheme;
    // 精简模式关掉了毛玻璃，浮层底色要跟着加深，否则亮背景下文字发虚（见 theme.ts）
    const lite = useLite();

    // 主题 → CSS 变量：乐库拼贴墙的辉光、书签焦点环、::selection 读的是这几个变量，
    // 不同步的话换封面 / 自定义配色后它们仍停在默认紫（见 ui/theme.ts 的 syncThemeVars）
    useEffect(() => {
        syncThemeVars(theme, lite);
    }, [theme, lite]);

    const energy = useCallback(() => engine.energy(), []);
    // 不透明整版浮层盖住背景时同样暂停：拼贴墙详情（宽屏）、搜索工作台与歌词样式窗口都不是半透的
    const opaqueCover = Boolean(detail && detailLayout === 'wall' && winW >= WALL_MIN_WIDTH) || searchOpen || lyricStyleOpen;
    const covered = playerOpen && background !== 'latent';
    return (
        <FluidBackground
            colors={theme.fluid as never}
            dim={playerOpen ? 1 : detailOpen ? 0.42 : 0.58}
            dither={playerOpen && dither && background === 'latent'}
            grain={playerOpen}
            speed={reduceMotion ? 0.25 : playerOpen ? 1 : 0.6}
            energy={playerOpen && reactive && playing && !reduceMotion ? energy : undefined}
            paused={covered || reduceMotion || (!playerOpen && (libraryHome || opaqueCover))}
        />
    );
}

export function App() {
    useShortcuts();
    const detail = useUi(s => s.detail);
    const searchOpen = useUi(s => s.searchOpen);
    const playerOpen = useUi(s => s.playerOpen);
    const lyricStyle = useUi(s => s.lyricStyle);
    const reduceMotion = useSettings(s => s.reduceMotion);

    useEffect(() => {
        document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    }, [reduceMotion]);

    const homeHidden = playerOpen || Boolean(detail);
    return (
        // 减少动效：framer 的位移 / 缩放 / layout 动画统一关掉（CSS 侧见 .reduce-motion）
        <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>
        <div className="relative h-full w-full overflow-hidden bg-[#050507] text-white antialiased">
            <SharedBackground />
            <SplashHider />
            {/* 首页 / 详情页背景更克制：叠一层暗色晕影，让封面和文字成为视觉中心 */}
            <motion.div
                className="pointer-events-none absolute inset-0"
                style={{ background: 'radial-gradient(130% 95% at 50% 38%, rgb(8 8 14 / 0.25) 0%, rgb(5 5 9 / 0.78) 100%)' }}
                animate={{ opacity: playerOpen ? 0 : 1 }}
                transition={{ duration: 0.5 }}
            />
            <motion.div
                className="absolute inset-0"
                animate={{ opacity: homeHidden ? 0 : 1, scale: homeHidden ? 0.985 : 1 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                style={{ pointerEvents: homeHidden ? 'none' : 'auto' }}
                aria-hidden={homeHidden}
            >
                <ErrorBoundary name="首页" onReset={() => useUi.setState({ detail: null, searchOpen: false })}>
                    <Home />
                </ErrorBoundary>
            </motion.div>
            {/* 播放页打开时详情页保持挂载（返回时还原滚动位置），但隐藏起来 */}
            <motion.div
                className="pointer-events-none absolute inset-0"
                animate={{ opacity: playerOpen ? 0 : 1 }}
                transition={{ duration: 0.3 }}
                aria-hidden={playerOpen}
            >
                <AnimatePresence>
                    {detail && (
                        <ErrorBoundary key="detail" name="详情页" resetKey={detail} onReset={() => useUi.setState({ detail: null })}>
                            <DetailView />
                        </ErrorBoundary>
                    )}
                </AnimatePresence>
            </motion.div>
            <AnimatePresence>
                {searchOpen && (
                    <ErrorBoundary key="search" name="搜索" onReset={() => useUi.setState({ searchOpen: false })}>
                        <SearchOverlay />
                    </ErrorBoundary>
                )}
            </AnimatePresence>
            <AnimatePresence>
                {playerOpen && (
                    <ErrorBoundary key="player" name="播放页" onReset={() => useUi.setState({ playerOpen: false, panelOpen: false })}>
                        <PlayerView />
                    </ErrorBoundary>
                )}
            </AnimatePresence>
            <ErrorBoundary name="设置" onReset={() => useUi.setState({ settingsOpen: false })}>
                <SettingsModal />
            </ErrorBoundary>
            {/* 歌词样式窗口：叠在主页 / 播放页 / 设置之上（z-85），预览里独占一套歌词时钟 */}
            <AnimatePresence>
                {lyricStyle && (
                    <ErrorBoundary key="lyric-style" name="歌词样式" onReset={() => useUi.setState({ lyricStyle: null })}>
                        <LyricStyleWindow />
                    </ErrorBoundary>
                )}
            </AnimatePresence>
            <ErrorBoundary name="对话框" onReset={() => useUi.setState({ dialog: null })}>
                <Dialogs />
            </ErrorBoundary>
            <ErrorBoundary name="菜单" onReset={() => useUi.setState({ menu: null })}>
                <ContextMenu />
            </ErrorBoundary>
            <Toasts />
            <WindowControls />
            <Tooltips />
        </div>
        </MotionConfig>
    );
}
