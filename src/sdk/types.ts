export type Platform = 'kw' | 'kg' | 'tx' | 'wy' | 'mg';
export type TrackSource = Platform | 'local';
export type Quality = '128k' | '320k' | 'flac' | 'flac24bit';

export const PLATFORMS: Platform[] = ['tx', 'wy', 'kg', 'kw', 'mg'];
export const PLATFORM_NAMES: Record<TrackSource, string> = {
    kw: '酷我',
    kg: '酷狗',
    tx: 'QQ音乐',
    wy: '网易云',
    mg: '咪咕',
    local: '本地',
};
export const QUALITY_ORDER: Quality[] = ['flac24bit', 'flac', '320k', '128k'];
export const QUALITY_NAMES: Record<Quality, string> = {
    '128k': '标准 128K',
    '320k': '高品 320K',
    flac: '无损 FLAC',
    flac24bit: 'Hi-Res 24bit',
};
export const QUALITY_SHORT: Record<Quality, string> = { '128k': '128K', '320k': '320K', flac: 'SQ', flac24bit: 'HR' };

export interface QualityInfo {
    type: Quality;
    size?: string;
    hash?: string;
}

export interface TrackMeta {
    hash?: string;
    albumAudioId?: string | number;
    strMediaMid?: string;
    albumMid?: string;
    songId?: string | number;
    copyrightId?: string;
    lrcUrl?: string;
    mrcUrl?: string;
    trcUrl?: string;
}

export interface Track {
    /** `${source}_${songmid}`，本地歌曲为 `local_${路径哈希}` */
    id: string;
    source: TrackSource;
    songmid: string;
    name: string;
    singer: string;
    album: string;
    albumId?: string;
    /** 秒 */
    duration: number;
    cover?: string;
    qualities?: QualityInfo[];
    meta?: TrackMeta;
    path?: string;
    fileSize?: number;
    codec?: string;
    bitrate?: number;
    lossless?: boolean;
    mtime?: number;
    folder?: string;
    addedAt?: number;
}

export interface PagedTracks {
    list: Track[];
    total: number;
    page: number;
    limit: number;
}

export interface SearchResult extends PagedTracks {
    source: Platform;
}

export interface OnlinePlaylist {
    id: string;
    source: Platform;
    name: string;
    cover?: string;
    playCount?: number;
    author?: string;
    desc?: string;
    total?: number;
}

export interface Board {
    id: string;
    source: Platform;
    name: string;
    bangid: string;
}

export interface ListDetail extends PagedTracks {
    info?: Partial<OnlinePlaylist>;
}

export interface RawLyric {
    lyric: string;
    tlyric?: string;
    rlyric?: string;
    lxlyric?: string;
    /** 网易云逐字歌词 */
    yrc?: string;
}

export interface SongListSort {
    id: string;
    name: string;
}

export interface PlatformSdk {
    id: Platform;
    name: string;
    search(keyword: string, page: number, limit: number): Promise<SearchResult>;
    getLyric(track: Track): Promise<RawLyric>;
    getPic?(track: Track): Promise<string>;
    boards: Board[];
    getBoardList(bangid: string, page: number): Promise<ListDetail>;
    songListSorts: SongListSort[];
    getSongLists(sortId: string, page: number): Promise<{ list: OnlinePlaylist[]; total: number; page: number; limit: number }>;
    getSongListDetail(id: string, page: number): Promise<ListDetail>;
    hotSearch?(): Promise<string[]>;
}

export function sizeFormat(bytes: number | string | undefined): string {
    const n = Number(bytes);
    if (!n || n <= 0) return '';
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)}GB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

export function sortQualities(list: QualityInfo[]): QualityInfo[] {
    const seen = new Set<Quality>();
    return list
        .filter(item => (seen.has(item.type) ? false : (seen.add(item.type), true)))
        .sort((a, b) => QUALITY_ORDER.indexOf(b.type) - QUALITY_ORDER.indexOf(a.type));
}

export function bestQuality(track: Track): Quality | undefined {
    const types = track.qualities?.map(q => q.type) ?? [];
    return QUALITY_ORDER.find(q => types.includes(q));
}

export function trackKey(source: TrackSource, songmid: string | number) {
    return `${source}_${songmid}`;
}
