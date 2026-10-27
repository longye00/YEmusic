/** 首页 / 乐库共用：直接播放在线歌单、排行榜、专辑 */
import { sdks } from '@/sdk';
import type { Platform, Track } from '@/sdk/types';
import { playList } from '@/store/player';
import { toast } from '@/store/toast';

export async function fetchRemoteList(platform: Platform, kind: 'songlist' | 'board', id: string): Promise<Track[]> {
    const sdk = sdks[platform];
    const first = kind === 'board' ? await sdk.getBoardList(id, 1) : await sdk.getSongListDetail(id, 1);
    return first.list;
}

/** 载入并播放；loader 抛错或返回空列表时给出提示 */
export async function playLoaded(name: string, loader: () => Promise<Track[]>, options: { shuffle?: boolean } = {}) {
    toast(`正在载入「${name}」…`, 'info', { duration: 1500, key: 'play-remote' });
    try {
        const list = await loader();
        if (!list.length) throw new Error('列表为空');
        playList(list, 0, options);
    } catch (error) {
        toast(`载入失败：${(error as Error).message}`, 'error', { key: 'play-remote' });
    }
}

export const playRemote = (platform: Platform, kind: 'songlist' | 'board', id: string, name: string) => playLoaded(name, () => fetchRemoteList(platform, kind, id));
