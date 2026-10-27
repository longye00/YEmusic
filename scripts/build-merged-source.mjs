// 生成「YEmusic 聚合音源」：把 sources/merged/subs 下的洛雪自定义源原样打包进一个脚本，
// 每个子源在独立的 lx 环境中运行，由 sources/merged/runtime.js 统一竞速取链。
// 用法：node scripts/build-merged-source.mjs   → src/plugins/presets/yemusic-merged.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'sources/merged');
const VERSION = '1.0.0';

/** 子源清单：caps 为子源自己声明的平台与音质（加载前用于路由，加载后以子源实际声明为准） */
const SUBS = [
    { id: 'xinghai', tag: '星海', file: 'xinghai-v3.2.15.js', caps: { kw: ['128k', '320k', 'flac'], kg: ['128k', '320k', 'flac'], tx: ['128k', '320k', 'flac'], wy: ['128k', '320k', 'flac'], mg: ['128k', '320k', 'flac'] } },
    { id: 'molan', tag: '墨澜', file: 'molan-2.2.0.js', caps: { kw: ['128k', '320k', 'flac', 'flac24bit'], kg: ['128k', '320k', 'flac'], tx: ['128k', '320k', 'flac'], wy: ['128k', '320k', 'flac'], mg: ['128k', '320k', 'flac'] } },
    { id: 'changqing', tag: '长青', file: 'changqing-1.2.0.js', caps: { kw: ['128k', '320k', 'flac'], kg: ['128k', '320k', 'flac', 'flac24bit'], tx: ['128k', '320k', 'flac'], wy: ['128k', '320k', 'flac', 'flac24bit'] } },
    { id: 'kh', tag: 'K×H', file: 'kh-1.7.16.js', caps: { kw: ['128k', '320k', 'flac', 'flac24bit'], kg: ['128k', '320k', 'flac', 'flac24bit'], tx: ['128k', '320k', 'flac', 'flac24bit'], wy: ['128k', '320k', 'flac', 'flac24bit'], mg: ['128k', '320k', 'flac', 'flac24bit'] } },
];

/** 平台 → 子源顺序（2026-10 实测：成功率优先，其次速度；QQ 音乐优先使用能给出 QQ 原链的墨澜） */
const ORDER = {
    kw: ['kh', 'changqing', 'xinghai', 'molan'],
    kg: ['kh', 'molan', 'changqing', 'xinghai'],
    tx: ['molan', 'kh', 'changqing'],
    wy: ['xinghai', 'kh', 'changqing', 'molan'],
    mg: ['xinghai', 'molan', 'kh'],
};

/** 与 src/plugins/meta.ts（即洛雪桌面版 parseScriptInfo）一致，子源可能用它做自校验 */
const LIMITS = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 };
function parseMeta(script) {
    const head = /^\/\*[\S|\s]+?\*\//.exec(script)?.[0] ?? /^\/\*[\S|\s]+?\*\//.exec(script.replace(/^[\s\uFEFF]+/, ''))?.[0];
    if (!head) throw new Error('missing header');
    const infos = {};
    for (const line of head.split(/\r?\n/)) {
        const r = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line);
        if (!r || !(r[1] in LIMITS)) continue;
        infos[r[1]] = r[2].trim();
    }
    for (const [key, len] of Object.entries(LIMITS)) {
        infos[key] ||= '';
        if (infos[key].length > len) infos[key] = infos[key].substring(0, len) + '...';
    }
    return { name: infos.name, description: infos.description, version: infos.version, author: infos.author, homepage: infos.homepage };
}

const subs = SUBS.map(sub => {
    const code = fs.readFileSync(path.join(dir, 'subs', sub.file), 'utf8').replace(/^\uFEFF/, '');
    return { id: sub.id, tag: sub.tag, info: parseMeta(code), caps: sub.caps, code };
});

const list = subs.map(s => ` *   - ${s.info.name} ${s.info.version}（${s.info.author || '佚名'}）`).join('\n');
const header = `/*!
 * @name YEmusic 聚合音源
 * @description 星海·墨澜·长青·K×H 四源合一，按平台竞速自动回退
 * @version ${VERSION}
 * @author YEmusic 整合（子音源归原作者）
 */
/*
 * 本脚本把下列洛雪自定义源「原样」打包在一起（脚本内容未做任何修改），每个子源运行在各自隔离的 lx 环境中：
${list}
 * 取链策略：每个平台按实测成功率排序，错峰并发（首个可用的链接立即返回），连续失败的子源自动降权；
 * 播放器反馈“链接无法播放”时会带上失败链接重试，本脚本随即换用其他子源。
 * 子音源的接口、版权与可用性均归原作者所有，仅供学习交流，请支持正版音乐。
 * 生成方式：node scripts/build-merged-source.mjs（子源文件位于 sources/merged/subs）。
 */
`;

let runtime = fs.readFileSync(path.join(dir, 'runtime.js'), 'utf8');
runtime = runtime.replace('/*__ORDER__*/ {}', JSON.stringify(ORDER));
const subsLiteral = '[\n' + subs.map(s => `        { id: ${JSON.stringify(s.id)}, tag: ${JSON.stringify(s.tag)}, info: ${JSON.stringify(s.info)}, caps: ${JSON.stringify(s.caps)},\n          code: ${JSON.stringify(s.code)} }`).join(',\n') + '\n    ]';
if (!runtime.includes('/*__SUBS__*/ []')) throw new Error('runtime placeholder missing');
runtime = runtime.replace('/*__SUBS__*/ []', () => subsLiteral);
const out = header + runtime;
const target = path.join(root, 'src/plugins/presets/yemusic-merged.js');
fs.writeFileSync(target, out);
console.log(`wrote ${path.relative(root, target)} (${(out.length / 1024).toFixed(1)} KB)`);
for (const s of subs) console.log(`  ${s.tag}: ${s.info.name} ${s.info.version} desc="${s.info.description}"`);
