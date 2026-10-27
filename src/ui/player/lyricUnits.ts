/** 把歌词行拆成逐字 / 逐词的显示单元，并为没有逐字时间轴的歌词生成“打字”式时间 */
import type { LyricLine } from '@/lib/lyric';

export interface Unit {
    text: string;
    start: number;
    end: number;
    space?: boolean;
    cjk?: boolean;
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff66-\uff9f]/;
const TOKEN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff66-\uff9f][\u3099-\u309c\u30fc]?|[^\s\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\uff66-\uff9f]+|\s+/g;

export const isCjk = (text: string) => CJK.test(text);

function pushText(out: Unit[], text: string, start: number, end: number) {
    const tokens = text.match(TOKEN) || [];
    const weights = tokens.map(t => (/^\s+$/.test(t) ? 0 : isCjk(t) ? 1 : Math.max(1, t.length * 0.45)));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = start;
    tokens.forEach((token, i) => {
        const span = ((end - start) * weights[i]) / total;
        if (/^\s+$/.test(token)) out.push({ text: ' ', start: cursor, end: cursor, space: true });
        else out.push({ text: token, start: cursor, end: cursor + span, cjk: isCjk(token) });
        cursor += span;
    });
}

export function buildUnits(line: LyricLine | undefined): Unit[] {
    if (!line || !line.text.trim()) return [];
    const out: Unit[] = [];
    if (line.words?.length) {
        for (const word of line.words) {
            const lead = /^\s+/.exec(word.text)?.[0];
            const trail = /\s+$/.exec(word.text)?.[0];
            if (lead) out.push({ text: ' ', start: word.start, end: word.start, space: true });
            const core = word.text.trim();
            // 一个时间片里包含多个汉字时继续拆开，让每个字都能单独飞入
            if (core) pushText(out, core, word.start, Math.max(word.end, word.start + 0.05));
            if (trail) out.push({ text: ' ', start: word.end, end: word.end, space: true });
        }
    } else {
        const lineDur = Math.max(0.6, line.end - line.time);
        const visible = (line.text.match(TOKEN) || []).filter(t => !/^\s+$/.test(t)).length;
        const reveal = Math.min(lineDur * 0.85, Math.max(0.9, visible * 0.28));
        pushText(out, line.text.trim(), line.time, line.time + reveal);
    }
    // 去掉首尾空白单元
    while (out[0]?.space) out.shift();
    while (out[out.length - 1]?.space) out.pop();
    return out;
}

export function activeUnitIndex(units: Unit[], time: number): number {
    let index = -1;
    for (let i = 0; i < units.length; i++) {
        if (units[i].space) continue;
        if (units[i].start <= time) index = i;
        else break;
    }
    return index;
}
