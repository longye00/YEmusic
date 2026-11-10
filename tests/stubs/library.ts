// 测试替身：曲库（收藏 + 播放记录），给猜我喜欢提供信号。
import type { Track } from '@/sdk/types';

const mk = (id: string, name: string, singer: string): Track => ({
    id, source: 'wy', songmid: id, name, singer, album: '专辑', duration: 200,
    qualities: [{ type: '128k' }],
});
const favTracks = [mk('f1', '收藏一', '歌手甲'), mk('f2', '收藏二', '歌手乙')];
const recentTracks = [mk('r1', '听过一', '歌手甲')];
const tracks: Record<string, Track> = {};
for (const t of [...favTracks, ...recentTracks]) tracks[t.id] = t;

export const FAVORITES_ID = 'favorites';

export const useLibrary = {
    getState: () => ({
        playlists: [{ id: FAVORITES_ID, trackIds: favTracks.map(t => t.id) }],
        tracks,
        recent: recentTracks.map(t => t.id),
    }),
};
