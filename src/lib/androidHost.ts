/**
 * Android 外壳的 window.ye：桌面版由 Electron preload 提供的“主进程能力”，在这里映射到 Capacitor 原生插件
 * （android/app/src/main/java/app/yemusic/player/YeNativePlugin.java）。
 *
 * 必须在 host.ts 之前执行（main.tsx 第一个 import），所以这里只能 `import type` 引用 host.ts。
 * 网络规则（域名白名单 / 公网限制 / 重定向复核 / 体积上限）与桌面版主进程一致，由原生层强制执行。
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { HostRequest, HostResponse, NowPlaying, TagInfo, YeApi } from './host';

interface NativeResponse {
    ok: boolean;
    status: number;
    statusMessage?: string;
    error?: string;
    url?: string;
    headers?: Record<string, string>;
    bodyBase64?: string;
    contentType?: string;
}

interface Picked { cancelled: boolean; paths: string[] }

interface YeNative {
    version(): Promise<{ value: string }>;
    quit(): Promise<void>;
    defaultPaths(): Promise<{ downloads: string; music: string; userData: string }>;
    request(options: Record<string, unknown>): Promise<NativeResponse>;
    proxyAudioUrl(options: { url: string; headers?: Record<string, string> }): Promise<{ url: string | null }>;
    localAudioUrl(options: { path: string }): Promise<{ url: string | null }>;
    pickFolder(): Promise<Picked>;
    pickFiles(options: { multiple?: boolean; extensions?: string[] }): Promise<Picked>;
    saveFile(options: { name: string }): Promise<{ cancelled: boolean; filePath?: string }>;
    scanAudio(options: { dirs: string[] }): Promise<{ files: { path: string; size: number; mtime: number; folder: string }[] }>;
    readTags(options: { path: string; withCover: boolean }): Promise<Omit<TagInfo, 'cover'> & { cover: { data: string; format: string } | null }>;
    readSidecarLyric(options: { path: string }): Promise<{ found: boolean; encoding?: string; data?: string }>;
    exists(options: { path: string }): Promise<{ value: boolean }>;
    readFile(options: { path: string }): Promise<{ data: string }>;
    writeFile(options: { path: string; dataText?: string; dataBase64?: string }): Promise<{ path: string }>;
    download(options: Record<string, unknown>): Promise<{ id: string; savePath: string }>;
    cancelDownload(options: { id: string }): Promise<{ value: boolean }>;
    openPath(options: { path: string }): Promise<{ value: string }>;
    openExternal(options: { url: string }): Promise<void>;
    readClipboard(): Promise<{ text: string }>;
    saveImage(options: { dataBase64: string; name: string }): Promise<{ where: string }>;
    launchApp(options: { app: string }): Promise<{ launched: boolean }>;
    setNowPlaying(options: Record<string, unknown>): Promise<void>;
    clearNowPlaying(): Promise<void>;
    addListener(event: 'downloadProgress' | 'mediaCommand', handler: (data: never) => void): Promise<PluginListenerHandle>;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function subscribe<T>(native: YeNative, event: 'downloadProgress' | 'mediaCommand', handler: (data: T) => void) {
    const pending = native.addListener(event, handler as (data: never) => void);
    return () => { void pending.then(handle => handle.remove()).catch(() => undefined); };
}

/** 封面 → 512px 以内的 JPEG（base64），供通知栏 / 锁屏显示 */
function createCoverEncoder(getYe: () => YeApi) {
    let lastUrl = '';
    let lastValue = '';
    return async (url: string): Promise<string> => {
        if (url === lastUrl) return lastValue;
        let blob: Blob;
        if (/^https?:/i.test(url)) {
            const res = await getYe().fetchImage({ url });
            if (!res.ok || !res.bytes) return '';
            blob = new Blob([res.bytes as BlobPart]);
        } else {
            blob = await (await fetch(url)).blob();
        }
        const bitmap = await createImageBitmap(blob);
        const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        if (!jpeg) return '';
        const value = bytesToBase64(new Uint8Array(await jpeg.arrayBuffer()));
        lastUrl = url;
        lastValue = value;
        return value;
    };
}

function install() {
    const native = registerPlugin<YeNative>('YeNative');
    const noop = async () => {};

    const toResponse = (res: NativeResponse): HostResponse => ({
        ok: res.ok,
        status: res.status,
        statusMessage: res.statusMessage,
        error: res.error,
        url: res.url,
        headers: res.headers,
        bytes: res.bodyBase64 != null ? base64ToBytes(res.bodyBase64) : undefined,
    });
    const send = (kind: 'api' | 'image' | 'plugin', req: HostRequest & { blockedHosts?: string[] }) => {
        const payload: Record<string, unknown> = { kind, url: req.url, method: req.method, headers: req.headers, timeoutMs: req.timeoutMs, followRedirects: req.followRedirects, blockedHosts: req.blockedHosts };
        if (typeof req.body === 'string') payload.bodyText = req.body;
        else if (req.body) payload.bodyBase64 = bytesToBase64(req.body);
        return native.request(payload).then(toResponse, error => ({ ok: false, status: 0, error: (error as Error).message } as HostResponse));
    };

    const encodeCover = createCoverEncoder(() => ye);
    const ye: YeApi = {
        platform: 'android',
        version: async () => (await native.version()).value,
        minimize: async () => { await App.minimizeApp(); },
        toggleMaximize: noop,
        toggleFullscreen: noop,
        close: async () => { await App.minimizeApp(); },
        quit: () => native.quit(),
        isMaximized: async () => false,
        isFullscreen: async () => false,
        onWindowStateChanged: () => () => {},
        setCloseToTray: noop,
        setTrayState: noop,
        readFile: async path => base64ToBytes((await native.readFile({ path })).data),
        writeFile: async (path, data) => (await native.writeFile(typeof data === 'string' ? { path, dataText: data } : { path, dataBase64: bytesToBase64(data) })).path,
        exists: async path => (await native.exists({ path })).value,
        showOpenDialog: async options => {
            if (options.directory) return native.pickFolder();
            return native.pickFiles({ multiple: Boolean(options.multiple), extensions: (options.filters || []).flatMap(filter => filter.extensions) });
        },
        showSaveDialog: async options => {
            const name = (options.defaultPath || 'YEmusic').split(/[\\/]/).pop() || 'YEmusic';
            const res = await native.saveFile({ name });
            return res.cancelled ? { cancelled: true } : { cancelled: false, filePath: res.filePath };
        },
        defaultPaths: () => native.defaultPaths(),
        showItemInFolder: noop,
        openPath: async path => (await native.openPath({ path })).value,
        openExternal: url => native.openExternal({ url }),
        scanAudio: async dirs => (await native.scanAudio({ dirs })).files,
        readTags: async (path, withCover = true) => {
            const raw = await native.readTags({ path, withCover });
            return { ...raw, cover: raw.cover ? { data: base64ToBytes(raw.cover.data), format: raw.cover.format } : null };
        },
        readSidecarLyric: async path => {
            const res = await native.readSidecarLyric({ path });
            return res.found && res.data != null ? { encoding: res.encoding || 'auto', data: base64ToBytes(res.data) } : null;
        },
        localAudioUrl: async path => (await native.localAudioUrl({ path })).url,
        fetch: req => send('api', req),
        fetchImage: req => send('image', req),
        pluginFetch: req => send('plugin', req),
        probeUrl: async req => {
            const res = await native.request({ kind: 'probe', url: req.url, headers: req.headers, timeoutMs: req.timeoutMs });
            return { ok: res.ok, status: res.status, error: res.error, contentType: res.contentType || '', url: res.url };
        },
        proxyAudioUrl: async req => (await native.proxyAudioUrl(req)).url,
        download: req => native.download(req as unknown as Record<string, unknown>),
        cancelDownload: async id => (await native.cancelDownload({ id })).value,
        onDownloadProgress: handler => subscribe(native, 'downloadProgress', handler),
        onMediaCommand: handler => subscribe<{ command: string }>(native, 'mediaCommand', event => handler(event.command)),
        readClipboard: async () => (await native.readClipboard()).text,
        saveImage: async req => (await native.saveImage({ dataBase64: bytesToBase64(req.data), name: req.name })).where,
        launchApp: async app => (await native.launchApp({ app })).launched,
        setNowPlaying: async (info: NowPlaying) => {
            const payload: Record<string, unknown> = { hasTrack: info.hasTrack, title: info.title, artist: info.artist, album: info.album, duration: info.duration, position: info.position, playing: info.playing };
            if (info.cover === undefined) payload.coverUnchanged = true;
            else if (info.cover) payload.cover = await encodeCover(info.cover).catch(() => '');
            if (!info.hasTrack) { await native.clearNowPlaying(); return; }
            await native.setNowPlaying(payload);
        },
    };
    window.ye = ye;
}

if (typeof window !== 'undefined' && !window.ye && Capacitor.getPlatform() === 'android') install();
