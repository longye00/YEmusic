// 组装 Windows 程序目录并生成 NSIS 安装包。
//
// 用法：
//   npm run build
//   node packaging/build-win.mjs --runtime <Electron Windows x64 运行时目录> [--makensis <makensis 路径>] [--out <输出目录>] [--tools <目录>]
//
// --runtime 指向解压后的 electron-v44.x-win32-x64（含 electron.exe 或已改名的 YEmusic.exe）。
// 依赖：@electron/asar、resedit、pe-library（npm i -D 安装到本项目，或用 --tools 指向含有它们的 node_modules 的目录），
// 以及 NSIS 3（makensis）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const PRODUCT = pkg.productName || 'YEmusic';
const EXE = `${PRODUCT}.exe`;

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
}, []));
const runtimeDir = path.resolve(args.runtime || process.env.YE_WIN_RUNTIME || '');
const outDir = path.resolve(args.out || path.join(root, 'release'));
const stageDir = path.join(root, 'packaging', '.stage');
const makensis = args.makensis || process.env.MAKENSIS || 'makensis';
const toolsDir = args.tools || process.env.YE_TOOLS_DIR;
const load = (id) => {
    try { return require(id); } catch (error) {
        if (!toolsDir) fail(`缺少依赖 ${id}：请执行 npm i -D @electron/asar resedit pe-library，或用 --tools 指定目录`);
        return createRequire(path.join(path.resolve(toolsDir), 'index.js'))(id);
    }
};

const step = (msg) => console.log(`\n▶ ${msg}`);
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

if (!args.runtime && !process.env.YE_WIN_RUNTIME) fail('缺少 --runtime <Electron Windows 运行时目录>');
const runtimeExe = ['electron.exe', EXE].map(n => path.join(runtimeDir, n)).find(p => fs.existsSync(p));
if (!runtimeExe) fail(`在 ${runtimeDir} 中找不到 electron.exe / ${EXE}`);
for (const p of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
    if (!fs.existsSync(path.join(root, p))) fail(`缺少 ${p}，请先运行 npm run build`);
}

// 1. 组装 app（打进 app.asar 的内容）
step('组装应用文件');
const appStage = path.join(stageDir, 'app');
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(appStage, { recursive: true });
const appPkg = {
    name: pkg.name, productName: PRODUCT, version: VERSION, private: true,
    author: pkg.author, description: pkg.description, license: pkg.license,
    main: 'dist-electron/main.cjs',
};
fs.writeFileSync(path.join(appStage, 'package.json'), JSON.stringify(appPkg, null, 2));
for (const dir of ['dist', 'dist-electron', 'shared']) fs.cpSync(path.join(root, dir), path.join(appStage, dir), { recursive: true });
fs.mkdirSync(path.join(appStage, 'build'));
for (const f of ['icon.png', 'icon.ico']) fs.copyFileSync(path.join(root, 'build', f), path.join(appStage, 'build', f));
for (const f of ['LICENSE', 'LICENSE-AGPL-3.0.txt', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(root, f), path.join(appStage, f));

// 2. 复制运行时（不带默认应用 / 旧 app.asar）
step('复制 Electron 运行时');
const winStage = path.join(stageDir, 'win');
const skip = new Set(['resources/app.asar', 'resources/default_app.asar', 'resources/app', 'resources/app.asar.unpacked', 'resources/elevate.exe', 'version']);
fs.cpSync(runtimeDir, winStage, {
    recursive: true,
    filter: (src) => {
        const rel = path.relative(runtimeDir, src).split(path.sep).join('/');
        return !skip.has(rel) && !/^Uninstall .*\.exe$/i.test(rel);
    },
});
if (path.basename(runtimeExe) !== EXE) fs.renameSync(path.join(winStage, path.basename(runtimeExe)), path.join(winStage, EXE));
// Electron 自带的 LICENSE（MIT）改名为 LICENSE.electron.txt，避免与本项目的 LICENSE.txt 混淆，卸载程序也按此文件名清理
if (fs.existsSync(path.join(winStage, 'LICENSE')) && !fs.existsSync(path.join(winStage, 'LICENSE.electron.txt'))) fs.renameSync(path.join(winStage, 'LICENSE'), path.join(winStage, 'LICENSE.electron.txt'));

// 3. app.asar
step('生成 resources/app.asar');
const asar = load('@electron/asar');
await asar.createPackage(appStage, path.join(winStage, 'resources', 'app.asar'));

// 4. exe：图标、版本信息、安全熔断
step(`写入 ${EXE} 图标与版本信息`);
const ResEdit = load('resedit');
const PE = load('pe-library');
const exePath = path.join(winStage, EXE);
const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'build', 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const group = groups[0] || { id: 1, lang: 1033 };
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, iconFile.icons.map(i => i.data));
const [major, minor, patch] = VERSION.split('.').map(n => parseInt(n, 10) || 0);
const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const vi = vis[0] || ResEdit.Resource.VersionInfo.createEmpty();
const langs = vi.getAllLanguagesForStringValues();
if (!langs.length) langs.push({ lang: 1033, codepage: 1200 });
for (const l of langs) {
    vi.setFileVersion(major, minor, patch, 0, l.lang);
    vi.setProductVersion(major, minor, patch, 0, l.lang);
    vi.setStringValues(l, {
        CompanyName: pkg.author || `${PRODUCT} contributors`,
        FileDescription: PRODUCT,
        FileVersion: VERSION,
        InternalName: PRODUCT,
        OriginalFilename: EXE,
        ProductName: PRODUCT,
        ProductVersion: VERSION,
        LegalCopyright: `Copyright © ${new Date().getFullYear()} ${pkg.author || PRODUCT}`,
    });
}
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
const exeBuf = Buffer.from(exe.generate());

// Electron fuses：关闭 RunAsNode / NODE_OPTIONS / --inspect，防止被当作通用 Node 运行时滥用
const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const at = exeBuf.indexOf(SENTINEL);
if (at < 0) fail('找不到 Electron fuse 标记');
const wire = at + SENTINEL.length;
if (exeBuf[wire] !== 1) fail(`不支持的 fuse 版本 ${exeBuf[wire]}`);
const fuseCount = exeBuf[wire + 1];
const FUSES = { RunAsNode: 0, EnableNodeOptionsEnvironmentVariable: 2, EnableNodeCliInspectArguments: 3 };
for (const [name, index] of Object.entries(FUSES)) {
    if (index >= fuseCount) continue;
    const pos = wire + 2 + index;
    if (exeBuf[pos] === 0x31) exeBuf[pos] = 0x30;
    console.log(`  fuse ${name} = ${String.fromCharCode(exeBuf[pos])}`);
}
fs.writeFileSync(exePath, exeBuf);

for (const [from, to] of [['LICENSE', 'LICENSE.txt'], ['LICENSE-AGPL-3.0.txt', 'LICENSE-AGPL-3.0.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']]) {
    fs.copyFileSync(path.join(root, from), path.join(winStage, to));
}

if (args['skip-installer']) { console.log(`\n✔ 程序目录：${winStage}`); process.exit(0); }

// 5. NSIS
step('生成安装包（LZMA 压缩，需要几分钟）');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${PRODUCT}-setup-${VERSION}.exe`);
const nsis = spawnSync(makensis, [
    '-V2', '-INPUTCHARSET', 'UTF8',
    `-DAPP_DIR=${winStage}`,
    `-DOUT_FILE=${outFile}`,
    `-DVERSION=${VERSION}`,
    `-DICON=${path.join(root, 'build', 'icon.ico')}`,
    `-DWIZARD_BMP=${path.join(root, 'packaging', 'wizard.bmp')}`,
    path.join(root, 'packaging', 'installer.nsi'),
], { stdio: 'inherit' });
if (nsis.error) fail(`无法运行 makensis：${nsis.error.message}`);
if (nsis.status !== 0) fail(`makensis 退出码 ${nsis.status}`);
console.log(`\n✔ ${outFile}（${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB）`);
