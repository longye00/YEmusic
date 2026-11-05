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

/** 空格分隔的 RGB 三元组，供 CSS 里的 `rgb(var(--accent) / .2)` 使用（不能带逗号或 rgb() 外壳） */
const triple = (c: RGB) => `${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}`;

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 浮层的最深底色：接近纯黑，带一点主题色，避免六个浮层各写一个不相干的暗色 */
const INK: RGB = [9, 9, 13];

/**
 * 浮层表面的语义色阶（借 Folia 的 --st-fill / --st-raise 思路：一处定义，处处引用）。
 *
 * 原先每个浮层各写一个暗色 —— Modal rgba(23,22,31)、设置 rgba(20,19,25)、
 * 右键菜单 rgba(29,27,38)、Toast rgba(28,27,36)、搜索 rgba(9,9,13)、筛选条 rgba(26,26,25)，
 * 六个颜色互不相干，也都不跟随主题。这里统一由 theme.panel 向 INK 混合派生，
 * 层级越靠上越亮，且换封面 / 自定义主色时整组一起变。
 *
 * | 变量 | 用途 | 混合比例 |
 * |---|---|---|
 * | --surface-overlay | 铺满全屏的浮层（搜索） | panel 10% |
 * | --surface-card | 居中卡片（对话框、设置） | panel 22% |
 * | --surface-float | 贴边浮层（右键菜单、Toast、筛选条） | panel 28% |
 * | --surface-input | 浮层里的输入控件（下拉框） | panel 18%，不透明 |
 */
export function surfaceTokens(theme: Theme): Record<string, string> {
    return {
        '--surface-overlay': css(mixRGB(INK, theme.panel, 0.10), 0.88),
        '--surface-card': css(mixRGB(INK, theme.panel, 0.22), 0.95),
        '--surface-float': css(mixRGB(INK, theme.panel, 0.28), 0.95),
        '--surface-input': css(mixRGB(INK, theme.panel, 0.18)),
    };
}

/**
 * 把当前主题写入 :root 的 CSS 变量（--accent / --accent-soft / --base / --panel 与浮层表面色阶）。
 *
 * index.css 里乐库拼贴墙的辉光、特殊角标、书签焦点环、::selection 都读这几个变量，
 * 但它们原先只在 :root 写死了一份紫色，没有任何 JS 去更新：换了封面取色 / 自定义主题之后，
 * 拼贴墙和焦点环仍是默认紫，与播放页的主题色明显分叉。这里统一对齐。
 */
export function syncThemeVars(theme: Theme) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement.style;
    root.setProperty('--accent', triple(theme.accent));
    root.setProperty('--accent-soft', triple(theme.accentSoft));
    root.setProperty('--base', triple(theme.base));
    root.setProperty('--panel', triple(theme.panel));
    // Folia 的动画参数面板按这两个变量取字色（见 ui/player/folia/FoliaSettings.tsx）
    root.setProperty('--text-primary', css(theme.accentSoft));
    root.setProperty('--text-secondary', css(theme.accentSoft, 0.62));
    for (const [name, value] of Object.entries(surfaceTokens(theme))) root.setProperty(name, value);
}
