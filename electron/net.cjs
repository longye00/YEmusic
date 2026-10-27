/**
 * 主进程 HTTP 工具：手动跟随重定向（每一跳重新校验）、自动解压 gzip/deflate/br、限制响应体大小。
 * 所有渲染进程发起的跨域请求都经过这里，错误一律以 {ok:false,error} 的形式返回而不是抛出。
 */
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const dns = require('node:dns');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function isPrivateIp(ip) {
    const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (s.includes(':')) {
        if (s === '::' || s === '::1') return true;
        if (/^fe[89ab]/.test(s)) return true; // fe80::/10 链路本地
        if (/^f[cd]/.test(s)) return true; // fc00::/7 唯一本地
        const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
        if (mapped) return isPrivateIp(mapped[1]);
        return false;
    }
    const parts = s.split('.');
    if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p))) return true; // 解析不了的一律按私有处理
    const [a, b] = parts.map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // 多播与保留段
    return false;
}

function isPublicHost(hostname) {
    const lower = String(hostname || '').toLowerCase();
    if (!lower || lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) return !isPrivateIp(lower);
    if (lower.startsWith('[')) return false;
    if (/^[0-9a-f:]+$/.test(lower)) return false; // 裸 IPv6（http 客户端里不会以这种形式出现，防御性拒绝）
    return lower.includes('.') && lower.length <= 253;
}

/**
 * DNS 解析钩子：连接前校验解析结果，全部为公网地址才放行。
 * 防止“域名解析到内网 IP”绕过 hostname 层面的 isPublicHost 检查（DNS rebinding）。
 * 供 http/https 的 request options.lookup 使用（net.cjs、audioProxy、下载流共用）。
 * 注意 lookup 的回调签名随 options.all 变化，需要原样传递。
 */
function publicLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, options, (error, ...rest) => {
        if (error) { callback(error); return; }
        const list = options && options.all ? rest[0] : [{ address: rest[0], family: rest[1] }];
        for (const entry of list || []) {
            if (isPrivateIp(entry.address)) {
                const err = new Error(`host resolves to non-public address: ${entry.address}`);
                err.code = 'ENOTFOUND';
                callback(err);
                return;
            }
        }
        callback(null, ...rest);
    });
}

function hostMatches(hostname, list) {
    const lower = String(hostname || '').toLowerCase();
    return list.some(entry => lower === entry || lower.endsWith(`.${entry}`));
}

function decodeBody(buffer, encoding) {
    const enc = String(encoding || '').toLowerCase();
    try {
        if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
        if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
        if (enc.includes('deflate')) {
            try { return zlib.inflateSync(buffer); } catch { return zlib.inflateRawSync(buffer); }
        }
    } catch {
        // 声明了压缩但实际没有压缩的响应并不少见，按原样返回
    }
    return buffer;
}

function flattenHeaders(raw) {
    const out = {};
    for (const [key, value] of Object.entries(raw || {})) {
        if (typeof value === 'string') out[key] = value;
        else if (Array.isArray(value)) out[key] = value.join(', ');
        else if (value != null) out[key] = String(value);
    }
    return out;
}

/**
 * @param {object} req
 * @param {string} req.url
 * @param {string} [req.method]
 * @param {Record<string,string>} [req.headers]
 * @param {string|Uint8Array} [req.body]
 * @param {number} [req.timeoutMs]
 * @param {number} [req.maxBytes]
 * @param {boolean} [req.followRedirects]
 * @param {(url: URL) => string|null} [req.validate] 返回错误信息表示拒绝
 * @param {number} [req.range] 只取前 N 个字节（探测用）
 */
function request(req, redirects = 0) {
    return new Promise(resolve => {
        let target;
        try {
            target = new URL(String(req.url || ''));
        } catch {
            resolve({ ok: false, status: 0, error: 'invalid url' });
            return;
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            resolve({ ok: false, status: 0, error: `blocked protocol: ${target.protocol}` });
            return;
        }
        const rejection = req.validate ? req.validate(target) : null;
        if (rejection) {
            resolve({ ok: false, status: 0, error: rejection });
            return;
        }
        const method = String(req.method || 'GET').toUpperCase();
        const timeoutMs = Math.min(Math.max(Number(req.timeoutMs) || 20000, 1000), 90000);
        const maxBytes = Number(req.maxBytes) > 0 ? Number(req.maxBytes) : 32 * 1024 * 1024;
        const headers = {};
        for (const [k, v] of Object.entries(req.headers || {})) {
            if (v == null) continue;
            const key = k.toLowerCase();
            if (key === 'host' || key === 'content-length' || key === 'connection') continue;
            headers[key] = String(v);
        }
        if (!headers['user-agent']) headers['user-agent'] = DEFAULT_UA;
        if (!headers.accept) headers.accept = '*/*';
        if (req.range) headers.range = `bytes=0-${req.range - 1}`;
        let body = null;
        if (req.body != null && method !== 'GET' && method !== 'HEAD') {
            body = typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : Buffer.from(req.body);
            headers['content-length'] = String(body.length);
        }

        const client = target.protocol === 'https:' ? https : http;
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        const r = client.request(target, { method, headers, timeout: timeoutMs, lookup: publicLookup }, res => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location && req.followRedirects !== false) {
                res.resume();
                if (redirects >= 8) {
                    finish({ ok: false, status, error: 'too many redirects' });
                    return;
                }
                let next;
                try {
                    next = new URL(res.headers.location, target.toString());
                } catch {
                    finish({ ok: false, status, error: 'bad redirect location' });
                    return;
                }
                const nextMethod = status === 307 || status === 308 ? method : 'GET';
                request({ ...req, url: next.toString(), method: nextMethod, body: nextMethod === 'GET' ? undefined : req.body }, redirects + 1).then(finish);
                return;
            }
            const chunks = [];
            let received = 0;
            res.on('data', chunk => {
                received += chunk.length;
                if (received > maxBytes) {
                    r.destroy(new Error('response exceeds size limit'));
                    return;
                }
                chunks.push(chunk);
                if (req.range && received >= req.range) {
                    done();
                    r.destroy();
                }
            });
            const done = () => {
                const raw = Buffer.concat(chunks);
                finish({
                    ok: status >= 200 && status < 300,
                    status,
                    statusMessage: res.statusMessage || '',
                    url: target.toString(),
                    headers: flattenHeaders(res.headers),
                    bytes: req.range ? raw : decodeBody(raw, res.headers['content-encoding']),
                });
            };
            res.on('end', done);
            res.on('close', () => { if (req.range) done(); });
            res.on('error', error => finish({ ok: false, status, error: error.message }));
        });
        r.on('timeout', () => r.destroy(new Error('request timed out')));
        r.on('error', error => finish({ ok: false, status: 0, error: error.message }));
        if (body) r.write(body);
        r.end();
    });
}

module.exports = { request, isPublicHost, isPrivateIp, publicLookup, hostMatches, DEFAULT_UA };
