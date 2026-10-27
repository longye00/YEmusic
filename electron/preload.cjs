/**
 * preload：渲染进程与主进程之间唯一的桥。所有能力都在这里显式列出，没有通用的 invoke 后门。
 */
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

function toPayload(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    throw new Error('unsupported write payload');
}

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ye', {
    platform: process.platform,
    version: invoke('ye:version'),
    minimize: invoke('ye:minimize'),
    toggleMaximize: invoke('ye:toggle-maximize'),
    toggleFullscreen: invoke('ye:toggle-fullscreen'),
    close: invoke('ye:close'),
    quit: invoke('ye:quit'),
    isMaximized: invoke('ye:is-maximized'),
    isFullscreen: invoke('ye:is-fullscreen'),
    onWindowStateChanged: handler => subscribe('ye:window-state', handler),
    setCloseToTray: invoke('ye:set-close-to-tray'),
    setTrayState: invoke('ye:set-tray-state'),

    readFile: invoke('ye:read-file'),
    writeFile: (filePath, data) => ipcRenderer.invoke('ye:write-file', filePath, toPayload(data)),
    exists: invoke('ye:exists'),
    showOpenDialog: invoke('ye:open-dialog'),
    showSaveDialog: invoke('ye:save-dialog'),
    defaultPaths: invoke('ye:default-paths'),
    showItemInFolder: invoke('ye:show-item'),
    openPath: invoke('ye:open-path'),
    openExternal: invoke('ye:open-external'),

    scanAudio: invoke('ye:scan-audio'),
    readTags: invoke('ye:read-tags'),
    readSidecarLyric: invoke('ye:read-sidecar-lyric'),
    localAudioUrl: invoke('ye:local-audio-url'),

    fetch: invoke('ye:fetch'),
    fetchImage: invoke('ye:fetch-image'),
    pluginFetch: invoke('ye:plugin-fetch'),
    probeUrl: invoke('ye:probe-url'),
    proxyAudioUrl: invoke('ye:proxy-audio-url'),

    download: invoke('ye:download'),
    cancelDownload: invoke('ye:cancel-download'),
    onDownloadProgress: handler => subscribe('ye:download-progress', handler),
    onMediaCommand: handler => subscribe('ye:media-command', handler),
});
