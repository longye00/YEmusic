// 打包 Electron 主进程（含 music-metadata 等依赖），产物位于 dist-electron/
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist-electron', { recursive: true, force: true });
mkdirSync('dist-electron', { recursive: true });
await build({
    entryPoints: ['electron/main.cjs'],
    outfile: 'dist-electron/main.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    minify: true,
    keepNames: true,
    legalComments: 'eof',
    logLevel: 'info',
});
copyFileSync('electron/preload.cjs', 'dist-electron/preload.cjs');
console.log('electron main bundled');
