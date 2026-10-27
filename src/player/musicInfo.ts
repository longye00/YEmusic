/** 把内部 Track 转成洛雪脚本期望的旧版 musicInfo（对应 lx-music-desktop 的 toOldMusicInfo）。 */
import { formatTime } from '@/lib/util';
import type { Track } from '@/sdk/types';

export function toLxMusicInfo(track: Track): Record<string, unknown> {
    const types = (track.qualities || []).map(q => (q.hash ? { type: q.type, size: q.size ?? null, hash: q.hash } : { type: q.type, size: q.size ?? null }));
    const _types: Record<string, Record<string, unknown>> = {};
    for (const t of types) _types[t.type] = t.hash ? { size: t.size, hash: t.hash } : { size: t.size };
    const info: Record<string, unknown> = {
        name: track.name,
        singer: track.singer,
        source: track.source,
        songmid: track.songmid,
        interval: formatTime(track.duration),
        albumName: track.album || '',
        img: track.cover || '',
        typeUrl: {},
    };
    if (track.source === 'local') {
        info.filePath = track.path;
        info.ext = (track.path || '').split('.').pop() || '';
        info.albumId = '';
        info.types = [];
        info._types = {};
        return info;
    }
    info.albumId = track.albumId || '';
    info.types = types;
    info._types = _types;
    const meta = track.meta || {};
    switch (track.source) {
        case 'kg':
            info.hash = meta.hash || track.qualities?.find(q => q.type === '128k')?.hash;
            info.albumAudioId = meta.albumAudioId;
            break;
        case 'tx':
            info.strMediaMid = meta.strMediaMid;
            info.albumMid = meta.albumMid;
            info.songId = meta.songId;
            break;
        case 'mg':
            info.copyrightId = meta.copyrightId;
            info.lrcUrl = meta.lrcUrl;
            info.mrcUrl = meta.mrcUrl;
            info.trcUrl = meta.trcUrl;
            break;
    }
    return info;
}
