/**
 * 生成歌词样式缩略图（StyleShelf 用）：启动桌面版，打开歌词样式窗口，
 * 逐个选中 10 种样式，用 CDP 把预览框裁成 webp 存进 ../thumbs/。
 *
 * 用法（仓库根目录，Windows）：
 *   node src/ui/lyricStyle/scripts/capture-lyric-thumbs.mjs           # 连已开的实例（--remote-debugging-port=9340）
 *   node src/ui/lyricStyle/scripts/capture-lyric-thumbs.mjs --launch  # 自己起一个 Electron 实例，抓完退出
 *
 * 依赖 playwright-core（未打进项目依赖）：用 YE_PW 指到它的 index.mjs，
 * 默认找 <仓库>/../../.scratch/pw/node_modules/playwright-core/index.mjs（本机 QA 工具目录）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THUMBS = path.resolve(HERE, '../thumbs');
const REPO = path.resolve(HERE, '../../../..');
const PORT = Number(process.env.YE_CDP_PORT || 9340);
const EXE = process.env.YE_ELECTRON || 'H:\\Claude\\YEmusic\\.runtime\\electron-v44.7.0-win32-x64\\electron.exe';
const PROFILE = process.env.YE_PROFILE || path.resolve(REPO, '../../.scratch/profiles/thumbs');
const PW = process.env.YE_PW || path.resolve(REPO, '../../.scratch/pw/node_modules/playwright-core/index.mjs');
const LAUNCH = process.argv.includes('--launch');
const SETTLE_MS = Number(process.env.YE_THUMB_SETTLE || 1700);

// 与 StyleShelf 的顺序一致：缩略图文件名 = 样式 id
const STYLES = [
    ['luminous', '光晕 · Luminous'],
    ['flow', '滚动 · Flow'],
    ['monet', '莫奈 · Monet'],
    ['claddagh', '回环 · Claddagh'],
    ['diorama', '镜台 · Diorama'],
    ['pendolo', '时计 · Pendolo'],
    ['sonnet', '商籁 · Sonnet'],
    ['tempera', '凝彩 · Tempera'],
    ['still', '静止 · Still'],
    ['lumiere', '绘光 · Lumière'],
];

const { chromium } = await import(pathToFileURL(PW).href);

const get = url => new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }).on('error', reject);
});

async function waitForCDP(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            const r = await get(`http://127.0.0.1:${PORT}/json/version`);
            if (r.status === 200) return;
        } catch { /* 重试 */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`CDP(127.0.0.1:${PORT}) 未就绪`);
}

async function connect() {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
    let context = browser.contexts()[0];
    for (let i = 0; i < 20 && !context; i++) { await new Promise(r => setTimeout(r, 250)); context = browser.contexts()[0]; }
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 40 && !page; i++) { await new Promise(r => setTimeout(r, 250)); page = context.pages().find(p => !p.url().startsWith('devtools://')); }
    page.setDefaultTimeout(20000);
    return { browser, context, page };
}

/** DOM 直点：胶囊悬停才显示的按钮带 pointer-events:none，playwright 的可见性检查会挡住 */
const domClick = (page, sel) => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`找不到 ${s}`);
    el.click();
}, sel);

async function main() {
    fs.mkdirSync(THUMBS, { recursive: true });
    let child;
    if (LAUNCH) {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, REPO], { detached: true, stdio: 'ignore', env });
        child.unref();
        console.log('[thumbs] electron pid', child.pid);
    }
    await waitForCDP();
    const { context, page } = await connect();
    const cdp = await context.newCDPSession(page);

    try {
        await page.waitForSelector('body', { state: 'attached' });
        await page.waitForTimeout(3500); // 等启动遮罩与首页渲染稳定

        // 入口与真实用户一致：设置（Ctrl+,）→ 歌词 →「打开歌词样式窗口」
        await page.keyboard.press('Control+,');
        await page.waitForTimeout(900);
        await page.evaluate(() => {
            const nav = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '歌词');
            if (!nav) throw new Error('找不到设置导航「歌词」');
            nav.click();
        });
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('打开歌词样式窗口'));
            if (!btn) throw new Error('找不到「打开歌词样式窗口」');
            btn.click();
        });
        await page.waitForSelector('[data-lyst-preview]', { state: 'visible', timeout: 15000 });
        await page.waitForTimeout(1200);

        for (const [id, title] of STYLES) {
            await domClick(page, `button[title="${title}"]`);
            await page.waitForTimeout(SETTLE_MS); // 等动画分包加载 + 第一句歌词唱起来
            const box = await page.locator('[data-lyst-preview]').boundingBox();
            if (!box) { console.log(`[thumbs] ${id}: 预览框不可见，跳过`); continue; }
            const { data } = await cdp.send('Page.captureScreenshot', {
                format: 'webp',
                quality: 85,
                clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
            });
            const file = path.join(THUMBS, `${id}.webp`);
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
            console.log(`[thumbs] ${id} -> ${file} (${Math.round(fs.statSync(file).size / 1024)}k)`);
        }
    } finally {
        if (child) {
            try { await cdp.send('Browser.close'); } catch { /* 忽略 */ }
            await new Promise(r => setTimeout(r, 1200));
            try { process.kill(child.pid); } catch { /* 已退 */ }
        }
    }
    console.log('[thumbs] done');
}

main().catch(e => { console.error('[thumbs] FAILED:', e.message); process.exit(1); });
