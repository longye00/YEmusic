/** 平台接口请求封装（经主进程转发，绕过 CORS）。 */
import { host, type HostResponse } from './host';
import { utf8Decode } from './bytes';

export interface RequestOptions {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    /** 以 application/x-www-form-urlencoded 发送 */
    form?: Record<string, string | number | boolean>;
    /** 以 JSON 发送 */
    json?: unknown;
    body?: string;
    timeout?: number;
    retries?: number;
}

export class HttpError extends Error {
    constructor(message: string, public status = 0) {
        super(message);
    }
}

export function encodeForm(data: Record<string, unknown>) {
    return Object.entries(data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
}

export async function requestRaw(url: string, options: RequestOptions = {}): Promise<HostResponse> {
    const headers: Record<string, string> = { ...(options.headers || {}) };
    let body: string | undefined = options.body;
    let method = options.method || 'GET';
    if (options.form) {
        body = encodeForm(options.form);
        headers['content-type'] ??= 'application/x-www-form-urlencoded';
        method = options.method || 'POST';
    } else if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers['content-type'] ??= 'application/json';
        method = options.method || 'POST';
    }
    let attempt = 0;
    const retries = options.retries ?? 1;
    for (;;) {
        const res = await host.fetch({ url, method, headers, body, timeoutMs: options.timeout ?? 15000 });
        if (res.ok || attempt >= retries || (res.status >= 400 && res.status < 500)) {
            if (!res.ok && !res.status) throw new HttpError(res.error || '网络请求失败', 0);
            return res;
        }
        attempt++;
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
}

export async function requestText(url: string, options?: RequestOptions): Promise<string> {
    const res = await requestRaw(url, options);
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    return res.bytes ? utf8Decode(res.bytes) : '';
}

export async function requestJson<T = any>(url: string, options?: RequestOptions): Promise<T> {
    const text = await requestText(url, options);
    try {
        return JSON.parse(text) as T;
    } catch {
        // 有些接口返回 JSONP 或前面带空行
        const match = /^[^({[]*?\(?\s*([{[][\s\S]*[}\]])\s*\)?;?\s*$/.exec(text.trim());
        if (match) return JSON.parse(match[1]) as T;
        throw new HttpError('响应不是有效的 JSON');
    }
}
