/** YEmusic 主题（封面取色 / 自定义 / Midnight）→ Folia 的 Theme（颜色为 #rrggbb 字符串）。 */
import type { Theme as FoliaTheme } from '@/folia/types';
import type { LyricIntensity } from '@/store/settings';
import type { RGB, Theme } from '../../theme';

const hex = (c: RGB) => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function toFoliaTheme(theme: Theme, font: 'sans' | 'serif', intensity: LyricIntensity): FoliaTheme {
    return {
        name: theme.name,
        backgroundColor: hex(theme.base),
        // 正文用浅色调，强调色用饱和的取色，次要文字（翻译 / 未唱到的行）是浅色向底色的混合
        primaryColor: hex(theme.accentSoft),
        accentColor: hex(theme.accent),
        secondaryColor: hex(mix(theme.accentSoft, theme.base, 0.5)),
        fontStyle: font,
        animationIntensity: intensity,
    };
}
