/**
 * 歌词样式窗口「内置」预览用的示例歌词：8 行、约 3.5s 一行、循环播放，
 * 带逐字时间（逐字动画按它点亮）、翻译与罗马音（字幕开关的预览对象）。
 */
import type { LyricLine, ParsedLyric } from '@/lib/lyric';

/** 每行间隔（秒），行内逐字铺满前 80%，余下时间留给行尾停留 */
const LINE_GAP = 3.5;

const TEXTS: [string, string, string][] = [
    // [原文, 翻译, 罗马音]
    ['夜里有一盏灯为歌留着', 'A lamp stays lit for the song at night', 'yè lǐ yǒu yī zhǎn dēng wèi gē liú zhe'],
    ['风把旋律吹向很远的地方', 'The wind carries the melody far away', 'fēng bǎ xuán lǜ chuī xiàng hěn yuǎn de dì fāng'],
    ['我们沿着节拍慢慢往前走', 'We walk on slowly along the beat', 'wǒ men yán zhe jié pāi màn màn wǎng qián zǒu'],
    ['把没说出口的话唱成星光', 'Singing unspoken words into starlight', 'bǎ méi shuō chū kǒu de huà chàng chéng xīng guāng'],
    ['时间在这一句停了一下', 'Time pauses for a moment on this line', 'shí jiān zài zhè yī jù tíng le yī xià'],
    ['让呼吸跟上下一段和弦', 'Letting breath catch up with the next chord', 'ràng hū xī gēn shàng xià yī duàn hé xián'],
    ['所有遥远的梦都有了回声', 'Every distant dream finds its echo', 'suǒ yǒu yáo yuǎn de mèng dōu yǒu le huí shēng'],
    ['在歌声落下之前轻轻相拥', 'Holding each other gently before the song fades', 'zài gē shēng luò xià zhī qián qīng qīng xiāng yōng'],
];

/** 把一行切成逐字时间：每个字均分演唱段（首尾略收缩，更像真实逐字歌词） */
function timedWords(text: string, start: number, end: number) {
    const chars = [...text];
    const span = (end - start) / chars.length;
    return chars.map((ch, i) => ({ text: ch, start: start + i * span, end: start + (i + 1) * span }));
}

const lines: LyricLine[] = TEXTS.map(([text, trans, roma], i) => {
    const time = i * LINE_GAP;
    const end = time + LINE_GAP * 0.8;
    return { time, end, text, trans, roma, words: timedWords(text, time, end) };
});

export const SAMPLE_LYRIC: ParsedLyric = {
    lines,
    hasWords: true,
    hasTrans: true,
    hasRoma: true,
};

/** 循环时长：最后一行唱完再留一个间奏的长度，预览能看到「间奏点」状态 */
export const SAMPLE_LOOP = lines[lines.length - 1].end + LINE_GAP;

/** 预览里展示的歌曲信息（Folia 的样例曲占位，seed 固定避免切样式时重排背景） */
export const SAMPLE_PREVIEW = { title: 'YEmusic 示例', singer: '内置示例歌词', seed: 'ye-lyric-style-sample' };
