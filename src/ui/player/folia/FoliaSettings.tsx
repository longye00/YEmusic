/** 把 Folia 各动画自带的“细调面板”（registry 的 renderSettingsPanel）嵌进 YEmusic 的歌词设置里。按需加载。 */
import '@/folia/i18n';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { colorWithAlpha } from '@/folia/components/visualizer/colorMix';
import type { VisualizerSettingsPanelProps } from '@/folia/components/visualizer/definition';
import { getVisualizerRegistryEntry } from '@/folia/components/visualizer/registry';
import { useFoliaTunings } from '@/store/foliaTunings';
import { useSettings } from '@/store/settings';
import type { Theme } from '../../theme';
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

    useEffect(() => { if (mode === 'monet') void portrait.load(); }, [mode, portrait.load]);

    if (!entry?.renderSettingsPanel) return <div className="py-2 text-center text-[11.5px] text-white/40">此动画没有可调参数</div>;

    const panelProps: VisualizerSettingsPanelProps = {
        t: key => t(key),
        isDaylight: false,
        theme: foliaTheme,
        controlCardBg: colorWithAlpha(foliaTheme.backgroundColor, 0.52),
        rangeInputClass: 'w-full accent-current text-white',
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
        <div className="space-y-3">
            {entry.tuningKind !== 'none' && (
                <button type="button" onClick={resetAll} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] text-[11.5px] text-white/65 hover:bg-white/[0.13] hover:text-white">
                    <RotateCcw className="h-3.5 w-3.5" />恢复此动画的默认参数
                </button>
            )}
            {entry.renderSettingsPanel(panelProps)}
        </div>
    );
}
