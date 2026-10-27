export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "04:29" / "1:02:03" / 秒数 → 秒 */
export function parseDuration(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const text = String(value ?? '').trim();
    if (!text) return 0;
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    return text.split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0);
}

export function formatSize(bytes: number): string {
    if (!bytes || bytes < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(unit >= 2 ? 2 : 0)}${units[unit]}`;
}

export function formatCount(count: number): string {
    if (!count) return '0';
    if (count >= 1e8) return `${(count / 1e8).toFixed(1)}亿`;
    if (count >= 1e4) return `${(count / 1e4).toFixed(1)}万`;
    return String(count);
}

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
export function decodeEntities(text: unknown): string {
    return String(text ?? '')
        .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENTITY[m] ?? m)
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

export function uid(prefix = 'id'): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: Parameters<T>) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

/** 用于跨平台匹配同一首歌：去掉括号内容、空白和标点。 */
export function normalizeTitle(text: string): string {
    return String(text || '')
        .toLowerCase()
        .replace(/[（(【\[].*?[)）】\]]/g, '')
        .replace(/\s+|[·・\-_,，.。、'"!！?？:：;；~～]/g, '')
        .trim();
}

export function normalizeArtist(text: string): string[] {
    return String(text || '')
        .toLowerCase()
        .split(/[、,，/&;；|]|\s+feat\.?\s+|\s+ft\.?\s+/)
        .map(s => s.trim())
        .filter(Boolean);
}

export function sanitizeFileName(name: string): string {
    return String(name || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 180) || 'download';
}

/** 基于字符串的确定性伪随机数（用于歌词散布等需要“稳定随机”的效果）。 */
export function seededRandom(seed: string | number) {
    let h = 1779033703 ^ String(seed).length;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
}

/** 把各平台封面地址换成合适尺寸的缩略图，列表中的小封面不再加载 500px 大图 */
export function thumbUrl(url: string | undefined, cssPx: number): string | undefined {
    if (!url || !/^https?:/i.test(url)) return url;
    const px = Math.ceil(cssPx * Math.min(2, Math.max(1.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1)));
    const pick = (sizes: number[]) => sizes.find(s => s >= px) ?? sizes[sizes.length - 1];
    if (/music\.126\.net/.test(url)) {
        // 固定几档尺寸：同一张封面在不同大小的格子里尽量复用同一个请求
        const size = pick([120, 200, 300, 400, 600]);
        return /[?&]param=\d+y\d+/.test(url) ? url.replace(/([?&])param=\d+y\d+/, `$1param=${size}y${size}`) : `${url}${url.includes('?') ? '&' : '?'}param=${size}y${size}`;
    }
    if (/y\.gtimg\.cn\/music\/photo_new\/T00\dR\d+x\d+M/.test(url)) {
        const size = pick([150, 300, 500]);
        return url.replace(/(T00\d)R\d+x\d+M/, `$1R${size}x${size}M`);
    }
    if (/kugou\.com\/(stdmusic|soft\/collection|uploadpic|singerimg\/softhead)\/\d+\//.test(url)) {
        const size = pick([120, 150, 240, 400, 480]);
        return url.replace(/(kugou\.com\/(?:stdmusic|soft\/collection|uploadpic|singerimg\/softhead))\/\d+\//, `$1/${size}/`);
    }
    if (/kuwo\.cn\/star\/albumcover\/\d+\//.test(url)) {
        const size = pick([120, 300, 500]);
        return url.replace(/(\/star\/albumcover)\/\d+\//, `$1/${size}/`);
    }
    return url;
}
