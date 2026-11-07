/**
 * 全局悬浮提示（Folia 式）：取代浏览器原生的 title 提示，全站一套样式。
 *
 * - 只对鼠标生效（触屏没有悬停）；悬停 450ms 后出现，刚离开另一个提示后再悬停到相邻控件上则 120ms 即出现
 * - 读取 data-tip / title。title 里“标题（Ctrl K）”这类写法的括号部分渲染成键帽，换行之后的内容作为第二行
 * - 悬停期间把 title 暂存起来（避免与原生提示重复），离开 / 点击 / 滚动 / 按键 / 控件被移除时还回去
 * - 在控件下方居中；下方放不下就翻到上方；水平方向夹在窗口内
 * - 给元素加 data-tip-off 可以关掉它的提示
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keys, parseCombo, type KeyCombo } from './Kbd';

interface Tip {
    lines: string[];
    combo: KeyCombo | null;
    rect: DOMRect;
}

const SHOW_DELAY = 450;
const SWITCH_DELAY = 120;
const GAP = 8;
const MARGIN = 8;

function parseTip(raw: string): { lines: string[]; combo: KeyCombo | null } {
    const [first = '', ...rest] = raw.split('\n').map(line => line.trim()).filter(Boolean);
    const match = first.match(/^(.*?)\s*[（(]([^（()）]+)[）)]$/);
    const combo = match ? parseCombo(match[2]) : null;
    return { lines: [combo ? match![1] : first, ...rest].filter(Boolean), combo };
}

export function Tooltips() {
    const [tip, setTip] = useState<Tip | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = new WeakMap<HTMLElement, string>();
        let anchor: HTMLElement | null = null;
        let raw = '';
        let shown = false;
        let lastHide = 0;
        let timer = 0;
        let watch = 0;

        const restore = () => {
            if (anchor && saved.has(anchor)) {
                if (!anchor.hasAttribute('title')) anchor.setAttribute('title', saved.get(anchor)!);
                saved.delete(anchor);
            }
        };
        const hide = () => {
            window.clearTimeout(timer);
            window.clearInterval(watch);
            restore();
            if (shown) lastHide = Date.now();
            anchor = null;
            shown = false;
            setTip(null);
            setPos(null);
        };
        const show = () => {
            if (!anchor?.isConnected) return hide();
            shown = true;
            setPos(null);
            setTip({ ...parseTip(raw), rect: anchor.getBoundingClientRect() });
            window.clearInterval(watch);
            // 控件被移除（列表重绘）或鼠标已不在它上面时收起：被移除的元素不会再触发 pointerout
            watch = window.setInterval(() => {
                if (!anchor || !anchor.isConnected || !anchor.matches(':hover')) hide();
            }, 200);
        };

        const onOver = (event: PointerEvent) => {
            if (event.pointerType !== 'mouse' || event.buttons) return;
            const target = event.target as Element | null;
            let el = target?.closest?.('[data-tip], [title]') as HTMLElement | null;
            // 悬停期间 title 已被暂存，从按钮边缘移到它里面的图标时 closest 找不到东西，这时仍算在同一个控件上
            if (!el && anchor && target && anchor.contains(target)) el = anchor;
            if (el === anchor) return;
            if (anchor) hide();
            if (!el || el.hasAttribute('data-tip-off')) return;
            const text = el.getAttribute('data-tip') ?? el.getAttribute('title') ?? '';
            if (!text.trim()) return;
            if (el.hasAttribute('title')) {
                saved.set(el, el.getAttribute('title')!);
                el.removeAttribute('title');
            }
            anchor = el;
            raw = text;
            timer = window.setTimeout(show, Date.now() - lastHide < 300 ? SWITCH_DELAY : SHOW_DELAY);
        };
        const onOut = (event: PointerEvent) => {
            if (!anchor) return;
            const to = event.relatedTarget as Node | null;
            if (to && anchor.contains(to)) return;
            hide();
        };

        document.addEventListener('pointerover', onOver, true);
        document.addEventListener('pointerout', onOut, true);
        document.addEventListener('pointerdown', hide, true);
        document.addEventListener('keydown', hide, true);
        document.addEventListener('wheel', hide, { capture: true, passive: true });
        document.addEventListener('scroll', hide, { capture: true, passive: true });
        document.addEventListener('contextmenu', hide, true);
        window.addEventListener('blur', hide);
        return () => {
            hide();
            document.removeEventListener('pointerover', onOver, true);
            document.removeEventListener('pointerout', onOut, true);
            document.removeEventListener('pointerdown', hide, true);
            document.removeEventListener('keydown', hide, true);
            document.removeEventListener('wheel', hide, true);
            document.removeEventListener('scroll', hide, true);
            document.removeEventListener('contextmenu', hide, true);
            window.removeEventListener('blur', hide);
        };
    }, []);

    // 量出提示框的尺寸后再定位：先在屏外渲染一帧
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!tip || !box) return;
        const { width, height } = box.getBoundingClientRect();
        const { rect } = tip;
        const below = rect.bottom + GAP + height <= window.innerHeight - MARGIN;
        const top = below ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - height);
        const left = Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, rect.left + rect.width / 2 - width / 2));
        setPos({ left: Math.round(left), top: Math.round(top) });
    }, [tip]);

    if (!tip) return null;
    const [title, ...extra] = tip.lines;
    return (
        <div
            ref={boxRef}
            role="tooltip"
            className="ye-tip"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}
        >
            <div className="min-w-0">
                {title && <div className="ye-tip-title">{title}</div>}
                {extra.map((line, i) => <div key={i} className="ye-tip-extra">{line}</div>)}
            </div>
            {tip.combo && <Keys combos={[tip.combo]} />}
        </div>
    );
}
