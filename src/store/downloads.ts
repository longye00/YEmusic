/** 下载管理：解析链接 → 主进程流式写盘（.part 断点保护）→ 可选保存 .lrc 歌词 */
import { create } from 'zustand';
import { host, isAndroid, isDesktop } from '@/lib/host';
import { toLrcText } from '@/lib/lyric';
import { sanitizeFileName, thumbUrl, uid } from '@/lib/util';
import { fetchLyric } from '@/player/lyrics';
import { resolveUrl } from '@/player/resolver';
import { sdks } from '@/sdk';
import { QUALITY_NAMES, type Platform, type Quality, type Track } from '@/sdk/types';
import { importFiles } from './library';
import { useSettings } from './settings';
import { toast } from './toast';

export interface DownloadItem {
    id: string;
    hostId?: string;
    track: Track;
    quality?: Quality;
    status: 'resolving' | 'downloading' | 'done' | 'error' | 'cancelled';
    received: number;
    total: number;
    savePath?: string;
    error?: string;
    createdAt: number;
}

const KEY = 'ye.downloads.v1';

function load(): DownloadItem[] {
    try {
        return (JSON.parse(localStorage.getItem(KEY) || '[]') as DownloadItem[]).map(item =>
            item.status === 'resolving' || item.status === 'downloading' ? { ...item, status: 'error', error: '应用关闭时下载被中断' } : item);
    } catch {
        return [];
    }
}

export const useDownloads = create<{ items: DownloadItem[] }>(() => ({ items: load() }));

useDownloads.subscribe(state => {
    localStorage.setItem(KEY, JSON.stringify(state.items.slice(0, 300)));
});

function patch(id: string, value: Partial<DownloadItem>) {
    useDownloads.setState(state => ({ items: state.items.map(item => (item.id === id ? { ...item, ...value } : item)) }));
}

function extFromUrl(url: string, quality?: Quality) {
    const match = /\.(mp3|flac|m4a|aac|ogg|opus|wav|ape)(?:$|[?#])/i.exec(new URL(url).pathname + '?');
    if (match) return match[1].toLowerCase();
    return quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3';
}

export function fileNameFor(track: Track, template = useSettings.getState().fileNameTemplate) {
    return sanitizeFileName(template.replace(/\{name\}/g, track.name).replace(/\{singer\}/g, track.singer).replace(/\{album\}/g, track.album || ''));
}

host.onDownloadProgress(event => {
    const item = useDownloads.getState().items.find(i => i.hostId === event.id);
    if (!item) return;
    if (event.state === 'progress') patch(item.id, { received: event.received || 0, total: event.total || 0 });
    else if (event.state === 'done') {
        patch(item.id, { status: 'done', savePath: event.savePath || item.savePath, received: event.total || item.received });
        toast(`下载完成：${item.track.name}`, 'success');
        if (useSettings.getState().saveLyricFile) void saveLyric(item.track, event.savePath || item.savePath);
        // Android 的应用下载目录（Android/data/…）无法通过系统文件夹选择器加入本地音乐，下载完成后直接导入
        if (isAndroid && (event.savePath || item.savePath)) void importFiles([event.savePath || item.savePath!], { silent: true }).catch(() => undefined);
    } else if (event.state === 'error') {
        patch(item.id, { status: 'error', error: event.error || '下载失败' });
        toast(`下载失败：${item.track.name}（${event.error || '未知错误'}）`, 'error');
    }
});

async function saveLyric(track: Track, savePath?: string) {
    if (!savePath) return;
    try {
        const { lyric } = await fetchLyric(track);
        if (!lyric) return;
        await host.writeFile(savePath.replace(/\.[^.\\/]+$/, '') + '.lrc', toLrcText(lyric));
    } catch (error) {
        console.warn('[download] 保存歌词失败', error);
    }
}

async function prepareTags(track: Track) {
    const [lyric, cover] = await Promise.all([
        fetchLyric(track).then(r => (r.lyric ? toLrcText(r.lyric) : ''), () => ''),
        track.cover && /^https?:/i.test(track.cover) ? Promise.resolve(track.cover) : (sdks[track.source as Platform]?.getPic?.(track).catch(() => '') ?? Promise.resolve('')),
    ]);
    return { title: track.name, artist: track.singer, album: track.album || '', lyric, cover: thumbUrl(cover || undefined, 300) || '' };
}

export async function downloadTrack(track: Track, quality: Quality = useSettings.getState().downloadQuality) {
    if (!isDesktop) {
        toast('网页版不支持下载', 'error');
        return;
    }
    if (track.source === 'local') {
        toast('这是本地歌曲，无需下载', 'info');
        return;
    }
    const id = uid('dl');
    useDownloads.setState(state => ({ items: [{ id, track, quality, status: 'resolving', received: 0, total: 0, createdAt: Date.now() }, ...state.items] }));
    // 标签信息（歌词 / 封面）与链接解析并行准备
    const embed = useSettings.getState().embedMeta;
    const extras = embed ? prepareTags(track) : Promise.resolve(undefined);
    try {
        const resolved = await resolveUrl(track, { quality });
        const ext = extFromUrl(resolved.url, resolved.quality);
        const dir = useSettings.getState().downloadDir || undefined;
        const tags = await Promise.race([extras, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 6000))]);
        const res = await host.download({ url: resolved.url, fileName: `${fileNameFor(track)}.${ext}`, saveDir: dir, tags: tags || (embed ? { title: track.name, artist: track.singer, album: track.album || '', cover: thumbUrl(track.cover, 300) } : undefined) });
        patch(id, { hostId: res.id, savePath: res.savePath, status: 'downloading', quality: resolved.quality });
        toast(`开始下载：${track.name}${resolved.quality ? `（${QUALITY_NAMES[resolved.quality]}）` : ''}`, 'info');
    } catch (error) {
        patch(id, { status: 'error', error: (error as Error).message });
        toast(`下载失败：${track.name}（${(error as Error).message}）`, 'error');
    }
}

export async function downloadMany(tracks: Track[]) {
    const list = tracks.filter(t => t.source !== 'local');
    toast(`已加入 ${list.length} 首到下载队列`, 'info');
    // 逐首串行解析，避免同时对音源发起大量请求
    for (const track of list) await downloadTrack(track);
}

export async function cancelDownload(id: string) {
    const item = useDownloads.getState().items.find(i => i.id === id);
    if (item?.hostId) await host.cancelDownload(item.hostId).catch(() => false);
    patch(id, { status: 'cancelled' });
}

export function removeDownload(id: string) {
    useDownloads.setState(state => ({ items: state.items.filter(i => i.id !== id) }));
}

export function clearFinishedDownloads() {
    useDownloads.setState(state => ({ items: state.items.filter(i => i.status === 'downloading' || i.status === 'resolving') }));
}
