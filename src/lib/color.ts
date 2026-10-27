/** 封面取色：k-means 聚类得到调色板，用于流体背景与强调色。 */
import { host } from './host';

export interface Palette {
    colors: [number, number, number][];
    /** 背景用的深色基调 */
    base: [number, number, number];
    /** 高亮/强调色（保证在深色背景上可读） */
    accent: [number, number, number];
    isLight: boolean;
}

const cache = new Map<string, Promise<Palette | null>>();

export const DEFAULT_PALETTE: Palette = {
    colors: [[38, 38, 52], [92, 82, 140], [30, 64, 110], [160, 150, 200]],
    base: [12, 12, 18],
    accent: [196, 181, 253],
    isLight: false,
};

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
    if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round) as [number, number, number];
    const hue = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map(v => Math.round(v * 255)) as [number, number, number];
}

export const rgbCss = (c: [number, number, number], alpha = 1) => (alpha >= 1 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`);

const luminance = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

async function loadBitmap(url: string): Promise<ImageBitmap | HTMLImageElement> {
    let src = url;
    let revoke = false;
    if (/^https?:/i.test(url) && !/^https?:\/\/127\.0\.0\.1/.test(url)) {
        const res = await host.fetchImage({ url });
        if (!res.ok || !res.bytes) throw new Error(res.error || `HTTP ${res.status}`);
        src = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.headers?.['content-type'] || 'image/jpeg' }));
        revoke = true;
    }
    try {
        const img = new Image();
        img.decoding = 'async';
        img.crossOrigin = 'anonymous';
        img.src = src;
        await img.decode();
        return img;
    } finally {
        if (revoke) setTimeout(() => URL.revokeObjectURL(src), 1000);
    }
}

function kmeans(pixels: [number, number, number][], k: number) {
    let centers = pixels.filter((_, i) => i % Math.max(1, Math.floor(pixels.length / k)) === 0).slice(0, k).map(p => [...p] as [number, number, number]);
    const counts = new Array(centers.length).fill(0);
    for (let iter = 0; iter < 8; iter++) {
        const sums = centers.map(() => [0, 0, 0]);
        counts.fill(0);
        for (const p of pixels) {
            let best = 0;
            let bestD = Infinity;
            for (let c = 0; c < centers.length; c++) {
                const d = (p[0] - centers[c][0]) ** 2 + (p[1] - centers[c][1]) ** 2 + (p[2] - centers[c][2]) ** 2;
                if (d < bestD) { bestD = d; best = c; }
            }
            sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2];
            counts[best]++;
        }
        centers = centers.map((c, i) => (counts[i] ? [sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]] : c) as [number, number, number]);
    }
    return centers.map((c, i) => ({ color: c.map(Math.round) as [number, number, number], count: counts[i] })).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
}

export async function extractPalette(url: string | undefined | null): Promise<Palette | null> {
    if (!url) return null;
    if (!cache.has(url)) {
        cache.set(url, (async () => {
            try {
                const img = await loadBitmap(url);
                const size = 40;
                const canvas = new OffscreenCanvas(size, size);
                const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
                ctx.drawImage(img as CanvasImageSource, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;
                const pixels: [number, number, number][] = [];
                for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) pixels.push([data[i], data[i + 1], data[i + 2]]);
                if (!pixels.length) return null;
                const clusters = kmeans(pixels, 6);
                const colors = clusters.map(c => c.color);
                const avgLum = pixels.reduce((s, p) => s + luminance(p), 0) / pixels.length;
                // 强调色：在占比不太小的颜色里挑饱和度最高的，再提亮到可读
                const scored = clusters
                    .filter(c => c.count > pixels.length * 0.04)
                    .map(c => ({ c: c.color, score: rgbToHsl(c.color)[1] * (0.4 + Math.min(1, c.count / pixels.length) * 0.6) }))
                    .sort((a, b) => b.score - a.score);
                const pick = scored[0]?.c || colors[0];
                const [h, s] = rgbToHsl(pick);
                const accent = hslToRgb([h, Math.max(0.45, Math.min(0.9, s + 0.15)), 0.72]);
                const [bh, bs] = rgbToHsl(colors[0]);
                const base = hslToRgb([bh, Math.min(0.5, bs), 0.09]);
                while (colors.length < 4) colors.push(colors[colors.length - 1] || [60, 60, 80]);
                return { colors, base, accent, isLight: avgLum > 0.6 } satisfies Palette;
            } catch {
                return null;
            }
        })());
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
    }
    return cache.get(url)!;
}
