// 用 esbuild 的 JS API 打包测试（避免 Git Bash 把 --alias:@/x=./y 里的 /x 当成路径转换）。
// 用法：node tests/run-test.mjs <入口文件> [别名JSON]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.argv[2];
if (!entry) {
    console.error('用法：node tests/run-test.mjs tests/xxx-mock.ts [别名JSON]');
    process.exit(2);
}
const alias = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const outfile = path.join(root, '.tmp-test.mjs');

// 内置音源脚本是 .js 文件用 ?raw 导入的，esbuild 不认这个后缀；
// 测试里它们都被桩替换掉了，这里用空文件顶掉，避免解析失败。
const emptyDir = path.join(root, '.tmp-stubs');
fs.mkdirSync(emptyDir, { recursive: true });
const emptyFile = path.join(emptyDir, 'empty.mjs');
fs.writeFileSync(emptyFile, 'export default "";\n');

const aliasEntries = Object.entries(alias).map(([key, value]) => ({ find: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: path.resolve(root, value) }));

await build({
    entryPoints: [path.resolve(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    alias: { '@': path.join(root, 'src') },
    plugins: [{
        name: 'test-aliases',
        setup(b) {
            b.onResolve({ filter: /\?raw$/ }, args => ({ path: emptyFile }));
            for (const { find, replacement } of aliasEntries) {
                b.onResolve({ filter: find }, () => ({ path: replacement }));
            }
        },
    }],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    logLevel: 'warning',
});

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
fs.rmSync(outfile, { force: true });
process.exit(result.status ?? 1);
