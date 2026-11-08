/**
 * 「重新获取 / 导入 .lrc / 歌词来源文案」三件套的共享实现：
 * 播放页右下面板的歌词页签与歌词样式窗口的「歌词来源」分组各摆各的样式，逻辑在这里共用。
 */
import { useRef } from 'react';
import { FileUp, RefreshCw } from 'lucide-react';
import { saveCustomLyric } from '@/player/lyrics';
import { reloadLyric, setLyric, usePlayer } from '@/store/player';
import { toast } from '@/store/toast';
import { Spinner } from '../components/common';

const FROM: Record<string, string> = {
    platform: '平台接口',
    source: '洛雪音源',
    match: '其他平台匹配',
    lrclib: 'LRCLIB',
    embedded: '内嵌歌词',
    sidecar: '同名 .lrc 文件',
    custom: '手动导入',
    none: '无',
};

/** 当前歌词来源的中文名（加载中显示「获取中…」） */
export function useLyricFromText(): string {
    const lyricState = usePlayer(p => p.lyricState);
    const lyricFrom = usePlayer(p => p.lyricFrom);
    return lyricState === 'loading' ? '获取中…' : FROM[lyricFrom] || lyricFrom || '无';
}

/** 导入 .lrc 的处理（utf-8 优先、退回 GBK 解码），给两边的文件输入框共用 */
async function importLrc(file: File) {
    const current = usePlayer.getState().current;
    if (!current) return;
    const buffer = new Uint8Array(await file.arrayBuffer());
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('gbk').decode(buffer); }
    setLyric(await saveCustomLyric(current, text), 'custom');
    toast('已导入歌词', 'success');
}

/**
 * 「重新获取」「导入 .lrc」两个按钮 + 隐藏的文件输入框。
 * 按钮样式由调用方给（面板是圆角块、样式窗口是 kit 小按钮）。
 */
export function LyricSourceButtons({ className, iconClass = 'h-3.5 w-3.5' }: { className: string; iconClass?: string }) {
    const lyricState = usePlayer(p => p.lyricState);
    const fileRef = useRef<HTMLInputElement>(null);
    return (
        <>
            <button type="button" onClick={() => reloadLyric()} className={className}>
                {lyricState === 'loading' ? <Spinner className={iconClass} /> : <RefreshCw className={iconClass} />}重新获取
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className={className}>
                <FileUp className={iconClass} />导入 .lrc
            </button>
            <input
                ref={fileRef}
                type="file"
                accept=".lrc,.txt"
                className="hidden"
                onChange={async event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) await importLrc(file);
                }}
            />
        </>
    );
}
