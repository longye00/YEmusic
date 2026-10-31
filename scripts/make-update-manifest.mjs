// 生成应用内更新用的发布清单 update.json（放在仓库根目录，随源码进 GitHub；发版时也上传到 Release）。
//
// 用法：
//   node scripts/make-update-manifest.mjs                       # 读 package.json 的 version
//   node scripts/make-update-manifest.mjs --version 0.5.4 --notes "修复了…"
//
// 应用启动后会拉取：
//   https://github.com/<owner>/<repo>/releases/latest/download/update.json     （优先）
//   https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/update.json                （GitHub 连不上时的兜底）
// 清单里写的是同一 Release 中的安装包文件名，所以发版时把 update.json 和 APK / exe 一起传到该 Release 即可。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const argOf = name => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};

const version = argOf('version') || pkg.version;
if (!/^\d+\.\d+\.\d+/.test(version)) {
    console.error(`版本号不合法：${version}`);
    process.exit(1);
}
const notes = argOf('notes') ?? '';

// 与 scripts/build-android.mjs、packaging/build-win.mjs 的产物名保持一致
const manifest = {
    version,
    notes,
    android: `YEmusic-${version}-android.apk`,
    windows: `YEmusic-setup-${version}.exe`,
    publishedAt: new Date().toISOString(),
};

const target = path.join(root, 'update.json');
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`已写入 ${target}`);
console.log(JSON.stringify(manifest, null, 2));
console.log('\n下一步：把 update.json 与两个安装包一起上传到 GitHub Release（tag 建议用 latest）。');
