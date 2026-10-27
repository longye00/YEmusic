/**
 * 精简模式：Android（以及 Chrome 111 以前的旧版系统 WebView）上默认开启，
 * 去掉毛玻璃、背景降帧降分辨率、书签翻页改为淡入，换取流畅度。设置 → 外观里可以手动开关。
 */
import { useSettings, type LiteMode } from '@/store/settings';
import { isAndroid } from './host';

/** 内核（Chromium / Android System WebView）主版本号，识别不出来返回 0 */
export function chromeMajor(): number {
    const match = /(?:Chrome|Chromium)\/(\d+)/.exec(typeof navigator === 'undefined' ? '' : navigator.userAgent);
    return match ? Number(match[1]) : 0;
}

/** 太老的 WebView（< Chrome 111）缺少 color-mix()、oklch() 等较新的 CSS 能力，性能通常也更差 */
export const OLD_WEBVIEW = (() => {
    const major = chromeMajor();
    return major > 0 && major < 111;
})();

export function resolveLite(mode: LiteMode): boolean {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return isAndroid || OLD_WEBVIEW;
}

export const isLite = () => resolveLite(useSettings.getState().liteMode);

/** 当前是否处于精简模式（随设置变化） */
export function useLite(): boolean {
    return useSettings(s => resolveLite(s.liteMode));
}

/** 在 <html> 上同步 `lite` 类（CSS 里用 `.lite …` / `lite:` 变体区分），启动时立即生效，之后跟随设置 */
function sync() {
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('lite', isLite());
}
sync();
let last = useSettings.getState().liteMode;
useSettings.subscribe(state => {
    if (state.liteMode === last) return;
    last = state.liteMode;
    sync();
});
