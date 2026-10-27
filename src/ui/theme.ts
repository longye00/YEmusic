/** 从封面调色板 / 自定义颜色 / 默认主题生成界面与流体背景配色 */
import { useMemo } from 'react';
import { hslToRgb, rgbToHsl, type Palette } from '@/lib/color';
import { useSettings } from '@/store/settings';

export type RGB = [number, number, number];

export interface Theme {
    /** 流体背景的四个颜色（暗 → 亮） */
    fluid: [RGB, RGB, RGB, RGB];
    accent: RGB;
    accentSoft: RGB;
    panel: RGB;
    base: RGB;
    name: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const tone = (c: RGB, s: number, l: number, sMul = 1): RGB => {
    const [h, cs] = rgbToHsl(c);
    return hslToRgb([h, clamp01(Math.max(cs * sMul, s)), l]);
};

export const MIDNIGHT: Theme = {
    fluid: [[14, 8, 40], [52, 18, 120], [104, 44, 186], [182, 120, 140]],
    accent: [200, 176, 255],
    accentSoft: [226, 214, 255],
    panel: [44, 26, 78],
    base: [12, 8, 26],
    name: 'Midnight 默认',
};

export function themeFromPalette(palette: Palette): Theme {
    const colors = palette.colors.length ? palette.colors : MIDNIGHT.fluid;
    const bySat = [...colors].sort((a, b) => rgbToHsl(b)[1] - rgbToHsl(a)[1]);
    const dominant = colors[0];
    const vivid = bySat[0];
    const second = colors[1] || vivid;
    const third = colors[2] || second;
    const fluid: Theme['fluid'] = [
        tone(dominant, 0.25, 0.08, 1.05),
        tone(second, 0.35, 0.24, 1.15),
        tone(vivid, 0.5, 0.42, 1.2),
        tone(third, 0.3, 0.6, 1.1),
    ];
    const [ah] = rgbToHsl(palette.accent);
    return {
        fluid,
        accent: palette.accent,
        accentSoft: hslToRgb([ah, 0.6, 0.86]),
        panel: tone(dominant, 0.22, 0.17),
        base: tone(dominant, 0.2, 0.06),
        name: '封面取色',
    };
}

export function themeFromHex(hex: string): Theme {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const rgb: RGB = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [138, 180, 255];
    const [h, s] = rgbToHsl(rgb);
    const sat = Math.max(0.35, s);
    return {
        fluid: [hslToRgb([h, sat * 0.7, 0.07]), hslToRgb([(h + 0.97) % 1, sat, 0.22]), hslToRgb([h, sat, 0.42]), hslToRgb([(h + 0.08) % 1, sat * 0.8, 0.62])],
        accent: hslToRgb([h, Math.min(0.95, sat + 0.1), 0.74]),
        accentSoft: hslToRgb([h, 0.6, 0.87]),
        panel: hslToRgb([h, sat * 0.5, 0.16]),
        base: hslToRgb([h, sat * 0.5, 0.06]),
        name: '自定义',
    };
}

export function useTheme(palette?: Palette | null): Theme {
    const mode = useSettings(s => s.theme);
    const custom = useSettings(s => s.customAccent);
    return useMemo(() => {
        if (mode === 'custom') return themeFromHex(custom);
        if (mode === 'cover' && palette) return themeFromPalette(palette);
        return MIDNIGHT;
    }, [mode, custom, palette]);
}

export const css = (c: RGB, alpha = 1) => (alpha >= 1 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`);
