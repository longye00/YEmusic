/**
 * 歌词样式窗口（Folia 式独立设置窗）：半透明暗化层上一个 1240×780 的深色窗口，
 * 左边是按应用窗口比例缩放的实时预览 + 样式缩略图架，右边是五页签的设置栏。
 * 叠在任意页面上（主页 / 播放页 / 设置），z-[85]：Surface(80) 之上、右键菜单(90) 之下。
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { usePlayer } from '@/store/player';
import { ui } from '@/store/ui';
import { useLite } from '@/lib/lite';
import { useCompact } from '../hooks';
import { cx } from '../components/common';
import { css, useTheme } from '../theme';
import { LyricStage } from './LyricStage';
import { LyricStyleColumn } from './LyricStyleColumn';
import { StyleShelf } from './StyleShelf';
import './lyricStyle.css';

/** 窗口内可聚焦的元素（焦点圈定用） */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function LyricStyleWindow() {
    const palette = usePlayer(s => s.palette);
    const theme = useTheme(palette);
    const lite = useLite();
    const compact = useCompact();
    const rootRef = useRef<HTMLDivElement>(null);
    // 只有「按下就落在暗化层上」的点击才关窗：从窗口里拖出来松手不误触
    const downOnDim = useRef(false);

    // 焦点：开窗时进窗口，关窗时还给打开它的元素
    useEffect(() => {
        const before = document.activeElement as HTMLElement | null;
        rootRef.current?.focus();
        return () => before?.focus?.();
    }, []);

    const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            // capture + stopImmediatePropagation：底下的设置窗口 / 全局快捷键都收不到这次 Esc
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            ui.closeLyricStyle();
            return;
        }
        if (event.key !== 'Tab') return;
        const root = rootRef.current;
        if (!root) return;
        // offsetParent === null 的是 display:none 元素（如导入 .lrc 的隐藏 file input），focus() 对它无效会形成死 Tab 位
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        // Tab 在窗口内循环；焦点不在窗口里时（理论上不该发生）拉回第一个
        if (event.shiftKey) {
            if (!active || active === first || !root.contains(active)) { event.preventDefault(); last.focus(); }
        } else if (!active || active === last || !root.contains(active)) {
            event.preventDefault();
            first.focus();
        }
    };

    return (
        <div
            className={cx('ye-lyst fixed inset-0 z-[85] grid place-items-center', compact ? 'p-0' : 'p-3 sm:p-5')}
            style={{ '--lyst-accent': css(theme.accent) } as CSSProperties}
        >
            <motion.div
                className={cx('absolute inset-0', lite ? 'bg-black/75' : 'bg-black/52 backdrop-blur-xl')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onPointerDown={event => { downOnDim.current = event.target === event.currentTarget; }}
                onClick={event => {
                    if (downOnDim.current && event.target === event.currentTarget) ui.closeLyricStyle();
                    downOnDim.current = false;
                }}
            />
            <motion.div
                ref={rootRef}
                role="dialog"
                aria-modal="true"
                aria-label="歌词样式"
                tabIndex={-1}
                onKeyDownCapture={onKeyDownCapture}
                className={cx(
                    'relative grid grid-rows-[64px_minmax(0,1fr)] overflow-hidden bg-[#1a1a1d] text-white outline-none',
                    // 居中 grid 的轨道会按内容撑开，max-w-full 解析出来是 1240 而不是容器宽 —— 必须用视口单位夹住
                    compact
                        ? 'h-dvh w-dvw rounded-none'
                        : 'h-[780px] max-h-[calc(100dvh-1.5rem)] w-[1240px] max-w-[calc(100dvw-1.5rem)] rounded-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-[calc(100dvw-2.5rem)]',
                )}
                style={{ boxShadow: '0 36px 90px rgba(0,0,0,.5), 0 0 0 1px rgb(255 255 255 / .16)' }}
                initial={{ opacity: 0, y: 12, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.99, transition: { duration: 0.2 } }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
            >
                {/* 头部：返回 + 标题 */}
                <header className="flex items-center gap-2 border-b border-white/[0.08] px-4 sm:px-5">
                    <button
                        type="button"
                        onClick={() => ui.closeLyricStyle()}
                        title="返回 (Esc)"
                        aria-label="返回 (Esc)"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <h1 className="text-[15px] font-semibold">歌词样式</h1>
                </header>
                {/* 主体：左预览 + 右设置；窄窗口上下堆叠、整列滚动 */}
                <div className="min-h-0 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
                    <section className="flex flex-col gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-6 lg:min-h-0 lg:pt-0">
                        <div className="flex h-[64vh] min-h-[380px] lg:h-auto lg:min-h-0 lg:flex-1">
                            <LyricStage theme={theme} />
                        </div>
                        <StyleShelf theme={theme} />
                    </section>
                    <aside className="flex min-h-0 flex-col border-t border-white/[0.08] lg:border-l lg:border-t-0">
                        <LyricStyleColumn theme={theme} />
                    </aside>
                </div>
            </motion.div>
        </div>
    );
}
