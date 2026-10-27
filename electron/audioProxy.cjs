/**
 * 本地音频代理（仅监听 127.0.0.1）。
 *
 * 1. 在线音频：为 CDN 流补上 CORS 头（WebAudio 均衡器/频谱需要），并附加 Referer/UA 等 CDN 要求的请求头；
 * 2. 本地文件：以支持 Range 的方式提供本地音频，拖动进度条不会重新读取整个文件。
 *
 * 渲染进程只拿到带随机令牌的地址，令牌之外的路径/地址一律拒绝，因此它不是任意转发器。
 */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isPublicHost, publicLookup, DEFAULT_UA } = require('./net.cjs');

let server = null;
let port = 0;
/** token -> { kind:'remote', url, headers } | { kind:'local', path } */
const tokens = new Map();

const MIME = {
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
    '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/ape', '.webm': 'audio/webm', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
};

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Accept-Ranges');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

function fail(res, status, message) {
    if (res.headersSent) { res.destroy(); return; }
    cors(res);
    res.statusCode = status;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(message);
}

function serveLocal(req, res, filePath) {
    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) { fail(res, 404, 'file not found'); return; }
        const total = stat.size;
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        cors(res);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', type);
        let start = 0;
        let end = total - 1;
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
        if (range) {
            if (range[1] === '' && range[2] !== '') {
                start = Math.max(0, total - Number(range[2]));
            } else {
                start = Number(range[1] || 0);
                if (range[2] !== '') end = Math.min(Number(range[2]), total - 1);
            }
            if (start > end || start >= total) {
                res.statusCode = 416;
                res.setHeader('Content-Range', `bytes */${total}`);
                res.end();
                return;
            }
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        } else {
            res.statusCode = 200;
        }
        res.setHeader('Content-Length', String(end - start + 1));
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    });
}

function serveRemote(req, res, target, extraHeaders, hops = 0) {
    let parsed;
    try { parsed = new URL(target); } catch { fail(res, 400, 'bad url'); return; }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isPublicHost(parsed.hostname)) {
        fail(res, 403, 'host not allowed');
        return;
    }
    const headers = { 'user-agent': DEFAULT_UA, accept: '*/*' };
    for (const [k, v] of Object.entries(extraHeaders || {})) {
        const key = k.toLowerCase();
        if (v == null) continue;
        if (key === 'host' || key === 'content-length' || key === 'connection') continue; // 不让渲染进程伪造路由相关头
        headers[key] = String(v);
    }
    if (req.headers.range) headers.range = req.headers.range;
    const client = parsed.protocol === 'https:' ? https : http;
    const upstream = client.request(parsed, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, timeout: 30000, lookup: publicLookup }, up => {
        const status = up.statusCode || 502;
        if (status >= 300 && status < 400 && up.headers.location) {
            up.resume();
            if (hops > 8) { fail(res, 508, 'too many redirects'); return; }
            let next;
            try { next = new URL(up.headers.location, parsed.toString()).toString(); } catch { fail(res, 502, 'bad redirect'); return; }
            serveRemote(req, res, next, extraHeaders, hops + 1);
            return;
        }
        cors(res);
        res.statusCode = status;
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
            const value = up.headers[key];
            if (value !== undefined) res.setHeader(key, value);
        }
        if (req.method === 'HEAD') { up.resume(); res.end(); return; }
        up.pipe(res);
        up.on('error', () => res.destroy());
        res.on('close', () => up.destroy());
    });
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timed out')));
    upstream.on('error', error => fail(res, 502, `upstream error: ${error.message}`));
    upstream.end();
}

function startAudioProxy() {
    if (server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
            let url;
            try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch { fail(res, 400, 'bad request'); return; }
            if (req.method === 'OPTIONS') {
                cors(res);
                res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
                res.statusCode = 204;
                res.end();
                return;
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') { fail(res, 405, 'method not allowed'); return; }
            if (url.pathname === '/health') { cors(res); res.end('ok'); return; }
            const entry = tokens.get(url.searchParams.get('t') || '');
            if (!entry) { fail(res, 404, 'unknown token'); return; }
            if (url.pathname === '/local' && entry.kind === 'local') { serveLocal(req, res, entry.path); return; }
            if (url.pathname === '/stream' && entry.kind === 'remote') { serveRemote(req, res, entry.url, entry.headers); return; }
            fail(res, 404, 'not found');
        });
        server.on('error', error => { server = null; reject(error); });
        server.listen(0, '127.0.0.1', () => {
            port = server.address().port;
            resolve(port);
        });
    });
}

function stopAudioProxy() {
    tokens.clear();
    if (server) {
        // close() 会等待进行中的长连接（音频流）结束，退出时直接掐断，避免挂住进程
        server.closeAllConnections?.();
        server.close();
    }
    server = null;
    port = 0;
}

function newToken() {
    // 密码学随机令牌：Math.random 可被预测，令牌是访问本地文件的唯一凭据
    const token = crypto.randomBytes(16).toString('base64url');
    if (tokens.size > 500) {
        for (const key of [...tokens.keys()].slice(0, tokens.size - 500)) tokens.delete(key);
    }
    return token;
}

function proxyRemoteUrl(target, headers) {
    if (!server || !/^https?:\/\//i.test(String(target || ''))) return null;
    const token = newToken();
    tokens.set(token, { kind: 'remote', url: String(target), headers: headers || {} });
    return `http://127.0.0.1:${port}/stream?t=${token}`;
}

function proxyLocalFile(filePath) {
    if (!server || !filePath) return null;
    const resolved = path.resolve(String(filePath));
    for (const [key, value] of tokens) {
        if (value.kind === 'local' && value.path === resolved) return `http://127.0.0.1:${port}/local?t=${key}`;
    }
    const token = newToken();
    tokens.set(token, { kind: 'local', path: resolved });
    return `http://127.0.0.1:${port}/local?t=${token}`;
}

module.exports = { startAudioProxy, stopAudioProxy, proxyRemoteUrl, proxyLocalFile };
