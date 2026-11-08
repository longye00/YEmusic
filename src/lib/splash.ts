// 启动遮罩的收尾：React 挂载后等够最短展示时长再淡出，太快加载也不闪一下。
// 遮罩本体是 index.html 的静态节点，由 public/splash.js 做随机化与跳过。

const MIN_SHOW_MS = 1200;
const MIN_SHOW_REDUCED_MS = 0;

declare global {
    interface Window {
        __yeSplashStart?: number;
        __yeHideSplash?: (immediate?: boolean) => void;
    }
}

let done = false;

/** 首屏挂载后调用一次；遮罩不存在（设置关 / 已隐藏）时是空操作。幂等。 */
export function hideSplash() {
    if (done) return;
    done = true;
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    const reduced = splash.classList.contains('is-reduced') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const min = reduced ? MIN_SHOW_REDUCED_MS : MIN_SHOW_MS;
    const elapsed = performance.now() - (window.__yeSplashStart ?? 0);
    const wait = Math.max(0, min - elapsed);
    setTimeout(() => window.__yeHideSplash?.(), wait);
}
