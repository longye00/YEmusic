/** 全局快捷键（输入框内只响应 Esc） */
import { useEffect } from 'react';
import { host } from '@/lib/host';
import { toggleFavorite } from '@/store/library';
import { next, prev, seekBy, toggle, usePlayer } from '@/store/player';
import { setSetting, useSettings } from '@/store/settings';
import { toast } from '@/store/toast';
import { ui, useUi } from '@/store/ui';

const isTyping = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return Boolean(el?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]'));
};

function changeVolume(delta: number) {
    const { volume } = useSettings.getState();
    const value = Math.max(0, Math.min(1, Math.round((volume + delta) * 100) / 100));
    setSetting('volume', value);
    if (useSettings.getState().muted) setSetting('muted', false);
    toast(`音量 ${Math.round(value * 100)}%`, 'info', { duration: 1000, key: 'volume' });
}

/** Esc：菜单 → 歌词样式窗口 → 对话框/设置（由各自处理）→ 面板 → 播放页 → 搜索 → 详情 */
function closeTopLayer() {
    const s = useUi.getState();
    if (s.menu) return ui.menu(null);
    // 歌词样式窗口浮在设置 / 播放页之上（焦点不在窗口内时走到这里；在内时由窗口的 capture 监听先拦下）
    if (s.lyricStyle) return ui.closeLyricStyle();
    if (s.dialog || s.settingsOpen) return;
    // 搜索浮在播放页之上时先关搜索
    if (s.searchOpen && s.playerOpen) return ui.closeSearch();
    if (s.playerOpen && s.panelOpen) return useUi.setState({ panelOpen: false });
    if (s.playerOpen) return ui.closePlayer();
    if (s.searchOpen) return ui.closeSearch();
    if (s.detail) return ui.closeDetail();
}

/** 向各层浮层模拟一次 Esc（对话框 / 设置 / 弹层各自监听 window 的 keydown） */
function fireEscape() {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

/**
 * Android 返回键：与 Esc 的层级一致（菜单 → 对话框 / 设置 → 面板 → 播放页 → 搜索 → 详情）。
 * @returns 是否关闭了某一层；false 表示已在最外层，由外壳把应用退到后台
 */
export function handleBack(): boolean {
    const s = useUi.getState();
    if (s.menu) { ui.menu(null); return true; }
    if (s.lyricStyle) { ui.closeLyricStyle(); return true; }
    if (s.dialog || s.settingsOpen) { fireEscape(); return true; }
    if (s.searchOpen && s.playerOpen) { ui.closeSearch(); return true; }
    if (s.playerOpen && s.panelOpen) { useUi.setState({ panelOpen: false }); return true; }
    if (s.playerOpen) { ui.closePlayer(); return true; }
    if (s.searchOpen) { ui.closeSearch(); return true; }
    if (s.detail) { ui.closeDetail(); return true; }
    // 乐库里的弹层 / 过滤条同样监听 Esc
    if (document.querySelector('.seam-pop, input[placeholder^="过滤"]')) { fireEscape(); return true; }
    return false;
}

export function useShortcuts() {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented && event.key !== 'Escape') return;
            const ctrl = event.ctrlKey || event.metaKey;
            const key = event.key;
            if (key === 'Escape') {
                closeTopLayer();
                return;
            }
            if (key === 'F11') {
                event.preventDefault();
                host.toggleFullscreen();
                return;
            }
            /**
             * 多媒体键：放在 isTyping 与模态判断之前，输入框里、歌词样式窗口开着时也要能控制播放。
             * 原先只接了 MediaPlayPause，键盘上的下一首 / 上一首 / 停止 / 音量键全都没反应
             * （系统媒体会话是另一条路径，窗口聚焦时按键先落到这里）。
             */
            if (key.startsWith('Media')) {
                if (key === 'MediaPlayPause') {
                    event.preventDefault();
                    if (usePlayer.getState().current) toggle();
                } else if (key === 'MediaTrackNext' || key === 'MediaNextTrack') {
                    event.preventDefault();
                    next();
                } else if (key === 'MediaTrackPrevious' || key === 'MediaPreviousTrack') {
                    event.preventDefault();
                    prev();
                } else if (key === 'MediaStop') {
                    event.preventDefault();
                    if (usePlayer.getState().status !== 'idle') toggle();
                } else if (key === 'AudioVolumeUp' || key === 'VolumeUp') {
                    event.preventDefault();
                    changeVolume(0.05);
                } else if (key === 'AudioVolumeDown' || key === 'VolumeDown') {
                    event.preventDefault();
                    changeVolume(-0.05);
                } else if (key === 'AudioVolumeMute' || key === 'VolumeMute') {
                    event.preventDefault();
                    const muted = !useSettings.getState().muted;
                    setSetting('muted', muted);
                    toast(muted ? '已静音' : '已取消静音', 'info', { duration: 1000, key: 'volume' });
                }
                return;
            }
            // 歌词样式窗口是模态：Ctrl+K / Ctrl+, 等全局快捷键不许在里面打开新的浮层（否则浮层压在窗口下不可见），多媒体键仍走上面那条路径
            if (useUi.getState().lyricStyle) return;
            if (ctrl && !event.shiftKey && (key === 'k' || key === 'K' || key === 'f' || key === 'F')) {
                event.preventDefault();
                ui.openSearch();
                return;
            }
            if (ctrl && key === ',') {
                event.preventDefault();
                ui.openSettings();
                return;
            }
            if (isTyping(event.target)) return;
            const state = useUi.getState();
            if (state.dialog || state.settingsOpen) return;
            const playerOpen = state.playerOpen;
            if (ctrl && (key === 'p' || key === 'P')) {
                event.preventDefault();
                if (playerOpen) ui.closePlayer();
                else ui.openPlayer();
                return;
            }
            if (ctrl && key === 'ArrowLeft') {
                event.preventDefault();
                prev();
                return;
            }
            if (ctrl && key === 'ArrowRight') {
                event.preventDefault();
                next();
                return;
            }
            if (ctrl && key === 'ArrowUp') {
                event.preventDefault();
                changeVolume(0.05);
                return;
            }
            if (ctrl && key === 'ArrowDown') {
                event.preventDefault();
                changeVolume(-0.05);
                return;
            }
            if (ctrl || event.altKey) return;
            if (key === ' ') {
                event.preventDefault();
                (document.activeElement as HTMLElement | null)?.blur?.();
                if (usePlayer.getState().current) toggle();
                return;
            }
            if (playerOpen && key === 'ArrowLeft') {
                event.preventDefault();
                seekBy(-5);
                return;
            }
            if (playerOpen && key === 'ArrowRight') {
                event.preventDefault();
                seekBy(5);
                return;
            }
            if (playerOpen && key === 'ArrowUp') {
                event.preventDefault();
                changeVolume(0.05);
                return;
            }
            if (playerOpen && key === 'ArrowDown') {
                event.preventDefault();
                changeVolume(-0.05);
                return;
            }
            if (key === '?') {
                event.preventDefault();
                ui.openSettings('about');
                return;
            }
            if (key === 'l' || key === 'L') {
                const current = usePlayer.getState().current;
                if (current) {
                    const on = toggleFavorite(current);
                    toast(on ? '已添加到我喜欢' : '已从我喜欢移除', 'info', { duration: 1300, key: 'like' });
                }
                return;
            }
            if (key === 'm' || key === 'M') {
                const muted = !useSettings.getState().muted;
                setSetting('muted', muted);
                toast(muted ? '已静音' : '已取消静音', 'info', { duration: 1000, key: 'volume' });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
}
