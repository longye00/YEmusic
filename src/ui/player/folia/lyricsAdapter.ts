/**
 * YEmusic 歌词（src/lib/lyric.ts）→ Folia 歌词行（src/folia/types.ts 的 Line[]）。
 * 时间轴规则照搬 Folia 的 parseLRC / parseYRC：
 *  - 逐行歌词：行长 = 到下一行的间隔（过长的按“阅读时间 + 2s”截断，末行 5s），字时间由 buildTimedWords 估算；
 *  - 逐字歌词：沿用逐字时间，行尾 = 最后一个字的结束；
 *  - 间隙 > 3s 插入 “......” 间奏行，再由 annotateLyricLines 补上渲染提示（renderHints）；
 *  - 重复最多的歌词行标记为副歌（isChorus），供回环 / 镜台 / 商籁 / 凝彩 / 绘光使用。
 */
import type { Line, Word } from '@/folia/types';
import { applyDetectedChorusEffects } from '@/folia/utils/lyrics/chorusEffects';
import { buildTimedWords, finalizeParsedLyricLines } from '@/folia/utils/lyrics/parserCore';
import type { LyricLine, ParsedLyric } from '@/lib/lyric';
import { seededRandom } from '@/lib/util';

export const EMPTY_LINES: Line[] = Object.freeze([]) as unknown as Line[];

function wordsOf(line: LyricLine): Word[] | null {
    const raw = line.words?.filter(w => w.text.length > 0);
    if (!raw?.length) return null;
    const words: Word[] = raw.map(w => ({ text: w.text, startTime: w.start, endTime: w.end }));
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const next = words[i + 1];
        // 没有结束时间的字（增强 LRC 末字等）：延续到下一个字，最多 0.6s
        if (!(word.endTime > word.startTime)) {
            const limit = next && next.startTime > word.startTime ? next.startTime : word.startTime + 0.6;
            word.endTime = Math.max(word.startTime + 0.05, Math.min(limit, word.startTime + 0.6));
        }
    }
    return words;
}

export function toFoliaLines(lyric: ParsedLyric): Line[] {
    const all = lyric.lines;
    const lines: Line[] = [];
    // 下一条非空歌词行（Folia 的 parseLRC 会直接丢弃空行）
    const nextSung = (from: number) => {
        for (let j = from + 1; j < all.length; j++) if (all[j].text.trim()) return all[j];
        return undefined;
    };
    for (let i = 0; i < all.length; i++) {
        const item = all[i];
        const text = item.text.trim();
        if (!text) continue;
        const timed = wordsOf(item);
        let words: Word[];
        let endTime: number;
        if (timed) {
            words = timed;
            endTime = Math.max(words[words.length - 1].endTime, item.time + 0.05);
        } else {
            const next = nextSung(i);
            let duration = next ? next.time - item.time : 5;
            const reading = text.length * 0.5;
            if (duration > reading + 2 && duration > 5) duration = Math.min(duration, reading + 2);
            // 紧跟一条空白行 = 这一句已经唱完，以它为准（更贴近真实时长，间奏也能被识别）
            const after = all[i + 1];
            if (after && !after.text.trim() && after.time > item.time) duration = Math.min(duration, Math.max(0.5, after.time - item.time));
            endTime = item.time + Math.max(duration, 0.1);
            words = buildTimedWords(text, item.time, endTime);
        }
        lines.push({
            words,
            startTime: item.time,
            endTime,
            fullText: timed ? words.map(w => w.text).join('').trim() || text : text,
            translation: item.trans || undefined,
            romanization: item.roma || undefined,
        });
    }
    const finalized = finalizeParsedLyricLines(lines);
    // 副歌检测：与 Folia 的“文本兜底”相同，伪造 LRC 文本交给 detectChorusLines
    const lrcText = finalized.map(line => `[00:00.00]${line.fullText}`).join('\n');
    const seed = `${finalized.length}:${finalized.slice(0, 6).map(line => line.fullText).join('|')}`;
    return applyDetectedChorusEffects({ lines: finalized }, lrcText, seededRandom(seed)).lines;
}

/** 与 Folia 的 findLatestActiveLineIndex 一致：最后一个“已开始且未过渲染终点”的行，没有则 -1 */
export function findActiveLineIndex(lines: Line[], time: number): number {
    // 二分找到最后一个已开始的行，再向前找第一个尚未过终点的
    let lo = 0;
    let hi = lines.length - 1;
    let last = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].startTime <= time) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    for (let index = last; index >= 0; index--) {
        const line = lines[index];
        if (time <= (line.renderHints?.renderEndTime ?? line.endTime)) return index;
    }
    return -1;
}
