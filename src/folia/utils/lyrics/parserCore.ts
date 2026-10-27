import type { Line, Word } from '../../types';
import { annotateLyricLines } from './renderHints';

// YEmusic shim (replaces Folia's src/utils/lyrics/parserCore.ts).
// The full Folia lyric parser (TTML/YRC/QRC/KRC/LRC, xmldom, worker) is not vendored: YEmusic
// parses lyrics itself (src/lib/lyric.ts) and converts them in src/ui/player/folia/lyricsAdapter.ts.
// What the visualizers and the adapter need is copied below verbatim from Folia's parserCore.ts:
// the interlude placeholder (INTERLUDE_FULL_TEXT / isInterludeLine / attachInterludes), the
// word-timing synthesis for line-timed lyrics (buildTimedWords) and finalizeParsedLyricLines.
// (export added to buildTimedWords; the LyricProcessingOptions type is inlined.)
export const INTERLUDE_FULL_TEXT = '......';

export const buildTimedWords = (text: string, startTime: number, endTime: number): Word[] => {
    const duration = Math.max(endTime - startTime, 0.1);
    const rawTokens = text.split(/\s+/).filter(token => token);
    const words: Word[] = [];
    const tokens: Array<{ text: string; weight: number }> = [];
    let totalWeight = 0;

    for (const token of rawTokens) {
        if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(token)) {
            token.split('').forEach(char => {
                const isPunctuation = /[，。！？、：；"'）]/.test(char);
                const weight = isPunctuation ? 0 : 1;
                tokens.push({ text: char, weight });
                totalWeight += weight;
            });
        } else {
            const weight = 1 + (token.length * 0.15);
            tokens.push({ text: token, weight });
            totalWeight += weight;
        }
    }

    if (totalWeight === 0) {
        totalWeight = 1;
    }

    const activeDuration = duration * 0.9;
    const timePerWeight = activeDuration / totalWeight;
    let currentWordStart = startTime;

    tokens.forEach(token => {
        const wordDuration = token.weight * timePerWeight;
        const finalDuration = Math.max(wordDuration, 0.05);

        words.push({
            text: token.text,
            startTime: currentWordStart,
            endTime: currentWordStart + finalDuration
        });

        if (token.weight > 0) {
            currentWordStart += wordDuration;
        } else {
            currentWordStart += 0.05;
        }
    });

    if (words.length > 0) {
        const lastWord = words[words.length - 1];
        if (lastWord.endTime > endTime) {
            const scale = (endTime - startTime) / (lastWord.endTime - startTime);
            words.forEach(word => {
                word.startTime = startTime + ((word.startTime - startTime) * scale);
                word.endTime = startTime + ((word.endTime - startTime) * scale);
            });
        }
    }

    return words;
};

export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean => line.fullText === INTERLUDE_FULL_TEXT;

export const attachInterludes = (lines: Line[]): Line[] => {
    const finalLines: Line[] = [];

    const createInterlude = (start: number, end: number): Line => {
        const duration = end - start;
        const words: Word[] = [];
        const wordDuration = duration / 6;

        for (let index = 0; index < 6; index += 1) {
            words.push({
                text: '.',
                startTime: start + (index * wordDuration),
                endTime: start + ((index + 1) * wordDuration)
            });
        }

        return {
            startTime: start,
            endTime: end,
            fullText: INTERLUDE_FULL_TEXT,
            words
        };
    };

    if (lines.length > 0 && lines[0].startTime > 3) {
        finalLines.push(createInterlude(0.5, lines[0].startTime - 0.5));
    }

    for (let index = 0; index < lines.length; index += 1) {
        const current = lines[index];
        finalLines.push(current);

        const next = lines[index + 1];
        if (next) {
            const gap = next.startTime - current.endTime;
            if (gap > 3) {
                finalLines.push(createInterlude(current.endTime + 0.05, next.startTime - 0.05));
            }
        }
    }

    return finalLines;
};

export const finalizeParsedLyricLines = (
    lines: Line[],
    options: { includeInterludes?: boolean } = {}
): Line[] => {
    const withOptionalInterludes = options.includeInterludes === false
        ? lines
        : attachInterludes(lines);

    return annotateLyricLines(withOptionalInterludes);
};
