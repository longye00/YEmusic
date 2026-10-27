/** 读取剪贴板里的文字：先走浏览器接口，被拒绝（Android WebView 常见）就走原生；都不行抛错，由调用方提示“长按输入框粘贴” */
import { host } from './host';

export async function readClipboardText(): Promise<string> {
    try {
        if (navigator.clipboard?.readText) {
            const text = await navigator.clipboard.readText();
            if (text) return text;
        }
    } catch { /* 权限被拒：改走原生 */ }
    if (host.readClipboard) return host.readClipboard();
    throw new Error('无法读取剪贴板');
}
