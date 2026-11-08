// 测试替身：歌词加载。播放器测试不关心歌词，直接返回「无歌词」，
// 避免真实实现去碰 IndexedDB / 音源脚本 / 网络。
import type { ParsedLyric } from '@/lib/lyric';
import type { Track } from '@/sdk/types';

export async function fetchLyric(_track: Track, _force = false): Promise<{ lyric: ParsedLyric | null; from: string }> {
    return { lyric: null, from: 'none' };
}
