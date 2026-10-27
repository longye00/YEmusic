/**
 * 洛雪自定义源运行时（运行在独立 Web Worker 中，一个音源一个 Worker）。
 *
 * 与 lx-music-desktop 的 userApi preload 保持行为一致：
 *   - `globalThis.lx` 提供 EVENT_NAMES / request / send / on / utils / currentScriptInfo / version / env；
 *   - request 的语义对齐 needle：不跟随重定向、对象请求体按 content-type 序列化、响应体尝试 JSON 解析、raw 为 Buffer；
 *   - utils.crypto 提供 aesEncrypt / rsaEncrypt(无填充) / randomBytes / md5，utils.zlib 提供 inflate / deflate；
 *   - 脚本在真实的全局作用域中执行（间接 eval），且只执行一次。
 */
import { LxBuffer } from './lxBuffer';
import { aesEncrypt, parseAesAlgorithm } from '@/lib/aes';
import { rsaEncryptNoPadding } from '@/lib/rsa';
import { md5 } from '@/lib/md5';
import { deflate, inflate } from '@/lib/zlib';
import { encodeString, toBytes, utf8Decode } from '@/lib/bytes';

declare const self: DedicatedWorkerGlobalScope & Record<string, any>;

type HostResponse = { ok: boolean; status: number; statusMessage?: string; error?: string; headers?: Record<string, string>; bytes?: Uint8Array; url?: string };

const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' } as const;
const ALL_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg', 'local'];
const SUPPORT_QUALITYS: Record<string, string[]> = {
    kw: ['128k', '320k', 'flac', 'flac24bit'],
    kg: ['128k', '320k', 'flac', 'flac24bit'],
    tx: ['128k', '320k', 'flac', 'flac24bit'],
    wy: ['128k', '320k', 'flac', 'flac24bit'],
    mg: ['128k', '320k', 'flac', 'flac24bit'],
    local: [],
};
const SUPPORT_ACTIONS: Record<string, string[]> = {
    kw: ['musicUrl'], kg: ['musicUrl'], tx: ['musicUrl'], wy: ['musicUrl'], mg: ['musicUrl'], local: ['musicUrl', 'lyric', 'pic'],
};

let seq = 0;
const pendingFetch = new Map<number, (res: HostResponse) => void>();
let requestHandler: ((payload: unknown) => Promise<unknown>) | null = null;
let isInited = false;
let alertShown = false;
let blockedHosts: string[] = [];

const post = (message: Record<string, unknown>) => self.postMessage(message);

function hostFetch(req: Record<string, unknown>): Promise<HostResponse> {
    const id = ++seq;
    return new Promise(resolve => {
        pendingFetch.set(id, resolve);
        post({ type: 'fetch', id, req: { ...req, blockedHosts } });
    });
}

function reportInitError(message: string) {
    if (isInited) return;
    isInited = true;
    post({ type: 'init', ok: false, error: String(message || '初始化失败').slice(0, 1024) });
}

// ---------- 日志转发 ----------
const nativeConsole = { ...console };
function forward(level: string, args: unknown[]) {
    try {
        const text = args
            .map(arg => {
                if (typeof arg === 'string') return arg;
                if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                try { return JSON.stringify(arg); } catch { return String(arg); }
            })
            .join(' ');
        post({ type: 'log', level, text: text.slice(0, 2000) });
    } catch {
        // 日志失败不影响脚本
    }
}
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    (console as any)[level] = (...args: unknown[]) => {
        (nativeConsole as any)[level]?.(...args);
        forward(level, args);
    };
}
console.group = (...args: unknown[]) => forward('log', args);
console.groupCollapsed = (...args: unknown[]) => forward('log', args);
console.groupEnd = () => {};

// ---------- lx.request（needle 语义） ----------
function stringifyQuery(data: Record<string, unknown>) {
    return Object.entries(data)
        .flatMap(([k, v]) => (Array.isArray(v) ? v.map(item => [k, item]) : [[k, v]]))
        .map(([k, v]) => `${encodeURIComponent(String(k))}=${encodeURIComponent(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))}`)
        .join('&');
}

function request(url: string, options: any = {}, callback?: (err: Error | null, resp: unknown, body: unknown) => void) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const { method = 'get', timeout, headers = {}, body, form, formData } = options || {};
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) if (v != null) lowerHeaders[k.toLowerCase()] = String(v);
    let data = body ?? form ?? formData;
    const isJson = options.json === true || (options.json !== false && lowerHeaders['content-type'] === 'application/json' && !form && !formData);
    let finalUrl = String(url);
    let payload: string | Uint8Array | undefined;
    const upperMethod = String(method).toUpperCase();
    if (data != null && data !== '') {
        if (data instanceof Uint8Array || ArrayBuffer.isView(data)) payload = toBytes(data);
        else if (upperMethod === 'GET' && !isJson && typeof data === 'object') finalUrl = finalUrl.replace(/\?.*|$/, m => `?${m ? `${m.slice(1)}&` : ''}${stringifyQuery(data)}`);
        else if (typeof data === 'string') payload = data;
        else payload = isJson ? JSON.stringify(data) : stringifyQuery(data);
        if (payload != null && !lowerHeaders['content-type']) lowerHeaders['content-type'] = isJson ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded';
    }
    let aborted = false;
    const timeoutMs = typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000;
    hostFetch({ url: finalUrl, method: upperMethod, headers: lowerHeaders, body: payload, timeoutMs, followRedirects: false }).then(res => {
        if (aborted || !callback) return;
        try {
            if (!res.status && !res.ok) {
                callback.call(lx, new Error(res.error || 'request failed'), null, null);
                return;
            }
            const raw = LxBuffer.wrap(res.bytes ? new Uint8Array(res.bytes) : new Uint8Array(0));
            let parsed: unknown = utf8Decode(raw);
            try { parsed = JSON.parse(parsed as string); } catch { /* 非 JSON 时保留字符串 */ }
            callback.call(lx, null, {
                statusCode: res.status,
                statusMessage: res.statusMessage || '',
                headers: res.headers || {},
                bytes: raw.length,
                raw,
                body: parsed,
            }, parsed);
        } catch (error) {
            reportInitError((error as Error)?.message || String(error));
            post({ type: 'log', level: 'error', text: `回调异常：${(error as Error)?.message || error}` });
        }
    });
    return () => { aborted = true; };
}

// ---------- 事件 ----------
function send(eventName: string, data: any) {
    return new Promise<void>((resolve, reject) => {
        if (eventName === EVENT_NAMES.inited) {
            if (isInited) return reject(new Error('Script is inited'));
            isInited = true;
            const sources: Record<string, { type: string; actions: string[]; qualitys: string[] }> = {};
            try {
                for (const source of ALL_SOURCES) {
                    const info = data?.sources?.[source];
                    if (!info || info.type !== 'music') continue;
                    sources[source] = {
                        type: 'music',
                        actions: SUPPORT_ACTIONS[source].filter(a => (info.actions || []).includes(a)),
                        qualitys: SUPPORT_QUALITYS[source].filter(q => (info.qualitys || []).includes(q)),
                    };
                }
            } catch (error) {
                post({ type: 'init', ok: false, error: (error as Error).message });
                return reject(error);
            }
            post({ type: 'init', ok: true, sources, openDevTools: Boolean(data?.openDevTools) });
            return resolve();
        }
        if (eventName === EVENT_NAMES.updateAlert) {
            if (alertShown) return reject(new Error('The update alert can only be called once.'));
            alertShown = true;
            if (!data || typeof data !== 'object' || typeof data.log !== 'string' || !data.log) return reject(new Error('log is required.'));
            const updateUrl = typeof data.updateUrl === 'string' && /^https?:\/\//.test(data.updateUrl) && data.updateUrl.length <= 1024 ? data.updateUrl : undefined;
            post({ type: 'updateAlert', log: data.log.length > 1024 ? `${data.log.slice(0, 1024)}...` : data.log, updateUrl });
            return resolve();
        }
        reject(new Error(`The event is not supported: ${eventName}`));
    });
}

function on(eventName: string, handler: (payload: unknown) => Promise<unknown>) {
    if (eventName !== EVENT_NAMES.request) return Promise.reject(new Error(`The event is not supported: ${eventName}`));
    requestHandler = handler;
    return Promise.resolve();
}

const toKey = (key: unknown) => (typeof key === 'string' ? encodeString(key) : toBytes(key));

const utils = {
    crypto: {
        aesEncrypt(buffer: unknown, mode: string, key: unknown, iv: unknown) {
            const { bits, mode: m } = parseAesAlgorithm(mode);
            const out = aesEncrypt(toBytes(buffer), toKey(key), m, iv ? toKey(iv) : undefined, bits);
            return LxBuffer.wrap(out);
        },
        rsaEncrypt(buffer: unknown, key: string) {
            const input = toBytes(buffer);
            const padded = new Uint8Array(Math.max(128, input.length));
            padded.set(input, padded.length - input.length);
            return LxBuffer.wrap(rsaEncryptNoPadding(padded, key));
        },
        randomBytes(size: number) {
            const out = new LxBuffer(size);
            crypto.getRandomValues(out);
            return out;
        },
        md5(str: unknown) {
            return md5(typeof str === 'string' ? str : toBytes(str));
        },
    },
    buffer: {
        from: (...args: [unknown, any?, any?]) => LxBuffer.from(...args),
        bufToString: (buf: unknown, format: string) => LxBuffer.from(typeof buf === 'string' ? encodeString(buf, 'binary') : (buf as Uint8Array)).toString(format),
    },
    zlib: {
        inflate: async (buf: unknown) => LxBuffer.wrap(await inflate(toBytes(buf))),
        deflate: async (data: unknown) => LxBuffer.wrap(await deflate(typeof data === 'string' ? encodeString(data) : toBytes(data))),
    },
};

const lx: Record<string, any> = {
    EVENT_NAMES,
    request,
    send,
    on,
    utils,
    currentScriptInfo: {},
    version: '2.0.0',
    env: 'desktop',
};

// ---------- 兼容层：部分脚本直接使用 fetch / window / Buffer ----------
self.window = self;
self.Buffer = LxBuffer;
const nativeFetch = self.fetch?.bind(self);
self.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!/^https?:/i.test(url) && nativeFetch) return nativeFetch(input, init);
    const headers: Record<string, string> = {};
    new Headers(init.headers || (input instanceof Request ? input.headers : undefined)).forEach((v, k) => { headers[k] = v; });
    let body: string | Uint8Array | undefined;
    if (typeof init.body === 'string') body = init.body;
    else if (init.body instanceof URLSearchParams) { body = init.body.toString(); headers['content-type'] ??= 'application/x-www-form-urlencoded'; }
    else if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) body = toBytes(init.body);
    const res = await hostFetch({ url, method: (init.method || 'GET').toUpperCase(), headers, body, timeoutMs: 30000, followRedirects: init.redirect !== 'manual' });
    if (!res.status && !res.ok) throw new TypeError(res.error || 'Failed to fetch');
    return new Response(res.bytes ? new Uint8Array(res.bytes) : null, { status: res.status >= 200 && res.status <= 599 ? res.status : 200, headers: res.headers });
};

self.addEventListener('error', event => {
    reportInitError(String(event.message || '').replace(/^Uncaught\s(Error:\s)?/, ''));
});
self.addEventListener('unhandledrejection', event => {
    const reason = (event as PromiseRejectionEvent).reason;
    const message = typeof reason === 'string' ? reason : reason?.message ?? String(reason);
    post({ type: 'log', level: 'error', text: `未处理的异常：${message}` });
    reportInitError(String(message).replace(/^Error:\s/, ''));
});

function verifyLyric(info: any) {
    if (typeof info !== 'object' || typeof info?.lyric !== 'string') throw new Error('failed');
    if (info.lyric.length > 51200) throw new Error('failed');
    return {
        lyric: info.lyric,
        tlyric: typeof info.tlyric === 'string' && info.tlyric.length < 5120 ? info.tlyric : null,
        rlyric: typeof info.rlyric === 'string' && info.rlyric.length < 5120 ? info.rlyric : null,
        lxlyric: typeof info.lxlyric === 'string' && info.lxlyric.length < 8192 ? info.lxlyric : null,
    };
}

async function handleCall(id: number, source: string, action: string, info: unknown) {
    try {
        if (!requestHandler) throw new Error('Request event is not defined');
        const response: any = await requestHandler.call(lx, { source, action, info });
        let result: unknown;
        if (action === 'musicUrl' || action === 'pic') {
            if (typeof response !== 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed');
            result = response;
        } else if (action === 'lyric') {
            result = verifyLyric(response);
        } else {
            throw new Error(`unsupported action: ${action}`);
        }
        post({ type: 'result', id, ok: true, result });
    } catch (error) {
        post({ type: 'result', id, ok: false, error: (error as Error)?.message || String(error || 'failed') });
    }
}

self.onmessage = (event: MessageEvent) => {
    const message = event.data || {};
    switch (message.type) {
        case 'load': {
            blockedHosts = Array.isArray(message.blockedHosts) ? message.blockedHosts : [];
            lx.currentScriptInfo = { ...(message.info || {}), rawScript: message.script };
            self.lx = lx;
            try {
                (0, eval)(String(message.script));
            } catch (error) {
                reportInitError((error as Error)?.message || String(error));
            }
            break;
        }
        case 'fetchResult': {
            const resolve = pendingFetch.get(message.id);
            pendingFetch.delete(message.id);
            resolve?.(message.res);
            break;
        }
        case 'call':
            void handleCall(message.id, message.source, message.action, message.info);
            break;
        case 'blockedHosts':
            blockedHosts = Array.isArray(message.hosts) ? message.hosts : [];
            break;
    }
};
