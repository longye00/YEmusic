// 测试替身：平台 SDK 集合。猜我喜欢里只用到 search（按歌手搜歌）。
import type { Track } from '@/sdk/types';

const mk = (id: string, name: string, singer: string): Track => ({
    id, source: 'wy', songmid: id, name, singer, album: '专辑', duration: 200,
    qualities: [{ type: '128k' }],
});

const search = async (keyword: string) => ({
    list: Array.from({ length: 30 }, (_, i) => mk(`q${keyword}_${i}`, `${keyword}的歌${i}`, keyword)),
    total: 30, page: 1, limit: 30,
});

export const sdks = {
    wy: { search },
    kw: { search },
    kg: { search },
    tx: { search },
    mg: { search },
};
