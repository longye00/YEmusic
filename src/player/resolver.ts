/**
 * 播放链接解析。修复 0.1.x “同一个失效链接无限重试”的问题：
 *   1. 音质按偏好从高到低依次尝试（可选自动降级 / 升级）；
 *   2. 同一音质下多个音源错峰并发（首个可用即采用），失效音源按平台自动降权；
 *   3. 每个链接先做 2 字节探测，过滤 403/404/410、HTML/JSON 错误页；
 *   4. 全部失败时可按“歌名 + 歌手 + 时长”匹配其他平台的同一首歌再试；
 *   5. 最终给出汇总的中文错误原因，交给播放器决定跳过还是停止。
 */
import { host } from '@/lib/host';
import { normalizeArtist, normalizeTitle } from '@/lib/util';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, PLATFORMS, QUALITY_NAMES, QUALITY_ORDER, type Platform, type Quality, type Track } from '@/sdk/types';
import { callSource, isAggregateSource, markSourceResult, sourcesFor, useSources } from '@/store/sources';
import { useSettings } from '@/store/settings';
import { toLxMusicInfo } from './musicInfo';

export interface Resolved {
    url: string;
    quality?: Quality;
    sourceId?: string;
    sourceName?: string;
    platform?: Platform;
    /** 跨平台换源时实际使用的歌曲 */
    via?: Track;
    local?: boolean;
    /** 探测超时、未能确认可用的链接：没有更好的选择时才使用 */
    weak?: boolean;
}

export class ResolveError extends Error {
    constructor(message: string, public details: string[] = []) {
        super(message);
    }
}

interface CacheEntry extends Resolved { time: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 12 * 60 * 1000;
const STAGGER_MS = 2500;
const CALL_TIMEOUT = 12000;
/** 原平台解析的总时长预算；超时后转去其他平台匹配，避免长时间“正在获取链接” */
const DIRECT_BUDGET = 16000;
const ALT_BUDGET = 11000;

/**
 * 熔断：域名失效 / 连不上 / 超时的音源，以及连续返回失效链接的“音源 + 平台”，
 * 在一段时间内直接跳过，后续歌曲不再反复等待它们超时。
 */
const circuit = new Map<string, { until: number; reason: string }>();
const badLinks = new Map<string, number>();
function openCircuit(key: string, ms: number, reason: string) {
    circuit.set(key, { until: Date.now() + ms, reason });
}
function circuitOpen(sourceId: string, platform: Platform) {
    const now = Date.now();
    for (const key of [sourceId, `${sourceId}|${platform}`]) {
        const entry = circuit.get(key);
        if (entry && entry.until > now) return true;
        if (entry) circuit.delete(key);
    }
    return false;
}
const log = (...args: unknown[]) => console.info('[resolve]', ...args);

export function resetCircuits() {
    circuit.clear();
    badLinks.clear();
}
/** 播放器实际加载失败时调用：同一音源在该平台连续给出坏链接则暂时跳过 */
export function reportBadLink(sourceId: string | undefined, platform: Platform | undefined) {
    if (!sourceId || !platform) return;
    const key = `${sourceId}|${platform}`;
    const count = (badLinks.get(key) || 0) + 1;
    badLinks.set(key, count);
    if (count >= 2) openCircuit(key, 5 * 60 * 1000, '连续返回无法播放的链接');
}

export function invalidateUrl(url: string) {
    for (const [key, value] of cache) if (value.url === url) cache.delete(key);
}

export function clearUrlCache() {
    cache.clear();
}

export interface ResolveOptions {
    quality?: Quality;
    /** 已经失败过的链接 */
    exclude?: Set<string>;
    /** 只用指定音源 */
    onlySource?: string;
    allowSwitch?: boolean;
    /** 本次播放中已经给出过坏链接的“音源|平台” */
    excludeSources?: Set<string>;
    onStatus?: (text: string) => void;
}

export function qualityCandidates(track: Track, preferred: Quality, fallback: boolean): Quality[] {
    const index = Math.max(0, QUALITY_ORDER.indexOf(preferred));
    const lower = QUALITY_ORDER.slice(index);
    const higher = QUALITY_ORDER.slice(0, index).reverse();
    let list = fallback ? [...lower, ...higher] : lower;
    const available = new Set((track.qualities || []).map(q => q.type));
    if (available.size) {
        const filtered = list.filter(q => available.has(q));
        if (filtered.length) list = filtered;
    }
    if (!fallback) return list.slice(0, 1);
    if (!list.includes('128k')) list.push('128k');
    return list;
}

function friendly(message: string): string {
    const text = String(message || '');
    if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(text)) return '服务器域名无法解析（音源可能已失效）';
    if (/ECONNREFUSED|ECONNRESET|socket hang up|EHOSTUNREACH|ENETUNREACH/i.test(text)) return '无法连接到音源服务器';
    if (/timed? ?out|超时/i.test(text)) return '响应超时';
    if (/certificate|SSL|TLS/i.test(text)) return '服务器证书错误';
    if (/unknow error/i.test(text)) return '音源返回未知错误（服务可能已停止）';
    if (/failed$/i.test(text)) return '获取失败';
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

const isFatal = (message: string) => /域名无法解析|无法连接|响应超时|证书|服务可能已停止|HTTP 5\d\d|Bad Gateway|Service Unavailable|Gateway Time/i.test(message);
/** 熔断时长：域名失效最久，超时 / 5xx 较短 */
function circuitMs(message: string) {
    if (/域名无法解析|服务可能已停止|证书/.test(message)) return 15 * 60 * 1000;
    if (/无法连接/.test(message)) return 5 * 60 * 1000;
    return 2 * 60 * 1000;
}

function judgeProbe(probe: { ok: boolean; status: number; error?: string; contentType: string }): string | null {
    if (probe.status === 0) {
        if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ECONNRESET|socket hang up|host not allowed/i.test(probe.error || '')) return `链接无法访问（${friendly(probe.error || '')}）`;
        return null; // 探测超时等不确定情况：作为备选，没有更好的链接时交给播放器实际尝试
    }
    if (probe.status === 416) return null;
    if (probe.status >= 400) return `链接已失效（HTTP ${probe.status}）`;
    if (/text\/html|application\/json|text\/plain|xml/i.test(probe.contentType || '')) return '链接返回的不是音频';
    return null;
}

interface Attempt { record: { id: string; name: string }; qualitys: Quality[] }

async function tryOne(track: Track, platform: Platform, quality: Quality, candidate: Attempt, options: ResolveOptions, errors: string[], skip: Set<string>, deadline: number): Promise<Resolved | null> {
    const { record } = candidate;
    // 聚合音源内部有多个子源：给出的链接失效时带上失败链接再请求一次，它会换用其他子源
    const aggregate = isAggregateSource(record.id);
    const failed: string[] = aggregate ? [...(options.exclude || [])].slice(-8) : [];
    const maxAttempts = aggregate ? 3 : 1;
    try {
        for (let attempt = 1; ; attempt++) {
            const started = Date.now();
            const info: Record<string, unknown> = { type: quality, musicInfo: toLxMusicInfo(track) };
            if (aggregate && failed.length) info.ye = { exclude: failed };
            const raw = await callSource(record.id, platform, 'musicUrl', info, CALL_TIMEOUT);
            const url = typeof raw === 'string' ? raw.trim() : String((raw as { url?: string })?.url || '');
            if (!/^https?:\/\//i.test(url)) throw new Error('返回的不是有效链接');
            const retry = (reason: string) => {
                if (!aggregate || attempt >= maxAttempts || deadline - Date.now() < 3000) return false;
                log(record.name, platform, quality, `retry #${attempt}:`, reason);
                failed.push(url);
                return true;
            };
            if (options.exclude?.has(url)) {
                if (retry('excluded')) continue;
                throw new Error('链接刚刚播放失败');
            }
            const probe = await host.probeUrl({ url, timeoutMs: 6000 });
            const verdict = judgeProbe(probe);
            log(record.name, platform, quality, `${Date.now() - started}ms`, probe.status, probe.contentType, verdict || 'ok', url.slice(0, 120));
            if (verdict) {
                if (retry(verdict)) continue;
                // 同一音源在该平台连续返回失效链接（常见于版权 / 地区限制），后续音质不再向它请求
                if (/HTTP (403|451)|不是音频/.test(verdict)) {
                    skip.add(record.id);
                    reportBadLink(record.id, platform);
                }
                throw new Error(verdict);
            }
            if (probe.status === 0) return { url, quality, sourceId: record.id, sourceName: record.name, platform, weak: true };
            markSourceResult(record.id, true, platform);
            badLinks.delete(`${record.id}|${platform}`);
            return { url, quality, sourceId: record.id, sourceName: record.name, platform };
        }
    } catch (error) {
        const message = friendly((error as Error).message);
        log(record.name, platform, quality, 'failed:', message);
        errors.push(`${record.name} · ${QUALITY_NAMES[quality]}：${message}`);
        markSourceResult(record.id, false, platform);
        // 聚合音源的报错只代表这一次没取到，不熔断整个音源
        if (isFatal(message) && !aggregate) {
            skip.add(record.id);
            openCircuit(/HTTP 5|Gateway|Unavailable/i.test(message) ? `${record.id}|${platform}` : record.id, circuitMs(message), message);
        }
        return null;
    }
}

/** 同一音质下错峰并发：第一个源先跑，2.5 秒没结果再启动下一个，任何一个失败立即补位。 */
function race(track: Track, platform: Platform, quality: Quality, list: Attempt[], options: ResolveOptions, errors: string[], skip: Set<string>, deadline: number): Promise<Resolved | null> {
    return new Promise(resolve => {
        let index = 0;
        let running = 0;
        let finished = false;
        let weakHit: Resolved | null = null;
        const timer = setTimeout(() => end(weakHit), Math.max(0, deadline - Date.now()));
        const end = (value: Resolved | null) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(value);
        };
        const next = () => {
            if (finished) return;
            while (index < list.length && skip.has(list[index].record.id)) index++;
            if (index >= list.length) {
                if (running === 0) end(weakHit);
                return;
            }
            const candidate = list[index++];
            running++;
            const stagger = setTimeout(next, STAGGER_MS);
            tryOne(track, platform, quality, candidate, options, errors, skip, deadline).then(hit => {
                running--;
                clearTimeout(stagger);
                if (hit && !hit.weak) end(hit);
                else {
                    if (hit && !weakHit) weakHit = hit;
                    next();
                }
            });
        };
        next();
    });
}

async function resolveOnPlatform(track: Track, options: ResolveOptions, errors: string[], budget = DIRECT_BUDGET): Promise<Resolved | null> {
    const platform = track.source as Platform;
    const settings = useSettings.getState();
    const qualities = qualityCandidates(track, options.quality || settings.quality, settings.qualityFallback || Boolean(options.quality));
    let sources: Attempt[] = sourcesFor(platform);
    if (options.onlySource) sources = sources.filter(s => s.record.id === options.onlySource);
    if (!sources.length) {
        errors.push(`${PLATFORM_NAMES[platform]}：没有可用的音源`);
        return null;
    }
    const skip = new Set<string>();
    for (const s of sources) if (options.excludeSources?.has(`${s.record.id}|${platform}`)) skip.add(s.record.id);
    // 熔断中的音源先跳过；如果全部都在熔断中，新歌曲仍会逐个尝试一次（网络可能已恢复），重试时则直接换平台
    if (!options.onlySource) {
        const healthy = sources.filter(s => !skip.has(s.record.id) && !circuitOpen(s.record.id, platform));
        if (healthy.length || options.excludeSources?.size) for (const s of sources) if (!healthy.includes(s)) skip.add(s.record.id);
    }
    if (skip.size >= sources.length) {
        errors.push(`${PLATFORM_NAMES[platform]}：音源刚刚都无法播放这首歌`);
        return null;
    }
    const deadline = Date.now() + budget;
    let weak: Resolved | null = null;
    for (const quality of qualities) {
        if (Date.now() >= deadline) {
            errors.push(`${PLATFORM_NAMES[platform]}：获取链接超时`);
            break;
        }
        const key = `${track.id}|${quality}|${options.onlySource || ''}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.time < CACHE_TTL && !options.exclude?.has(hit.url)) return hit;
        const list = sources.filter(s => !s.qualitys.length || s.qualitys.includes(quality));
        if (!list.length) continue;
        options.onStatus?.(`正在获取${QUALITY_NAMES[quality]}链接…`);
        const result = await race(track, platform, quality, list, options, errors, skip, deadline);
        if (result && !result.weak) {
            cache.set(key, { ...result, time: Date.now() });
            return result;
        }
        if (result && !weak) weak = result;
        if (skip.size >= sources.length) break;
    }
    return weak;
}

/** 多个平台的同名歌曲错峰并发解析（失败立即补位），先拿到可用链接的胜出 */
function raceAlternatives(alternatives: Track[], options: ResolveOptions, errors: string[]): Promise<Resolved | null> {
    return new Promise(resolve => {
        let index = 0;
        let running = 0;
        let done = false;
        let weak: Resolved | null = null;
        const finish = (value: Resolved | null) => {
            if (done) return;
            done = true;
            resolve(value);
        };
        const next = () => {
            if (done) return;
            if (index >= alternatives.length) {
                if (running === 0) finish(weak);
                return;
            }
            const alt = alternatives[index++];
            running++;
            const stagger = setTimeout(next, 2000);
            resolveOnPlatform(alt, { ...options, onStatus: undefined }, errors, ALT_BUDGET)
                .catch(() => null)
                .then(result => {
                    running--;
                    clearTimeout(stagger);
                    if (result && !result.weak) return finish({ ...result, via: alt });
                    if (result && !weak) weak = { ...result, via: alt };
                    next();
                });
        };
        next();
    });
}

function matchScore(origin: Track, other: Track): number {
    const a = normalizeTitle(origin.name);
    const b = normalizeTitle(other.name);
    if (!a || !b) return 0;
    let score = a === b ? 1 : a.includes(b) || b.includes(a) ? 0.7 : 0;
    if (!score) return 0;
    const artistsA = normalizeArtist(origin.singer);
    const artistsB = normalizeArtist(other.singer);
    if (artistsA.length && artistsB.length) score *= artistsA.some(x => artistsB.some(y => x === y || x.includes(y) || y.includes(x))) ? 1 : 0.3;
    if (origin.duration && other.duration) {
        const diff = Math.abs(origin.duration - other.duration);
        score *= diff <= 3 ? 1 : diff <= 8 ? 0.85 : 0.4;
    }
    return score;
}

/** 在其他平台查找同一首歌 */
export async function findAlternatives(track: Track, platforms: Platform[] = PLATFORMS): Promise<Track[]> {
    const keyword = `${track.name} ${normalizeArtist(track.singer)[0] || ''}`.trim();
    const results = await Promise.allSettled(platforms.filter(p => p !== track.source).map(p => sdks[p].search(keyword, 1, 8)));
    const found: { track: Track; score: number }[] = [];
    for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        let best: { track: Track; score: number } | null = null;
        for (const item of result.value.list) {
            const score = matchScore(track, item);
            if (score >= 0.6 && (!best || score > best.score)) best = { track: item, score };
        }
        if (best) found.push(best);
    }
    return found.sort((x, y) => y.score - x.score).map(x => x.track);
}

export async function resolveUrl(track: Track, options: ResolveOptions = {}): Promise<Resolved> {
    if (track.source === 'local') {
        if (!track.path) throw new ResolveError('本地文件路径缺失');
        if (!(await host.exists(track.path))) throw new ResolveError('本地文件不存在或已被移动');
        const url = await host.localAudioUrl(track.path);
        if (!url) throw new ResolveError('无法读取本地文件');
        return { url, local: true };
    }
    if (!useSources.getState().records.some(r => r.enabled)) throw new ResolveError('没有启用的音源，请在“设置 → 音源”中导入或启用洛雪自定义源');
    const errors: string[] = [];
    const allowSwitch = (options.allowSwitch ?? useSettings.getState().autoSwitchSource) && !options.onlySource;
    // 原平台迟迟拿不到链接时，提前在后台搜索其他平台的同名歌曲，失败后可立即切换
    let altPromise: Promise<Track[]> | null = null;
    const startAlt = () => (altPromise ??= findAlternatives(track).catch(() => [] as Track[]));
    const altTimer = allowSwitch ? setTimeout(startAlt, 4000) : undefined;
    let direct: Resolved | null;
    try {
        direct = await resolveOnPlatform(track, options, errors);
    } finally {
        clearTimeout(altTimer);
    }
    if (direct && !direct.weak) return direct;
    if (allowSwitch && !direct) {
        options.onStatus?.('当前平台不可用，正在其他平台匹配同一首歌…');
        const alternatives = (await startAlt()).slice(0, 3);
        log('alternatives', alternatives.map(t => `${t.name}@${t.source}`));
        if (alternatives.length) {
            options.onStatus?.(`正在尝试${alternatives.map(t => PLATFORM_NAMES[t.source as Platform]).join(' / ')}的同名歌曲…`);
            const result = await raceAlternatives(alternatives, options, errors);
            if (result) return result;
        } else errors.push('其他平台没有找到匹配的歌曲');
    }
    if (direct) return direct;
    const unique = [...new Set(errors)];
    throw new ResolveError(summarize(unique), unique);
}

/** 把一堆失败原因归纳成一句用户看得懂的话 */
function summarize(errors: string[]): string {
    if (!errors.length) return '所有音源均不可用';
    const count = (re: RegExp) => errors.filter(e => re.test(e)).length;
    const dead = count(/域名无法解析|无法连接|服务可能已停止|证书/);
    const invalid = count(/HTTP 4\d\d|不是音频|刚刚播放失败/);
    const slow = count(/超时/);
    if (invalid && invalid + dead + slow === errors.length) return '音源给出的链接都无法播放（可能是版权或地区限制），可稍后重试或更换音源';
    if (dead + slow === errors.length) return '音源服务器无法连接或响应超时，请检查网络，或在“设置 → 音源”更换音源';
    if (errors.length === 1) return `无法获取播放链接：${errors[0]}`;
    return `无法获取播放链接：${errors[0]} 等 ${errors.length} 项`;
}

/** 远程链接需经本地代理（附带 Referer/UA，允许 WebAudio 读取） */
export async function playableUrl(resolved: Resolved): Promise<string> {
    if (resolved.local) return resolved.url;
    const proxied = await host.proxyAudioUrl({ url: resolved.url }).catch(() => null);
    return proxied || resolved.url;
}
