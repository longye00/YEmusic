/**
 * 歌词时钟来源。原先 Luminous / Flow / Folia 各自散写 `engine.currentTime + lyricOffset / 1000`，
 * 歌词样式窗口的预览需要另一套时钟（内置样例的循环时钟、可冻结的实时时钟），
 * 所以统一收进这个 Context：默认实现就是播放器，预览在渲染器外面包一层 Provider 换掉。
 */
import { createContext, useContext } from 'react';
import { engine } from '@/player/engine';
import { seek } from '@/store/player';
import { useSettings } from '@/store/settings';

export interface LyricTimeSource {
    /** 当前歌词时间（秒，已含用户设置的歌词偏移） */
    now(): number;
    /** 时钟是否在走；false 时动画给出静止 / 呼吸的画面（对应 Folia 的 paused） */
    playing(): boolean;
    /** 点歌词行跳转：把歌词时间换算成媒体时间再 seek；预览时钟不提供 */
    seek?(lyricTime: number): void;
}

/** 播放器的歌词时钟 = 音频时间 + 歌词偏移（沿用原先的散写公式，行为不变） */
export const engineLyricTime: LyricTimeSource = {
    now: () => engine.currentTime + useSettings.getState().lyricOffset / 1000,
    playing: () => engine.playing,
    seek: lyricTime => seek(Math.max(0, lyricTime - useSettings.getState().lyricOffset / 1000)),
};

export const LyricTimeContext = createContext<LyricTimeSource>(engineLyricTime);

/** 渲染器读歌词时间的唯一入口（rAF 循环里每次调用，offset 改动即时生效，不必重启循环） */
export function useLyricTime(): LyricTimeSource {
    return useContext(LyricTimeContext);
}
