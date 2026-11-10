// 测试替身：网易云 weapi 的两个推荐接口。similarSongs 每次往后转，模拟换种子得到不同的歌。
import type { Track } from '@/sdk/types';

const state = ((globalThis as any).__wyApiStub ??= { calls: 0 } as { calls: number }) as { calls: number };

const mk = (id: string, name: string, singer: string): Track => ({
    id, source: 'wy', songmid: id, name, singer, album: '专辑', duration: 200,
    qualities: [{ type: '128k' }],
});
const POOL = Array.from({ length: 120 }, (_, i) => mk(`s${i}`, `相似${i}`, `歌手${i % 40}`));

export async function similarSongs(_songId: string | number, limit = 12): Promise<Track[]> {
    const start = (state.calls++ * 30) % POOL.length;
    const out: Track[] = [];
    for (let i = 0; i < limit; i++) out.push(POOL[(start + i) % POOL.length]);
    return out;
}

export async function dailySongs(): Promise<Track[]> {
    return [];
}
