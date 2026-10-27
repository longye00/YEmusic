import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';
export interface Toast { id: number; message: string; kind: ToastKind; key?: string; action?: { label: string; run: () => void } }

export interface ToastOptions { duration?: number; action?: Toast['action']; /** 相同 key 的提示原地替换（如音量） */ key?: string }

interface ToastState {
    toasts: Toast[];
    push(message: string, kind?: ToastKind, options?: ToastOptions): void;
    dismiss(id: number): void;
}

let nextId = 1;
export const useToasts = create<ToastState>((set, get) => ({
    toasts: [],
    push(message, kind = 'info', options = {}) {
        const id = nextId++;
        // 相同内容的提示不重复堆叠
        const existing = get().toasts.find(t => t.message === message);
        if (existing) return;
        const keyed = options.key ? get().toasts.find(t => t.key === options.key) : undefined;
        if (keyed) set(state => ({ toasts: state.toasts.map(t => (t === keyed ? { id, message, kind, key: options.key, action: options.action } : t)) }));
        else set(state => ({ toasts: [...state.toasts.slice(-3), { id, message, kind, key: options.key, action: options.action }] }));
        setTimeout(() => get().dismiss(id), options.duration ?? (kind === 'error' ? 5000 : 2800));
    },
    dismiss(id) {
        set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    },
}));

export const toast = (message: string, kind: ToastKind = 'info', options?: ToastOptions) => useToasts.getState().push(message, kind, options);
