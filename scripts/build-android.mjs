// 构建 Android 安装包（APK）：vite build → cap sync → gradlew assembleRelease → release/YEmusic-<版本>-android.apk
//
// 需要：JDK 21、Android SDK（platforms;android-36 与 build-tools 35+，用 ANDROID_HOME 或 android/local.properties 的 sdk.dir 指定）。
// 签名：存在 android/keystore.properties 时自动签名（见 README「Android 版」）；否则产出未签名的 APK，可自行用 apksigner 签名。
// 用法：node scripts/build-android.mjs [--skip-web]   （--skip-web：跳过前端打包与同步，只跑 gradle）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const win = process.platform === 'win32';

function run(command, args, cwd = root) {
    console.log(`\n> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: win });
    if (result.status !== 0) {
        console.error(`命令失败（退出码 ${result.status ?? 'null'}）：${command} ${args.join(' ')}`);
        process.exit(result.status || 1);
    }
}

if (!process.argv.includes('--skip-web')) {
    run('npx', ['tsc', '--noEmit', '-p', '.']);
    run('npx', ['vite', 'build']);
    run('npx', ['cap', 'sync', 'android']);
}

run(win ? 'gradlew.bat' : './gradlew', ['assembleRelease'], path.join(root, 'android'));

const outDir = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release');
const signed = path.join(outDir, 'app-release.apk');
const unsigned = path.join(outDir, 'app-release-unsigned.apk');
const built = fs.existsSync(signed) ? signed : unsigned;
if (!fs.existsSync(built)) {
    console.error(`没有找到构建产物：${outDir}`);
    process.exit(1);
}
const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });
const target = path.join(releaseDir, `YEmusic-${pkg.version}-android${built === signed ? '' : '-unsigned'}.apk`);
fs.copyFileSync(built, target);
console.log(`\n完成：${target}${built === signed ? '' : '\n（未签名：请先用 apksigner 签名后再安装，或创建 android/keystore.properties 后重新构建）'}`);
