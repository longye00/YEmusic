/**
 * Folia 歌词动画需要的“信号”：歌词时钟、当前行、音频分频段能量。
 * 与 Folia 一样放在模块级的 MotionValue 里（动画逐帧订阅，不触发 React 重渲染），
 * 由播放页里唯一的一个 rAF 循环写入（useFoliaSignals）。
 */
import { useEffect, useState } from 'react';
import { motionValue } from 'framer-motion';
import type { AudioBands, Line } from '@/folia/types';
import { engine } from '@/player/engine';
import { useSettings } from '@/store/settings';
import { findActiveLineIndex } from './lyricsAdapter';

/** 歌词时钟（秒）= 音频时间 + 歌词偏移，与 YEmusic 自带的 Luminous / Flow 一致 */
export const lyricClock = motionValue(0);
/** 低频能量，0..255 */
export const audioPower = motionValue(0);
export const audioBands: AudioBands = {
    bass: motionValue(0),
    lowMid: motionValue(0),
    mid: motionValue(0),
    vocal: motionValue(0),
    treble: motionValue(0),
    spectrum: motionValue<Uint8Array<ArrayBuffer>>(new Uint8Array(0)),
};

// 与 Folia 的 usePlaybackVisualizerBridge 相同的分频段与压缩曲线
const compress = (value: number, boost: number) => Math.pow(value / 255, boost) * 255;

function sampleAudio(playing: boolean) {
    const fine = playing ? engine.fineSpectrum() : null;
    if (fine) {
        const { data, binHz } = fine;
        const energy = (minHz: number, maxHz: number) => {
            const start = Math.floor(minHz / binHz);
            const end = Math.min(data.length - 1, Math.floor(maxHz / binHz));
            let sum = 0;
            for (let i = start; i <= end; i++) sum += data[i];
            const count = end - start + 1;
            return count > 0 ? sum / count : 0;
        };
        const bass = energy(20, 150);
        const lowMid = energy(150, 400);
        const mid = energy(400, 1200);
        const vocal = energy(1000, 3500);
        const treble = energy(3500, 12000);
        audioBands.spectrum?.set(data.slice());
        audioPower.set(compress((bass + lowMid) / 2, 3));
        audioBands.bass.set(compress(bass, 1.8));
        audioBands.lowMid.set(compress(lowMid, 2));
        audioBands.mid.set(compress(mid, 2));
        audioBands.vocal.set(compress(vocal, 1.5));
        audioBands.treble.set(compress(treble, 2));
    } else {
        // 没在出声：缓慢“呼吸”，让画面不死板（与 Folia 相同）
        const breath = (Math.sin(Date.now() / 2000) + 1) * 20;
        audioPower.set(breath);
        audioBands.bass.set(breath);
        audioBands.lowMid.set(breath);
        audioBands.mid.set(breath);
        audioBands.vocal.set(breath);
        audioBands.treble.set(breath);
        audioBands.spectrum?.set(new Uint8Array(0));
    }
}

/** 启动 rAF 循环，返回当前行下标（仅在换行时触发 React 更新） */
export function useFoliaSignals(lines: Line[]): number {
    const [index, setIndex] = useState(-1);
    useEffect(() => {
        let frame = 0;
        let last = -2;
        const tick = () => {
            frame = requestAnimationFrame(tick);
            const time = engine.currentTime + useSettings.getState().lyricOffset / 1000;
            lyricClock.set(time);
            const next = findActiveLineIndex(lines, time);
            if (next !== last) {
                last = next;
                setIndex(next);
            }
            sampleAudio(engine.playing);
        };
        tick();
        return () => cancelAnimationFrame(frame);
    }, [lines]);
    return index;
}
