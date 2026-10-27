/**
 * YEmusic 主进程。
 *
 * 职责：窗口生命周期、渲染进程无法完成的文件/网络操作、下载、托盘。
 * 所有播放逻辑都在渲染进程中。安全策略：contextIsolation + sandbox，渲染进程只能通过 preload 暴露的 `ye` API 访问主进程。
 */
const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, session, screen } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { request, isPublicHost, hostMatches, publicLookup, DEFAULT_UA } = require('./net.cjs');
const { startAudioProxy, stopAudioProxy, proxyRemoteUrl, proxyLocalFile } = require('./audioProxy.cjs');
const { scanAudioFiles, readTags, readSidecarLyric } = require('./library.cjs');
const { writeTags } = require('./tags.cjs');
const { updateThumbar } = require('./thumbar.cjs');

const DEV_SERVER_URL = process.env.YEMUSIC_DEV_SERVER_URL;
const isDev = Boolean(DEV_SERVER_URL);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let tray = null;
let closeToTray = false;
let quitting = false;
let trayState = { title: 'YEmusic', playing: false };
const downloads = new Map();

function resolveResource(relativePath) {
    const candidates = [
        path.join(__dirname, '..', relativePath),
        path.join(process.resourcesPath || '', relativePath),
        path.join(process.resourcesPath || '', 'app.asar', relativePath),
    ];
    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || candidates[0];
}

const FETCH_ALLOWED_HOSTS = JSON.parse(fs.readFileSync(resolveResource('shared/proxy-hosts.json'), 'utf8')).hosts;

// ---------- 可写目录（下载目录由用户在对话框中选择后加入） ----------
const allowedDirsFile = () => path.join(app.getPath('userData'), 'allowed-dirs.json');
let userDirs = new Set();
function loadUserDirs() {
    try { userDirs = new Set(JSON.parse(fs.readFileSync(allowedDirsFile(), 'utf8'))); } catch { userDirs = new Set(); }
}
function rememberDirs(paths) {
    let changed = false;
    for (const p of paths || []) {
        const resolved = path.resolve(String(p));
        if (!userDirs.has(resolved)) { userDirs.add(resolved); changed = true; }
    }
    if (changed) fsp.writeFile(allowedDirsFile(), JSON.stringify([...userDirs])).catch(() => {});
}
function assertWritablePath(filePath) {
    const resolved = path.resolve(String(filePath));
    if (resolved.includes('\0')) throw new Error('invalid path');
    const roots = [app.getPath('downloads'), app.getPath('music'), app.getPath('userData'), app.getPath('documents'), ...userDirs];
    if (!roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) {
        throw new Error('只能写入下载、音乐、文档目录或你选择过的文件夹');
    }
    return resolved;
}
/** 读取同样限制在已知目录内：渲染进程被攻破时不能任意读磁盘（备份导入的文件都是经对话框选择的，其所在目录会被记住） */
function assertReadablePath(filePath) {
    const resolved = path.resolve(String(filePath));
    if (resolved.includes('\0')) throw new Error('invalid path');
    const roots = [app.getPath('downloads'), app.getPath('music'), app.getPath('userData'), app.getPath('documents'), app.getPath('desktop'), ...userDirs];
    if (!roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) {
        throw new Error('只能读取下载、音乐、文档、桌面目录或你选择过的文件夹');
    }
    return resolved;
}

// ---------- 窗口状态 ----------
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
    try {
        const state = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
        const area = screen.getDisplayMatching(state).workArea;
        if (state.width >= 940 && state.height >= 600 && state.x >= area.x - 50 && state.y >= area.y - 50) return state;
    } catch {}
    return { width: 1280, height: 820 };
}
function saveWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    fsp.writeFile(windowStateFile(), JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() })).catch(() => {});
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => showWindow());
    void bootstrap();
}

async function bootstrap() {
    await app.whenReady();
    loadUserDirs();
    if (process.env.YEMUSIC_PROXY) {
        session.defaultSession.setProxy({ proxyRules: process.env.YEMUSIC_PROXY }).catch(() => {});
    }
    await startAudioProxy().catch(error => console.warn('[main] audio proxy unavailable', error));
    registerIpc();
    createMainWindow();
    createTray();
    app.on('activate', () => { if (!mainWindow) createMainWindow(); else showWindow(); });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
    app.on('before-quit', () => { quitting = true; saveWindowState(); stopAudioProxy(); });
}

function showWindow() {
    if (!mainWindow) { createMainWindow(); return; }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function createMainWindow() {
    const state = loadWindowState();
    mainWindow = new BrowserWindow({
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        minWidth: 940,
        minHeight: 600,
        show: false,
        frame: false,
        backgroundColor: '#050507',
        // Windows 直接使用 exe 内嵌的多尺寸图标（asar 内的 .ico 无法被系统 API 读取）
        icon: process.platform === 'linux' ? resolveResource('build/icon.png') : undefined,
        titleBarStyle: 'hidden',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: false,
        },
    });
    if (state.maximized) mainWindow.maximize();
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        refreshThumbar();
    });
    // 任务栏按钮在窗口隐藏到托盘后再显示时会被系统清除，需要重新设置
    mainWindow.on('show', () => refreshThumbar());
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!(isDev && url.startsWith(DEV_SERVER_URL)) && !url.startsWith('file:')) event.preventDefault();
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F12' && (isDev || input.control || input.meta)) {
            mainWindow.webContents.toggleDevTools();
        }
    });
    const emitWindowState = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('ye:window-state', {
            maximized: mainWindow.isMaximized(),
            fullscreen: mainWindow.isFullScreen(),
            focused: mainWindow.isFocused(),
        });
    };
    ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'].forEach(name => mainWindow.on(name, emitWindowState));
    mainWindow.on('resize', debounce(saveWindowState, 500));
    mainWindow.on('move', debounce(saveWindowState, 500));
    mainWindow.on('close', event => {
        saveWindowState();
        if (closeToTray && !quitting && tray) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    if (isDev) void mainWindow.loadURL(DEV_SERVER_URL);
    else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

function debounce(fn, ms) {
    let timer = null;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createTray() {
    if (tray) return;
    try {
        const iconPath = resolveResource('build/icon.png');
        if (!fs.existsSync(iconPath)) return;
        // Windows 托盘按系统缩放取对应像素尺寸，避免高 DPI 下图标发糊（ICO 位于 asar 内时系统 API 读不到，所以用 PNG 缩放）
        const scale = process.platform === 'win32' ? Math.min(3, Math.max(1, screen.getPrimaryDisplay()?.scaleFactor || 1)) : 1;
        const size = Math.round(16 * scale);
        const image = nativeImage.createFromPath(iconPath).resize({ width: size, height: size, quality: 'best' });
        tray = new Tray(image);
        tray.on('click', () => showWindow());
        updateTray();
    } catch (error) {
        console.warn('[main] tray unavailable', error);
    }
}

function refreshThumbar() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    let scale = 1;
    try { scale = screen.getDisplayMatching(mainWindow.getBounds()).scaleFactor || 1; } catch { /* ignore */ }
    updateThumbar(mainWindow, trayState, command => send('ye:media-command', command), scale);
}

function updateTray() {
    refreshThumbar();
    if (!tray) return;
    tray.setToolTip(String(trayState.title || 'YEmusic').slice(0, 120));
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: String(trayState.title || 'YEmusic').slice(0, 40), enabled: false },
        { type: 'separator' },
        { label: trayState.playing ? '暂停' : '播放', click: () => send('ye:media-command', 'playpause') },
        { label: '上一首', click: () => send('ye:media-command', 'previous') },
        { label: '下一首', click: () => send('ye:media-command', 'next') },
        { type: 'separator' },
        { label: '显示主界面', click: () => showWindow() },
        { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
}

function registerIpc() {
    // ---- 窗口 ----
    ipcMain.handle('ye:minimize', () => mainWindow?.minimize());
    ipcMain.handle('ye:toggle-maximize', () => {
        if (!mainWindow) return;
        if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    });
    ipcMain.handle('ye:toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));
    ipcMain.handle('ye:close', () => mainWindow?.close());
    ipcMain.handle('ye:quit', () => { quitting = true; app.quit(); });
    ipcMain.handle('ye:is-maximized', () => Boolean(mainWindow?.isMaximized()));
    ipcMain.handle('ye:is-fullscreen', () => Boolean(mainWindow?.isFullScreen()));
    ipcMain.handle('ye:version', () => app.getVersion());
    ipcMain.handle('ye:set-close-to-tray', (_e, value) => { closeToTray = Boolean(value); });
    ipcMain.handle('ye:set-tray-state', (_e, state) => {
        trayState = { title: String(state?.title || 'YEmusic'), playing: Boolean(state?.playing) };
        updateTray();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(trayState.title);
    });

    // ---- 文件 ----
    ipcMain.handle('ye:read-file', async (_e, filePath) => fsp.readFile(assertReadablePath(filePath)));
    ipcMain.handle('ye:write-file', async (_e, filePath, data) => {
        const target = assertWritablePath(filePath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, typeof data === 'string' ? data : Buffer.from(data));
        return target;
    });
    ipcMain.handle('ye:exists', (_e, filePath) => fs.existsSync(path.resolve(String(filePath))));
    ipcMain.handle('ye:open-dialog', async (_e, options = {}) => {
        if (!mainWindow) return { cancelled: true, paths: [] };
        const properties = [options.directory ? 'openDirectory' : 'openFile'];
        if (options.multiple) properties.push('multiSelections');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: options.title || '打开',
            properties,
            filters: options.directory ? undefined : (options.filters || [{ name: '音频', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'opus', 'aac', 'ape', 'wma'] }]),
        });
        if (!result.canceled && options.directory) rememberDirs(result.filePaths);
        // 记住所选文件的目录：随后的 read-file（如导入备份）才能通过读取校验
        if (!result.canceled && !options.directory) rememberDirs(result.filePaths.map(p => path.dirname(p)));
        return { cancelled: result.canceled, paths: result.filePaths };
    });
    ipcMain.handle('ye:save-dialog', async (_e, options = {}) => {
        if (!mainWindow) return { cancelled: true };
        const result = await dialog.showSaveDialog(mainWindow, { title: options.title || '保存', defaultPath: options.defaultPath, filters: options.filters });
        if (!result.canceled && result.filePath) rememberDirs([path.dirname(result.filePath)]);
        return { cancelled: result.canceled, filePath: result.filePath };
    });
    ipcMain.handle('ye:default-paths', () => ({ downloads: app.getPath('downloads'), music: app.getPath('music'), userData: app.getPath('userData') }));
    ipcMain.handle('ye:show-item', (_e, filePath) => shell.showItemInFolder(path.resolve(String(filePath))));
    ipcMain.handle('ye:open-path', (_e, filePath) => shell.openPath(path.resolve(String(filePath))));
    ipcMain.handle('ye:open-external', (_e, url) => {
        if (/^https?:/i.test(String(url))) return shell.openExternal(String(url));
        throw new Error('only http(s) URLs may be opened externally');
    });

    // ---- 本地曲库 ----
    ipcMain.handle('ye:scan-audio', (_e, dirs) => scanAudioFiles(dirs));
    ipcMain.handle('ye:read-tags', (_e, filePath, withCover) => readTags(path.resolve(String(filePath)), withCover !== false));
    ipcMain.handle('ye:read-sidecar-lyric', (_e, filePath) => readSidecarLyric(path.resolve(String(filePath))));
    ipcMain.handle('ye:local-audio-url', (_e, filePath) => proxyLocalFile(filePath));

    // ---- 网络 ----
    // 平台元数据接口：限定在白名单域名内
    const allowlisted = target => (hostMatches(target.hostname, FETCH_ALLOWED_HOSTS) ? null : `host not allowed: ${target.hostname}`);
    ipcMain.handle('ye:fetch', async (_e, req) => {
        const result = await request({ ...req, validate: allowlisted, maxBytes: 16 * 1024 * 1024 });
        return result;
    });
    // 图片：任意公网域名，但只接受图片类型，供封面取色使用
    ipcMain.handle('ye:fetch-image', async (_e, req) => {
        const result = await request({
            url: req?.url,
            headers: req?.headers,
            timeoutMs: 15000,
            maxBytes: 8 * 1024 * 1024,
            validate: target => (isPublicHost(target.hostname) ? null : 'host not allowed'),
        });
        if (result.ok && !/^image\//i.test(result.headers?.['content-type'] || '') && !looksLikeImage(result.bytes)) {
            return { ok: false, status: result.status, error: 'not an image' };
        }
        return result;
    });
    // 音源脚本请求：脚本的接口域名无法预知，因此允许任意公网域名，但排除用户屏蔽的域名
    ipcMain.handle('ye:plugin-fetch', async (_e, req) => {
        const blocked = Array.isArray(req?.blockedHosts) ? req.blockedHosts : [];
        return request({
            ...req,
            maxBytes: 24 * 1024 * 1024,
            validate: target => {
                if (!isPublicHost(target.hostname)) return `host not allowed: ${target.hostname}`;
                if (hostMatches(target.hostname, blocked)) return `blocked host: ${target.hostname}`;
                return null;
            },
        });
    });
    // 播放前探测：只取前 2 字节，判断链接是否已失效（403/404/410 等）
    ipcMain.handle('ye:probe-url', async (_e, req) => {
        const result = await request({
            url: req?.url,
            headers: req?.headers,
            range: 2,
            timeoutMs: Number(req?.timeoutMs) || 8000,
            validate: target => (isPublicHost(target.hostname) ? null : 'host not allowed'),
        });
        return { ok: result.ok, status: result.status, error: result.error, contentType: result.headers?.['content-type'] || '', url: result.url };
    });
    ipcMain.handle('ye:proxy-audio-url', (_e, req) => proxyRemoteUrl(req?.url, req?.headers));

    // ---- 下载 ----
    ipcMain.handle('ye:download', async (_e, req) => {
        const { url, fileName, headers = {}, saveDir, tags } = req || {};
        if (!/^https?:/i.test(String(url))) throw new Error('only http(s) downloads are allowed');
        if (!fileName || /[\\/]|\.\./.test(fileName) || /[\x00-\x1f]/.test(fileName)) throw new Error('invalid file name');
        const directory = saveDir ? assertWritablePath(saveDir) : app.getPath('downloads');
        await fsp.mkdir(directory, { recursive: true });
        const target = path.join(directory, fileName);
        const id = `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const meta = tags && typeof tags === 'object'
            ? { title: String(tags.title || ''), artist: String(tags.artist || ''), album: String(tags.album || ''), lyric: String(tags.lyric || ''), cover: /^https?:/i.test(String(tags.cover || '')) ? String(tags.cover) : '' }
            : null;
        streamToFile(url, headers, target, id, 0, meta);
        return { id, savePath: target };
    });
    ipcMain.handle('ye:cancel-download', (_e, id) => {
        const entry = downloads.get(id);
        if (!entry) return false;
        entry.cancelled = true;
        entry.request?.destroy();
        downloads.delete(id);
        return true;
    });
}

function looksLikeImage(bytes) {
    if (!bytes || bytes.length < 4) return false;
    const b = bytes;
    return (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x47 && b[1] === 0x49) || (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57);
}

/** 下载完成后写入标签与封面；失败只记录日志，不影响下载结果 */
async function embedTags(filePath, meta) {
    if (!meta) return;
    try {
        let cover = null;
        if (meta.cover) {
            const res = await request({ url: meta.cover, timeoutMs: 10000, maxBytes: 6 * 1024 * 1024, validate: target => (isPublicHost(target.hostname) ? null : 'host not allowed') });
            if (res.ok && looksLikeImage(res.bytes)) cover = Buffer.from(res.bytes);
        }
        await writeTags(filePath, meta, cover);
    } catch (error) {
        console.warn('[download] 写入标签失败', error?.message || error);
    }
}

function streamToFile(url, headers, target, id, hops, meta) {
    let parsed;
    try { parsed = new URL(url); } catch { send('ye:download-progress', { id, state: 'error', error: 'invalid url' }); return; }
    if (!isPublicHost(parsed.hostname)) { send('ye:download-progress', { id, state: 'error', error: 'host not allowed' }); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const entry = downloads.get(id) || { cancelled: false };
    downloads.set(id, entry);
    const req = client.get(parsed, { headers: { 'user-agent': DEFAULT_UA, accept: '*/*', ...headers }, timeout: 60000, lookup: publicLookup }, res => {
        if (entry.cancelled) { res.resume(); return; }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (hops > 8) { send('ye:download-progress', { id, state: 'error', error: 'too many redirects' }); return; }
            streamToFile(new URL(res.headers.location, url).toString(), headers, target, id, hops + 1, meta);
            return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume();
            downloads.delete(id);
            send('ye:download-progress', { id, state: 'error', error: `HTTP ${res.statusCode}` });
            return;
        }
        const total = Number(res.headers['content-length'] || 0);
        const temp = `${target}.part`;
        const file = fs.createWriteStream(temp);
        let received = 0;
        let lastEmit = 0;
        res.on('data', chunk => {
            received += chunk.length;
            const now = Date.now();
            if (now - lastEmit > 150) {
                lastEmit = now;
                send('ye:download-progress', { id, state: 'progress', received, total });
            }
        });
        res.pipe(file);
        file.on('finish', () => {
            file.close(async () => {
                downloads.delete(id);
                if (entry.cancelled) { await fsp.unlink(temp).catch(() => {}); return; }
                try {
                    await embedTags(temp, meta);
                    if (entry.cancelled) { await fsp.unlink(temp).catch(() => {}); return; }
                    await fsp.rename(temp, target);
                    send('ye:download-progress', { id, state: 'done', received, total, savePath: target });
                } catch (error) {
                    send('ye:download-progress', { id, state: 'error', error: error.message });
                }
            });
        });
        const onError = error => {
            downloads.delete(id);
            file.destroy();
            void fsp.unlink(temp).catch(() => {});
            if (!entry.cancelled) send('ye:download-progress', { id, state: 'error', error: error.message });
        };
        file.on('error', onError);
        res.on('error', onError);
        res.on('aborted', () => onError(new Error('连接中断')));
    });
    entry.request = req;
    req.on('error', error => {
        downloads.delete(id);
        if (!entry.cancelled) send('ye:download-progress', { id, state: 'error', error: error.message });
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
}

app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
