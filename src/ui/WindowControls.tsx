/** 无边框窗口的最小化 / 最大化 / 关闭按钮（仅 Windows / Linux 桌面端显示） */
import { Copy, Minimize2, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { host, isAndroid, isDesktop } from '@/lib/host';
import { cx } from './components/common';

export function WindowControls() {
    return isAndroid ? null : <DesktopWindowControls />;
}

function DesktopWindowControls() {
    const [state, setState] = useState({ maximized: false, fullscreen: false, focused: true });
    const [revealed, setRevealed] = useState(true);
    useEffect(() => {
        // 与 Folia 一致：鼠标靠近顶部时完全显示，其余时间淡化，不干扰沉浸界面
        let timer = setTimeout(() => setRevealed(false), 2500);
        const onMove = (event: PointerEvent) => {
            const near = event.clientY < 64 && event.clientX > window.innerWidth - 320;
            clearTimeout(timer);
            if (near) setRevealed(true);
            else timer = setTimeout(() => setRevealed(false), 600);
        };
        const onLeave = () => setRevealed(false);
        window.addEventListener('pointermove', onMove);
        document.addEventListener('pointerleave', onLeave);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerleave', onLeave);
        };
    }, []);
    useEffect(() => {
        if (!isDesktop) return;
        let alive = true;
        Promise.all([host.isMaximized(), host.isFullscreen()]).then(([maximized, fullscreen]) => alive && setState(s => ({ ...s, maximized, fullscreen }))).catch(() => undefined);
        const off = host.onWindowStateChanged(next => setState(next));
        return () => {
            alive = false;
            off();
        };
    }, []);
    if (!isDesktop || host.platform === 'darwin') return null;
    const base = 'no-drag grid h-8 w-[46px] place-items-center text-white/60 transition-colors duration-150 hover:text-white';
    return (
        <div className={cx('fixed right-0 top-0 z-[120] flex overflow-hidden rounded-bl-xl transition-opacity duration-300', revealed ? 'opacity-100' : state.focused ? 'opacity-40' : 'opacity-25')}>
            <button type="button" aria-label="最小化" title="最小化" className={cx(base, 'hover:bg-white/10')} onClick={() => host.minimize()}>
                <Minus className="h-4 w-4" strokeWidth={1.6} />
            </button>
            {state.fullscreen ? (
                <button type="button" aria-label="退出全屏" title="退出全屏 (F11)" className={cx(base, 'hover:bg-white/10')} onClick={() => host.toggleFullscreen()}>
                    <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
            ) : (
                <button type="button" aria-label={state.maximized ? '还原' : '最大化'} title={state.maximized ? '还原' : '最大化'} className={cx(base, 'hover:bg-white/10')} onClick={() => host.toggleMaximize()}>
                    {state.maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" strokeWidth={1.6} /> : <Square className="h-3 w-3" strokeWidth={1.8} />}
                </button>
            )}
            <button type="button" aria-label="关闭" title="关闭" className={cx(base, 'hover:bg-[#e81123] hover:text-white')} onClick={() => host.close()}>
                <X className="h-4 w-4" strokeWidth={1.6} />
            </button>
        </div>
    );
}
