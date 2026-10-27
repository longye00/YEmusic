/** 歌词解析：LRC（含多时间标签/offset/增强逐字）、lxlyric（逐字，相对行首毫秒），并合并翻译/音译。 */
import type { RawLyric } from '@/sdk/types';

export interface LyricWord { text: string; start: number; end: number }
export interface LyricLine { time: number; end: number; text: string; words?: LyricWord[]; trans?: string; roma?: string }
export interface ParsedLyric { lines: LyricLine[]; hasWords: boolean; hasTrans: boolean; hasRoma: boolean }

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function tagToSeconds(m: string, s: string, frac?: string) {
    let ms = 0;
    if (frac) ms = frac.length === 1 ? Number(frac) * 100 : frac.length === 2 ? Number(frac) * 10 : Number(frac);
    return Number(m) * 60 + Number(s) + ms / 1000;
}

function readOffset(text: string) {
    const m = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(text);
    return m ? Number(m[1]) / 1000 : 0;
}

const isPlaceholder = (text: string) => /^\s*\/\/\s*$/.test(text) || /^\s*$/.test(text);

/** 增强 LRC：`<mm:ss.xx>字` */
function parseEnhancedWords(body: string): LyricWord[] | undefined {
    if (!/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(body)) return undefined;
    const parts = body.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/).filter(Boolean);
    const words: LyricWord[] = [];
    let start: number | null = null;
    for (const part of parts) {
        const m = /^<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>$/.exec(part);
        if (m) {
            const t = tagToSeconds(m[1], m[2], m[3]);
            if (words.length && words[words.length - 1].end <= words[words.length - 1].start) words[words.length - 1].end = t;
            start = t;
        } else if (start != null) {
            words.push({ text: part, start, end: start });
        }
    }
    return words.length ? words : undefined;
}

export function parseLrc(text: string): { time: number; text: string; words?: LyricWord[] }[] {
    if (!text) return [];
    const offset = readOffset(text);
    const out: { time: number; text: string; words?: LyricWord[] }[] = [];
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
        const line = rawLine.trim();
        TIME_TAG.lastIndex = 0;
        const times: number[] = [];
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        while ((match = TIME_TAG.exec(line)) && match.index === lastIndex) {
            times.push(tagToSeconds(match[1], match[2], match[3]));
            lastIndex = TIME_TAG.lastIndex;
        }
        if (!times.length) continue;
        let body = line.slice(lastIndex);
        const words = parseEnhancedWords(body);
        if (words) body = words.map(w => w.text).join('');
        body = body.replace(/<\d+,\d+(?:,\d+)?>/g, '').trim();
        for (const time of times) {
            out.push({ time: Math.max(0, time - offset), text: body, words: words?.map(w => ({ ...w, start: w.start - offset, end: w.end - offset })) });
        }
    }
    return out.sort((a, b) => a.time - b.time);
}

export function parseLxLyric(text: string): { time: number; text: string; words: LyricWord[] }[] {
    if (!text) return [];
    const offset = readOffset(text);
    const out: { time: number; text: string; words: LyricWord[] }[] = [];
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
        const line = rawLine.trim();
        const t = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(line);
        if (!t) continue;
        const time = tagToSeconds(t[1], t[2], t[3]) - offset;
        const body = line.slice(t[0].length);
        const words: LyricWord[] = [];
        const re = /<(-?\d+),(-?\d+)(?:,-?\d+)?>([^<]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(body))) {
            const start = time + Number(m[1]) / 1000;
            words.push({ text: m[3], start, end: start + Math.max(0, Number(m[2])) / 1000 });
        }
        const plain = words.length ? words.map(w => w.text).join('') : body.replace(/<-?\d+,-?\d+(?:,-?\d+)?>/g, '');
        out.push({ time: Math.max(0, time), text: plain.trim(), words: words.filter(w => w.text.length) });
    }
    return out.sort((a, b) => a.time - b.time);
}

function attach(lines: LyricLine[], extra: { time: number; text: string }[], key: 'trans' | 'roma') {
    if (!extra.length) return false;
    let found = false;
    let j = 0;
    for (const line of lines) {
        while (j < extra.length - 1 && extra[j + 1].time <= line.time + 0.05) j++;
        const candidate = extra[j];
        if (candidate && Math.abs(candidate.time - line.time) < 0.6 && !isPlaceholder(candidate.text) && candidate.text !== line.text) {
            line[key] = candidate.text;
            found = true;
        }
    }
    return found;
}

export function buildLyric(raw: RawLyric | null | undefined): ParsedLyric | null {
    if (!raw) return null;
    const lx = raw.lxlyric ? parseLxLyric(raw.lxlyric) : [];
    const lrc = parseLrc(raw.lyric || '');
    let base: { time: number; text: string; words?: LyricWord[] }[] = lx.length >= Math.max(3, lrc.filter(l => l.text).length * 0.6) ? lx : lrc;
    if (!base.length) {
        const plain = String(raw.lyric || '').trim();
        if (!plain) return null;
        // 无时间轴的纯文本歌词：按行均匀展示
        base = plain.split(/\r?\n/).map((text, i) => ({ time: i * 4, text: text.trim() }));
    }
    const lines: LyricLine[] = [];
    for (const item of base) {
        const prev = lines[lines.length - 1];
        // 合并完全重复的相邻空行
        if (prev && !prev.text && !item.text) continue;
        lines.push({ time: item.time, end: item.time, text: item.text, words: item.words?.length ? item.words : undefined });
    }
    for (let i = 0; i < lines.length; i++) {
        const next = lines[i + 1];
        const wordEnd = lines[i].words?.length ? lines[i].words![lines[i].words!.length - 1].end : 0;
        const nextTime = next ? next.time : lines[i].time + Math.max(5, wordEnd - lines[i].time + 1);
        lines[i].end = Math.max(Math.min(nextTime, Math.max(wordEnd + 1.2, lines[i].time + 0.5)), wordEnd || 0, Math.min(nextTime, lines[i].time + 8));
        if (next) lines[i].end = Math.min(lines[i].end, next.time);
    }
    const hasTrans = attach(lines, parseLrc(raw.tlyric || ''), 'trans');
    const hasRoma = attach(lines, parseLrc(raw.rlyric || ''), 'roma');
    return { lines, hasWords: lines.some(l => l.words?.length), hasTrans, hasRoma };
}

/** 二分查找当前行 */
export function findLineIndex(lines: LyricLine[], time: number): number {
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].time <= time) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

/** 生成可保存的 LRC 文本（用于下载歌词） */
export function toLrcText(parsed: ParsedLyric, withTrans = true): string {
    const fmt = (t: number) => {
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
    };
    const out: string[] = [];
    for (const line of parsed.lines) {
        out.push(`${fmt(line.time)}${line.text}`);
        if (withTrans && line.trans) out.push(`${fmt(line.time)}${line.trans}`);
    }
    return out.join('\n');
}
