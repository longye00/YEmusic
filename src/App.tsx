/** 应用外壳：共享流体背景 + 首页 + 详情 / 搜索 / 播放页浮层 + 全局对话框 */
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect } from 'react';
import { engine } from '@/player/engine';
import { usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { FluidBackground } from './ui/components/FluidBackground';
import { DetailView } from './ui/detail/DetailView';
import { Home } from './ui/home/Home';
import { ContextMenu, Dialogs, Toasts } from './ui/Overlays';
import { PlayerView } from './ui/player/PlayerView';
import { SearchOverlay } from './ui/search/SearchOverlay';
import { SettingsModal } from './ui/settings/SettingsModal';
import { useShortcuts } from './ui/shortcuts';
import { useTheme } from './ui/theme';
import { WindowControls } from './ui/WindowControls';
import { ErrorBoundary } from './ui/components/ErrorBoundary';

function SharedBackground() {
    const playerOpen = useUi(s => s.playerOpen);
    const detailOpen = useUi(s => Boolean(s.detail));
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
    const energy = useCallback(() => engine.energy(), []);
    const covered = playerOpen && background !== 'latent';
    return (
        <FluidBackground
            colors={theme.fluid as never}
            dim={playerOpen ? 1 : detailOpen ? 0.42 : 0.58}
            dither={playerOpen && dither && background === 'latent'}
            grain={playerOpen}
            speed={reduceMotion ? 0.25 : playerOpen ? 1 : 0.6}
            energy={playerOpen && reactive && playing && !reduceMotion ? energy : undefined}
            paused={covered || reduceMotion || (libraryHome && !playerOpen)}
        />
    );
}

export function App() {
    useShortcuts();
    const detail = useUi(s => s.detail);
    const searchOpen = useUi(s => s.searchOpen);
    const playerOpen = useUi(s => s.playerOpen);
    const reduceMotion = useSettings(s => s.reduceMotion);

    useEffect(() => {
        document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    }, [reduceMotion]);

    const homeHidden = playerOpen || Boolean(detail);
    return (
        <div className="relative h-full w-full overflow-hidden bg-[#050507] text-white antialiased">
            <SharedBackground />
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
            <ErrorBoundary name="对话框" onReset={() => useUi.setState({ dialog: null })}>
                <Dialogs />
            </ErrorBoundary>
            <ErrorBoundary name="菜单" onReset={() => useUi.setState({ menu: null })}>
                <ContextMenu />
            </ErrorBoundary>
            <Toasts />
            <WindowControls />
        </div>
    );
}
