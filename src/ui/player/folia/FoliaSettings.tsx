/** 把 Folia 各动画自带的“细调面板”（registry 的 renderSettingsPanel）嵌进 YEmusic 的歌词设置里。按需加载。 */
import '@/folia/i18n';
import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import type { VisualizerSettingsPanelProps } from '@/folia/components/visualizer/definition';
import { getVisualizerRegistryEntry } from '@/folia/components/visualizer/registry';
import { useFoliaTunings } from '@/store/foliaTunings';
import { useSettings } from '@/store/settings';
import type { Theme } from '../../theme';
import { css } from '../../theme';
import { toFoliaTheme } from './foliaTheme';
import { useMonetPortrait } from './monetPortrait';
import type { FoliaModeId } from './modes';

export default function FoliaSettings({ mode, theme }: { mode: FoliaModeId; theme: Theme }) {
    const { t } = useTranslation();
    const font = useSettings(s => s.lyricFont);
    const intensity = useSettings(s => s.lyricIntensity);
    const tunings = useFoliaTunings(s => s.tunings);
    const patch = useFoliaTunings(s => s.patch);
    const reset = useFoliaTunings(s => s.reset);
    const portrait = useMonetPortrait();
    const entry = getVisualizerRegistryEntry(mode);
    const foliaTheme = useMemo(() => toFoliaTheme(theme, font, intensity), [theme, font, intensity]);

    /**
     * Folia 的面板按 --text-primary / --text-secondary 两个 CSS 变量取字色，YEmusic 从来没有定义过它们，
     * 于是面板里的文字全部退回浏览器默认（偏灰、和主题不搭）。这里按当前主题补上，只作用于这个面板内部。
     * range 输入框一并换成 YEmusic 的音量条样式（细轨道 + 主题色填充 + 白色圆点）。
     */
    const panelVars = useMemo(() => ({
        '--text-primary': css(theme.accentSoft),
        '--text-secondary': css(theme.accentSoft, 0.62),
        '--folia-range-accent': css(theme.accent),
    }) as CSSProperties, [theme]);

    const rootRef = useRef<HTMLDivElement>(null);

    /**
     * 滑杆的填充宽度要按当前值写进 CSS 变量（CSS 读不到 input 的 value）。
     * 在这里统一同步：挂载、拖动、以及面板参数被别处改掉时。
     */
    const syncRanges = useCallback(() => {
        for (const input of rootRef.current?.querySelectorAll<HTMLInputElement>('.ye-folia-range') ?? []) {
            const min = Number(input.min) || 0;
            const max = Number(input.max) || 1;
            const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
            input.style.setProperty('--ye-range-pct', `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`);
        }
    }, []);

    useEffect(() => {
        const root = rootRef.current;
        syncRanges();
        if (!root) return;
        root.addEventListener('input', syncRanges);
        root.addEventListener('change', syncRanges);
        return () => {
            root.removeEventListener('input', syncRanges);
            root.removeEventListener('change', syncRanges);
        };
    }, [syncRanges, mode, tunings]);

    useEffect(() => { if (mode === 'monet') void portrait.load(); }, [mode, portrait.load]);

    if (!entry?.renderSettingsPanel) return <div className="py-2 text-center text-[11.5px] text-white/40">此动画没有可调参数</div>;

    const panelProps: VisualizerSettingsPanelProps = {
        t: key => t(key),
        isDaylight: false,
        theme: foliaTheme,
        controlCardBg: 'rgb(255 255 255 / 0.03)',
        rangeInputClass: 'ye-folia-range',
        monetTuning: tunings.monet,
        onMonetTuningChange: p => patch('monet', p),
        monetPortraitImage: portrait.image,
        onUploadMonetPortraitImage: portrait.upload,
        onClearMonetPortraitImage: portrait.clear,
        isLoadingMonetPortraitImage: portrait.loading,
        claddaghTuning: tunings.claddagh,
        onCladdaghTuningChange: p => patch('claddagh', p),
        dioramaTuning: tunings.diorama,
        onDioramaTuningChange: p => patch('diorama', p),
        pendoloTuning: tunings.pendolo,
        onPendoloTuningChange: p => patch('pendolo', p),
        sonnetTuning: tunings.sonnet,
        onSonnetTuningChange: p => patch('sonnet', p),
        temperaTuning: tunings.tempera,
        onTemperaTuningChange: p => patch('tempera', p),
        lumiereTuning: tunings.lumiere,
        onLumiereTuningChange: p => patch('lumiere', p),
    };

    const resetAll = () => entry.resetSettings?.({
        resetMonetTuning: () => reset('monet'),
        resetCladdaghTuning: () => reset('claddagh'),
        resetDioramaTuning: () => reset('diorama'),
        resetPendoloTuning: () => reset('pendolo'),
        resetSonnetTuning: () => reset('sonnet'),
        resetTemperaTuning: () => reset('tempera'),
        resetLumiereTuning: () => reset('lumiere'),
    });

    return (
        <div className="space-y-3" style={panelVars} ref={rootRef}>
            {entry.tuningKind !== 'none' && (
                <button type="button" onClick={resetAll} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] text-[11.5px] text-white/65 hover:bg-white/[0.13] hover:text-white">
                    <RotateCcw className="h-3.5 w-3.5" />恢复此动画的默认参数
                </button>
            )}
            {entry.renderSettingsPanel(panelProps)}
        </div>
    );
}
