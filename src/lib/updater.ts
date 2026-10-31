/**
 * 应用内更新（Windows / Android）。
 *
 * 发布方式：把新版本的安装包与 `update.json` 一起传到 GitHub Releases（见 scripts/make-update-manifest.mjs）。
 * 检查顺序：Release 里的 update.json（权威）→ jsDelivr 上的仓库副本（GitHub 连不上时的兜底，国内常见）。
 * 下载走既有通道（桌面主进程 / Android 原生 Downloader），下完自动拉起安装：
 * Android 由原生层用 FileProvider + ACTION_VIEW 调起系统安装器，Windows 直接运行下载好的 exe。
 * 任何一步失败都只提示或静默跳过，不影响正常使用。
 */
import { host, isAndroid, isDesktop } from './host';
import { requestJson } from './http';
import { sanitizeFileName } from './util';
import { toast } from '@/store/toast';
import { ui, useUi } from '@/store/ui';

/** 仓库地址。换仓库只需要改这一处。 */
const OWNER = 'longye00';
const REPO = 'YEmusic';

/** Release 资产的下载地址（跟随 latest，发新 Release 即自动指向新版） */
const releaseAsset = (name: string) => `https://github.com/${OWNER}/${REPO}/releases/latest/download/${encodeURIComponent(name)}`;
/** 清单的两个来源 */
const MANIFEST_URLS = [
    releaseAsset('update.json'),
    `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@main/update.json`,
];
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;

export interface UpdateManifest {
    version: string;
    /** 更新说明（显示在提示框里） */
    notes: string;
    /** 同一 Release 里的安装包文件名 */
    android: string;
    windows: string;
}

interface RawManifest {
    version?: unknown;
    notes?: unknown;
    android?: unknown;
    windows?: unknown;
}

/** 比较版本号（只取数字段）：>0 表示 a 比 b 新 */
export function compareVersions(a: string, b: string): number {
    const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff) return diff;
    }
    return 0;
}

/** 拉取发布清单；两个来源都失败返回 null */
export async function fetchManifest(): Promise<UpdateManifest | null> {
    for (const url of MANIFEST_URLS) {
        try {
            const raw = await requestJson<RawManifest>(url, { timeout: 8000, retries: 0 });
            if (!raw || typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+/.test(raw.version)) continue;
            return {
                version: raw.version,
                notes: typeof raw.notes === 'string' ? raw.notes : '',
                android: typeof raw.android === 'string' && raw.android ? raw.android : `YEmusic-${raw.version}-android.apk`,
                windows: typeof raw.windows === 'string' && raw.windows ? raw.windows : `YEmusic-setup-${raw.version}.exe`,
            };
        } catch {
            // 换下一个来源
        }
    }
    return null;
}

/** 有可用更新时返回清单，否则 null（检查失败也算“没有更新”） */
export async function checkForUpdate(): Promise<UpdateManifest | null> {
    const manifest = await fetchManifest();
    if (!manifest) return null;
    const local = await host.version().catch(() => '');
    if (!local) return null;
    return compareVersions(manifest.version, local) > 0 ? manifest : null;
}

/** 安装包放到 cacheDir/updates（Android），避免落进音乐目录被曲库扫到 */
async function updateDir(): Promise<string> {
    if (!isAndroid) return '';
    const paths = await host.defaultPaths().catch(() => null);
    return paths?.cache || '';
}

let activeId: string | null = null;
let subscribed = false;

function watchProgress(manifest: UpdateManifest) {
    if (subscribed) return;
    subscribed = true;
    host.onDownloadProgress(event => {
        if (!activeId || event.id !== activeId) return;
        if (event.state === 'progress') {
            const total = event.total || 0;
            const pct = total > 0 ? Math.round(((event.received || 0) / total) * 100) : 0;
            toast(total > 0 ? `正在下载 v${manifest.version}… ${pct}%` : `正在下载 v${manifest.version}…`, 'info', { duration: 1200, key: 'update' });
            return;
        }
        activeId = null;
        if (event.state === 'done') void install(manifest, event.savePath || '');
        else if (event.state === 'error') failed(`更新下载失败：${event.error || '未知错误'}`);
    });
}

function failed(message: string) {
    toast(message, 'error', { duration: 8000, action: { label: '打开下载页', run: () => void host.openExternal(RELEASES_PAGE) } });
}

/** 下载安装包；下载完成后自动安装 */
export async function downloadUpdate(manifest: UpdateManifest): Promise<void> {
    if (activeId) return;
    const fileName = sanitizeFileName(isAndroid ? `YEmusic-${manifest.version}-android.apk` : `YEmusic-${manifest.version}-setup.exe`);
    const url = releaseAsset(isAndroid ? manifest.android : manifest.windows);
    watchProgress(manifest);
    try {
        const saveDir = await updateDir();
        const started = await host.download({ url, fileName, ...(saveDir ? { saveDir } : {}) });
        activeId = started.id;
        toast(`正在下载 v${manifest.version}…`, 'info', { duration: 1500, key: 'update' });
    } catch (error) {
        toast(`无法下载更新：${(error as Error).message || '未知错误'}`, 'error', {
            duration: 8000,
            action: { label: '打开下载页', run: () => void host.openExternal(RELEASES_PAGE) },
        });
    }
}

/** 安装已下载的安装包 */
async function install(manifest: UpdateManifest, savePath: string) {
    if (!savePath) return;
    if (isAndroid) {
        // 原生层用 FileProvider 共享 APK 并调起系统安装器；需要用户在系统设置里允许“安装未知应用”
        const ok = await host.installApk?.({ path: savePath }).catch(() => false);
        if (ok) toast('下载完成，请在系统提示里确认安装', 'success', { duration: 6000 });
        else {
            toast('下载完成，但无法调起安装器。可在浏览器里重新下载安装', 'warning', {
                duration: 8000,
                action: { label: '打开下载页', run: () => void host.openExternal(releaseAsset(manifest.android)) },
            });
        }
        return;
    }
    if (isDesktop) {
        try {
            await host.openPath(savePath);
        } catch {
            try { await host.showItemInFolder(savePath); } catch { /* 提示里给出路径 */ }
            toast(`安装包已下载：${savePath}，请手动运行安装`, 'warning', { duration: 10000 });
        }
    }
}

/** 启动后延迟检查一次；发现新版弹确认框，用户点“下载并更新”才开始下载 */
export function checkForUpdateOnLaunch(delayMs = 4000): void {
    if (!isAndroid && !isDesktop) return;
    setTimeout(() => {
        void checkForUpdate().then(manifest => {
            if (!manifest) return;
            // 启动检查是“顺便”做的：用户正在别的对话框里操作时不打断，下次启动再提示
            if (useUi.getState().dialog) return;
            ui.confirm(
                `发现新版本 v${manifest.version}`,
                manifest.notes ? `${manifest.notes}\n\n下载完成后会自动开始安装，当前的播放与曲库数据都会保留。` : '下载完成后会自动开始安装，当前的播放与曲库数据都会保留。',
                () => void downloadUpdate(manifest),
                { confirmText: '下载并更新' },
            );
        }).catch(() => undefined);
    }, delayMs);
}

/** 设置页的“检查更新”按钮：区分“拉不到清单”“已是最新”“有新版”三种结果 */
export async function checkForUpdateManually(): Promise<void> {
    const manifest = await fetchManifest();
    if (!manifest) {
        toast('检查更新失败：无法连接到发布服务器，请稍后再试', 'error', {
            duration: 6000,
            action: { label: '打开下载页', run: () => void host.openExternal(RELEASES_PAGE) },
        });
        return;
    }
    const local = await host.version().catch(() => '');
    if (local && compareVersions(manifest.version, local) <= 0) {
        toast(`已是最新版本 v${local}`, 'success');
        return;
    }
    ui.confirm(
        `发现新版本 v${manifest.version}`,
        `${manifest.notes ? `${manifest.notes}\n\n` : ''}下载完成后会自动开始安装，当前的播放与曲库数据都会保留。`,
        () => void downloadUpdate(manifest),
        { confirmText: '下载并更新' },
    );
}
