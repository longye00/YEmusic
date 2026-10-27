/** 莫奈动画的自定义肖像图：图片本体存 IndexedDB（Folia 的 monetPortraitImage 服务），这里只管对象 URL 与加载状态。 */
import { create } from 'zustand';
import type { MonetPortraitImage } from '@/folia/types';
import {
    buildStoredMonetPortraitImage,
    clearMonetPortraitImage,
    getMonetPortraitImage,
    isSupportedMonetPortraitFile,
    saveMonetPortraitImage,
} from '@/folia/services/monetPortraitImage';

interface PortraitState {
    image: MonetPortraitImage | null;
    loading: boolean;
    loaded: boolean;
    load(): Promise<void>;
    upload(files: File[]): Promise<{ ok: boolean; error?: string }>;
    clear(): Promise<void>;
}

const toImage = (stored: { id: string; name: string; blob: Blob }): MonetPortraitImage => ({ id: stored.id, name: stored.name, url: URL.createObjectURL(stored.blob) });

export const useMonetPortrait = create<PortraitState>((set, get) => ({
    image: null,
    loading: false,
    loaded: false,
    async load() {
        if (get().loaded || get().loading) return;
        set({ loading: true });
        try {
            const stored = await getMonetPortraitImage();
            set({ image: stored ? toImage(stored) : null, loaded: true });
        } catch {
            set({ loaded: true });
        } finally {
            set({ loading: false });
        }
    },
    async upload(files) {
        const file = files[0];
        if (!file) return { ok: false, error: '没有选择文件' };
        if (!isSupportedMonetPortraitFile(file)) return { ok: false, error: '不支持的图片格式' };
        set({ loading: true });
        try {
            const stored = buildStoredMonetPortraitImage(file);
            await saveMonetPortraitImage(stored);
            const previous = get().image;
            set({ image: toImage(stored), loaded: true });
            if (previous) URL.revokeObjectURL(previous.url);
            return { ok: true };
        } catch (error) {
            return { ok: false, error: (error as Error).message || '保存失败' };
        } finally {
            set({ loading: false });
        }
    },
    async clear() {
        const previous = get().image;
        await clearMonetPortraitImage().catch(() => {});
        set({ image: null });
        if (previous) URL.revokeObjectURL(previous.url);
    },
}));
