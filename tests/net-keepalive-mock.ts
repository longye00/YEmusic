// 主进程 HTTP 连接复用测试：探测（range）+ 拉流（完整 body）是每首歌必经的两步，
// 两者必须复用同一条 TCP 连接，否则每次切歌都白白重付一遍 DNS + TCP + TLS 握手。
// 起一个本机 HTTP 服务器数连接数，不依赖外网。
// 运行：node tests/run-test.mjs tests/net-keepalive-mock.ts
import http from 'node:http';

// run-test.mjs 把测试打包成仓库根目录的 .tmp-test.mjs，import.meta.url 因此指向仓库根，
// 这里按根目录的相对路径在运行时加载主进程模块（路径不是字面量，esbuild 不会去打包它）。
const netUrl = new URL('./electron/net.cjs', import.meta.url);
const { request } = await import(netUrl.href) as {
    request(req: { url: string; range?: number; timeoutMs?: number; validate?: (u: URL) => string | null }): Promise<{
        ok: boolean; status: number; error?: string; bytes: Buffer;
    }>;
};

interface Seen { url: string; range: string | null; method: string }
const payloads: Seen[] = [];
let connections = 0;

const server = http.createServer((req, res) => {
    payloads.push({ url: String(req.url), range: (req.headers.range as string) || null, method: String(req.method) });
    const range = /^bytes=0-(\d+)$/.exec(String(req.headers.range || ''));
    // 真实 CDN 的行为：认 Range 就回 206 和请求的字节数，不认就当普通 GET 回 200
    if (range) {
        const len = Number(range[1]) + 1;
        res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-length': String(len), 'content-range': `bytes 0-${len - 1}/64` });
        res.end(Buffer.alloc(len));
        return;
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': '64' });
    res.end(Buffer.alloc(64));
});
server.on('connection', () => connections++);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
};
// 测试服务器在 127.0.0.1，validate 直接放行（真实调用方会传 isPublicHost 校验）
const get = (url: string, range?: number) => request({ url, range, timeoutMs: 5000, validate: () => null });

// 1. 一首歌的两步：探测 → 拉流，必须落在同一条连接上
const probe = await get(`${base}/probe.mp3`, 2);
check('探测请求拿到 2 字节', probe.ok === true && probe.status === 206 && probe.bytes.length === 2, `status=${probe.status} bytes=${probe.bytes.length}`);
const body = await get(`${base}/probe.mp3`);
check('拉流请求拿到完整 body', body.ok === true && body.status === 200 && body.bytes.length === 64, `status=${body.status} bytes=${body.bytes.length}`);
check('探测 + 拉流复用同一条连接', connections === 1, `connections=${connections}`);
check('探测带上了 Range 头', payloads[0].range === 'bytes=0-1', String(payloads[0].range));
check('拉流不带 Range 头', payloads[1].range === null, String(payloads[1].range));

// 2. 连着十次请求仍然只用一条连接
for (let i = 0; i < 8; i++) await get(`${base}/t${i}.mp3`);
check('十次串行请求仍是一条连接', connections === 1, `connections=${connections}`);

// 3. 并发请求可以开多条，但都要成功且不超出 socket 上限
const many = await Promise.all(Array.from({ length: 6 }, (_, i) => get(`${base}/p${i}.mp3`)));
check('六个并发请求都成功', many.every(r => r.ok), `ok=${many.filter(r => r.ok).length}/6`);
check('并发没突破 socket 上限', connections <= 7, `connections=${connections}`);

// 4. 服务器无视 Range（回 200 灌整个文件）时探测要立刻掐断，不能白下整首歌
let stubbornWrote = 0;
let clientHungUp = false;
const CHUNK = 64 * 1024;
const TOTAL = 4 * 1024 * 1024;
const stubborn = http.createServer((req, res) => {
    // 客户端 destroy() 之后内核缓冲区里还会残留一些已写出的数据，
    // 这里关心的是「客户端真的挂断了」，不是服务器一共写出去多少字节
    res.on('close', () => { clientHungUp = true; });
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(TOTAL) });
    let sent = 0;
    const pump = () => {
        if (sent >= TOTAL || clientHungUp) { res.end(); return; }
        stubbornWrote = sent + CHUNK;
        res.write(Buffer.alloc(CHUNK), () => { sent += CHUNK; setTimeout(pump, 5); });
    };
    pump();
});
await new Promise<void>(resolve => stubborn.listen(0, '127.0.0.1', () => resolve()));
const sBase = `http://127.0.0.1:${(stubborn.address() as { port: number }).port}`;
const stubbornProbe = await request({ url: `${sBase}/x.mp3`, range: 2, timeoutMs: 5000, validate: () => null });
check('服务器不认 Range 时探测照样成功', stubbornProbe.ok === true && stubbornProbe.status === 200, `status=${stubbornProbe.status}`);
check('不认 Range 时只回请求的字节数', stubbornProbe.bytes.length === 2, `bytes=${stubbornProbe.bytes.length}`);
await new Promise(r => setTimeout(r, 300));
check('探测完成后客户端立刻挂断连接', clientHungUp === true);
check('挂断后服务器停止灌数据（远小于整个文件）', stubbornWrote < TOTAL / 4, `serverWrote=${stubbornWrote} of ${TOTAL}`);
stubborn.closeAllConnections?.();
stubborn.close();

server.closeAllConnections?.();
server.close();
console.log(failed ? `\n${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
