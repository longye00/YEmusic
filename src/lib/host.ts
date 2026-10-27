/** window.ye（preload 暴露的主进程能力）的类型与浏览器环境下的降级实现。 */
export interface HostResponse {
    ok: boolean;
    status: number;
    statusMessage?: string;
    error?: string;
    url?: string;
    headers?: Record<string, string>;
    bytes?: Uint8Array;
}

export interface HostRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    timeoutMs?: number;
    followRedirects?: boolean;
    blockedHosts?: string[];
}

export interface TagInfo {
    path: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
    bitrate: number;
    sampleRate: number;
    codec: string;
    lossless: boolean;
    lyrics: string;
    track?: number;
    year?: number;
    cover: { data: Uint8Array; format: string } | null;
    error?: string;
}

/** 推送给系统媒体控件（Android 通知栏 / 锁屏）的“正在播放”信息 */
export interface NowPlaying {
    hasTrack: boolean;
    title: string;
    artist: string;
    album: string;
    /** 秒 */
    duration: number;
    /** 秒 */
    position: number;
    playing: boolean;
    /** 封面地址：undefined = 沿用上一次的封面，空字符串 = 无封面 */
    cover?: string;
}

export interface YeApi {
    platform: string;
    version(): Promise<string>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    toggleFullscreen(): Promise<void>;
    close(): Promise<void>;
    quit(): Promise<void>;
    isMaximized(): Promise<boolean>;
    isFullscreen(): Promise<boolean>;
    onWindowStateChanged(handler: (state: { maximized: boolean; fullscreen: boolean; focused: boolean }) => void): () => void;
    setCloseToTray(value: boolean): Promise<void>;
    setTrayState(state: { title: string; playing: boolean }): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: string | Uint8Array): Promise<string>;
    exists(path: string): Promise<boolean>;
    showOpenDialog(options: { title?: string; directory?: boolean; multiple?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<{ cancelled: boolean; paths: string[] }>;
    showSaveDialog(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<{ cancelled: boolean; filePath?: string }>;
    defaultPaths(): Promise<{ downloads: string; music: string; userData: string }>;
    showItemInFolder(path: string): Promise<void>;
    openPath(path: string): Promise<string>;
    openExternal(url: string): Promise<void>;
    scanAudio(dirs: string[]): Promise<{ path: string; size: number; mtime: number; folder: string }[]>;
    readTags(path: string, withCover?: boolean): Promise<TagInfo>;
    readSidecarLyric(path: string): Promise<{ encoding: string; data: Uint8Array } | null>;
    localAudioUrl(path: string): Promise<string | null>;
    fetch(req: HostRequest): Promise<HostResponse>;
    fetchImage(req: { url: string; headers?: Record<string, string> }): Promise<HostResponse>;
    pluginFetch(req: HostRequest): Promise<HostResponse>;
    probeUrl(req: { url: string; headers?: Record<string, string>; timeoutMs?: number }): Promise<{ ok: boolean; status: number; error?: string; contentType: string; url?: string }>;
    proxyAudioUrl(req: { url: string; headers?: Record<string, string> }): Promise<string | null>;
    download(req: { url: string; fileName: string; headers?: Record<string, string>; saveDir?: string; tags?: { title: string; artist: string; album?: string; lyric?: string; cover?: string } }): Promise<{ id: string; savePath: string }>;
    cancelDownload(id: string): Promise<boolean>;
    onDownloadProgress(handler: (event: { id: string; state: 'progress' | 'done' | 'error'; received?: number; total?: number; savePath?: string; error?: string }) => void): () => void;
    onMediaCommand(handler: (command: string) => void): () => void;
    /** 仅 Android：把当前播放信息交给原生媒体会话（通知栏控件 / 锁屏 / 耳机线控） */
    setNowPlaying?(info: NowPlaying): Promise<void>;
    /** 仅 Android：读剪贴板文字（WebView 里的 navigator.clipboard.readText 常被系统拒绝） */
    readClipboard?(): Promise<string>;
    /** 仅 Android：把 PNG 图片存进系统相册，返回存放位置的描述 */
    saveImage?(req: { data: Uint8Array; name: string }): Promise<string>;
    /** 仅 Android：打开另一个 App（登录时用它的“扫一扫”）；没有安装返回 false */
    launchApp?(app: 'qq' | 'wechat' | 'kugou' | 'netease' | 'qqmusic'): Promise<boolean>;
}

declare global {
    interface Window {
        ye?: YeApi;
    }
}

export const isDesktop = typeof window !== 'undefined' && Boolean(window.ye);

async function browserFetch(req: HostRequest): Promise<HostResponse> {
    try {
        const res = await fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body as BodyInit | undefined });
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => { headers[key] = value; });
        return { ok: res.ok, status: res.status, headers, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (error) {
        return { ok: false, status: 0, error: (error as Error).message };
    }
}

const noop = async () => {};

/** 浏览器开发环境的降级实现：只够让界面跑起来。 */
const fallback: YeApi = {
    platform: 'web',
    version: async () => 'web',
    minimize: noop,
    toggleMaximize: noop,
    toggleFullscreen: async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); },
    close: noop,
    quit: noop,
    isMaximized: async () => false,
    isFullscreen: async () => Boolean(document.fullscreenElement),
    onWindowStateChanged: () => () => {},
    setCloseToTray: noop,
    setTrayState: noop,
    readFile: async () => { throw new Error('浏览器环境不支持读取本地文件'); },
    writeFile: async () => { throw new Error('浏览器环境不支持写入文件'); },
    exists: async () => false,
    showOpenDialog: async () => ({ cancelled: true, paths: [] }),
    showSaveDialog: async () => ({ cancelled: true }),
    defaultPaths: async () => ({ downloads: '', music: '', userData: '' }),
    showItemInFolder: noop,
    openPath: async () => '',
    openExternal: async url => { window.open(url, '_blank'); },
    scanAudio: async () => [],
    readTags: async path => ({ path, title: '', artist: '', album: '', duration: 0, bitrate: 0, sampleRate: 0, codec: '', lossless: false, lyrics: '', cover: null }),
    readSidecarLyric: async () => null,
    localAudioUrl: async () => null,
    fetch: browserFetch,
    fetchImage: browserFetch,
    pluginFetch: browserFetch,
    probeUrl: async () => ({ ok: true, status: 200, contentType: '' }),
    proxyAudioUrl: async () => null,
    download: async () => { throw new Error('浏览器环境不支持下载'); },
    cancelDownload: async () => false,
    onDownloadProgress: () => () => {},
    onMediaCommand: () => () => {},
};

export const host: YeApi = (typeof window !== 'undefined' && window.ye) || fallback;

/** 运行在 Android 外壳（Capacitor）中 */
export const isAndroid = host.platform === 'android';

/**
 * 把 Android 的 SAF 地址（content://…/tree/primary%3AMusic、…/document/…）转成人能看懂的路径，
 * 例如 “内部存储/Music”；其他平台的路径原样返回。
 */
export function displayPath(path: string): string {
    if (!path || !path.startsWith('content://')) return path;
    try {
        const pathname = new URL(path.split('#/')[0]).pathname;
        const raw = /\/document\/([^/]+)/.exec(pathname)?.[1] || /\/tree\/([^/]+)/.exec(pathname)?.[1];
        if (raw) {
            const id = decodeURIComponent(raw);
            const colon = id.indexOf(':');
            if (colon > 0) {
                const volume = id.slice(0, colon);
                const rest = id.slice(colon + 1);
                const root = volume === 'primary' || volume === 'home' ? '内部存储' : `存储卡 ${volume}`;
                return rest ? `${root}/${rest}` : root;
            }
        }
        const name = path.includes('#/') ? path.split('#/')[1] : '';
        return name || decodeURIComponent(pathname.split('/').pop() || path);
    } catch {
        return path;
    }
}
