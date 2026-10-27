/**
 * Folia 歌词动画的宿主：把 YEmusic 的歌词 / 主题 / 播放状态 / 设置，翻译成 Folia 的 VisualizerRenderer 需要的 props。
 * 整个文件（连同 src/folia 下的动画代码）都是按需加载的分包，只有选了 Folia 动画才会下载。
 */
import '@/folia/i18n';
import { useEffect, useMemo, useState } from 'react';
import VisualizerRenderer from '@/folia/components/visualizer/VisualizerRenderer';
import type { VisualizerSharedProps } from '@/folia/components/visualizer/definition';
import type { VisualizerTuningBundle } from '@/folia/components/visualizer/tuningRegistry';
import { useStatusMessageStore } from '@/folia/stores/useStatusMessageStore';
import { host } from '@/lib/host';
import type { ParsedLyric } from '@/lib/lyric';
import { seek, usePlayer } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useFoliaTunings } from '@/store/foliaTunings';
import { toast } from '@/store/toast';
import { useUi } from '@/store/ui';
import { useCover } from '../../hooks';
import type { Theme } from '../../theme';
import { EMPTY_LINES, toFoliaLines } from './lyricsAdapter';
import { toFoliaTheme } from './foliaTheme';
import { useMonetPortrait } from './monetPortrait';
import type { FoliaModeId } from './modes';
import { audioBands, audioPower, lyricClock, useFoliaSignals } from './signals';

/** 远程封面没有 CORS 头，WebGL 纹理 / 画布读取会失败：经宿主取回字节，换成同源的 blob 地址 */
function useCanvasSafeCover(url?: string): string | undefined {
    const [safe, setSafe] = useState<string | undefined>();
    useEffect(() => {
        if (!url) { setSafe(undefined); return; }
        if (!/^https?:/i.test(url) || /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(url)) { setSafe(url); return; }
        let alive = true;
        let objectUrl: string | undefined;
        setSafe(undefined);
        host.fetchImage({ url }).then(res => {
            if (!alive || !res.ok || !res.bytes) return;
            objectUrl = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.headers?.['content-type'] || 'image/jpeg' }));
            setSafe(objectUrl);
        }).catch(() => {});
        return () => {
            alive = false;
            if (objectUrl) { const stale = objectUrl; setTimeout(() => URL.revokeObjectURL(stale), 4000); }
        };
    }, [url]);
    return safe;
}

/** Folia 内部通过“状态消息”通道提示（导入图片失败等），转给 YEmusic 的 toast */
function useStatusBridge() {
    useEffect(() => {
        const forward = (message: { type: 'error' | 'success' | 'info'; text: string } | null) => {
            if (!message?.text) return;
            toast(message.text, message.type === 'error' ? 'error' : message.type === 'success' ? 'success' : 'info');
            useStatusMessageStore.getState().setMessage(null);
        };
        forward(useStatusMessageStore.getState().message);
        return useStatusMessageStore.subscribe(state => forward(state.message));
    }, []);
}

export interface FoliaLyricsProps {
    mode: FoliaModeId;
    lyric: ParsedLyric;
    theme: Theme;
}

export default function FoliaLyrics({ mode, lyric, theme }: FoliaLyricsProps) {
    const current = usePlayer(s => s.current);
    const coverRaw = usePlayer(s => s.coverUrl);
    const status = usePlayer(s => s.status);
    const panelOpen = useUi(s => s.panelOpen);
    const font = useSettings(s => s.lyricFont);
    const intensity = useSettings(s => s.lyricIntensity);
    const scale = useSettings(s => s.lyricScale);
    const showTranslation = useSettings(s => s.showTranslation);
    const showRoma = useSettings(s => s.showRoma);
    const reduceMotion = useSettings(s => s.reduceMotion);
    const tunings = useFoliaTunings(s => s.tunings);
    const patchTuning = useFoliaTunings(s => s.patch);
    const portrait = useMonetPortrait(s => s.image);
    const loadPortrait = useMonetPortrait(s => s.load);
    const cover = useCanvasSafeCover(useCover(coverRaw || current?.cover));

    useStatusBridge();
    useEffect(() => { void loadPortrait(); }, [loadPortrait]);

    const lines = useMemo(() => (lyric.lines.length ? toFoliaLines(lyric) : EMPTY_LINES), [lyric]);
    const currentLineIndex = useFoliaSignals(lines);
    const foliaTheme = useMemo(() => toFoliaTheme(theme, font, intensity), [theme, font, intensity]);
    const bundle = useMemo<VisualizerTuningBundle>(() => ({ ...tunings }), [tunings]);

    const handlers = useMemo(() => ({
        onMonetTuningChange: (patch: object) => patchTuning('monet', patch),
        onCladdaghTuningChange: (patch: object) => patchTuning('claddagh', patch),
        onPendoloTuningChange: (patch: object) => patchTuning('pendolo', patch),
        onSonnetTuningChange: (patch: object) => patchTuning('sonnet', patch),
        onTemperaTuningChange: (patch: object) => patchTuning('tempera', patch),
        onLumiereTuningChange: (patch: object) => patchTuning('lumiere', patch),
    }), [patchTuning]);

    const showAny = showTranslation || showRoma;
    const props: VisualizerSharedProps = {
        currentTime: lyricClock,
        currentLineIndex,
        lines,
        theme: foliaTheme,
        isDaylight: false,
        audioPower,
        audioBands,
        showText: true,
        songTitle: current?.name ?? null,
        songArtist: current?.singer ?? null,
        songAlbum: current?.album ?? null,
        coverUrl: cover ?? null,
        seed: current?.id,
        staticMode: reduceMotion,
        backgroundStaticMode: reduceMotion,
        paused: status !== 'playing',
        visualizerOpacity: 1,
        lyricsFontScale: scale,
        subtitleFontScale: 1,
        showSubtitleTranslation: showAny,
        subtitleContentMode: showTranslation && showRoma ? 'both' : showTranslation ? 'translation' : showRoma ? 'romanization' : 'none',
        // YEmusic 的底部胶囊空闲时只是变淡、并不消失，字幕始终停在它上方，避免和胶囊重叠
        isPlayerChromeHidden: false,
        isPanelOpen: panelOpen,
        // 歌词时钟 = 音频时间 + 偏移，点歌词跳转时要减回去
        onLyricLineSeek: lyricTime => seek(Math.max(0, lyricTime - useSettings.getState().lyricOffset / 1000)),
        monetPortraitImage: portrait,
        visualizerTunings: bundle,
        ...handlers,
    };

    return (
        <div className="absolute inset-0">
            <VisualizerRenderer mode={mode} {...props} />
        </div>
    );
}
