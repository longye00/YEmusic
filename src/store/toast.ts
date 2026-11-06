import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';
export interface Toast {
    id: number;
    /** 一行人话标题 */
    message: string;
    /** 可展开的技术详情（错误原因、接口返回等） */
    detail?: string;
    kind: ToastKind;
    key?: string;
    action?: { label: string; run: () => void };
}

export interface ToastOptions {
    duration?: number;
    action?: Toast['action'];
    /** 相同 key 的提示视为同一类，合并为一条（如音量、连续的播放失败） */
    key?: string;
    detail?: string;
}

interface ToastState {
    /** 单槽：同一时刻只显示一条，新提示替换旧提示 */
    toasts: Toast[];
    push(message: string, kind?: ToastKind, options?: ToastOptions): void;
    dismiss(id: number): void;
    /** 用户展开详情 / 悬停时暂停自动消失 */
    hold(id: number): void;
    release(id: number): void;
}

let nextId = 1;
const timers = new Map<number, { timer: ReturnType<typeof setTimeout>; duration: number }>();

const schedule = (id: number, duration: number) => {
    const old = timers.get(id);
    if (old) clearTimeout(old.timer);
    timers.set(id, { duration, timer: setTimeout(() => useToasts.getState().dismiss(id), duration) });
};

export const useToasts = create<ToastState>((set, get) => ({
    toasts: [],
    push(message, kind = 'info', options = {}) {
        const current = get().toasts[0];
        const duration = options.duration ?? (kind === 'error' ? 5000 : 2800);
        // 同一句话再次出现：不闪烁，只续时
        if (current && current.message === message && current.kind === kind) {
            schedule(current.id, duration);
            return;
        }
        const id = nextId++;
        // 同 key 原地替换（保持同一个 React key，不重复播放入场动画）
        const sameKind = Boolean(options.key && current?.key === options.key);
        if (current) {
            const old = timers.get(current.id);
            if (old) clearTimeout(old.timer);
            timers.delete(current.id);
        }
        set({ toasts: [{ id, message, detail: options.detail, kind, key: options.key ?? (sameKind ? current?.key : undefined), action: options.action }] });
        schedule(id, duration);
    },
    dismiss(id) {
        const old = timers.get(id);
        if (old) clearTimeout(old.timer);
        timers.delete(id);
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    },
    hold(id) {
        const old = timers.get(id);
        if (old) clearTimeout(old.timer);
    },
    release(id) {
        const old = timers.get(id);
        if (old && get().toasts.some(t => t.id === id)) schedule(id, Math.max(1800, old.duration * 0.6));
    },
}));

export const toast = (message: string, kind: ToastKind = 'info', options?: ToastOptions) => useToasts.getState().push(message, kind, options);
