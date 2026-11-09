// 一次性跑全部离线 mock 测试（PowerShell 会吃掉 JSON 引号，故用本文件传别名）
import { spawnSync } from 'node:child_process';

const SRC = { '@/sdk/official': 'tests/stubs/official.ts', '@/store/sources': 'tests/stubs/sources.ts' };
const CASES = [
    ['tests/login-mock.ts', {}],
    ['tests/login-phone-mock.ts', {}],
    ['tests/updater-mock.ts', {}],
    ['tests/net-keepalive-mock.ts', {}],
    ['tests/account-playlists-mock.ts', {}],
    ['tests/official-url-mock.ts', {}],
    ['tests/resolver-order-mock.ts', SRC],
    ['tests/trial-clip-mock.ts', SRC],
    ['tests/trial-player-mock.ts', { ...SRC, '@/player/engine': 'tests/stubs/engine.ts', '@/player/lyrics': 'tests/stubs/lyrics.ts' }],
];
let bad = 0;
for (const [entry, alias] of CASES) {
    const args = ['tests/run-test.mjs', entry];
    if (Object.keys(alias).length) args.push(JSON.stringify(alias));
    const r = spawnSync(process.execPath, args, { stdio: 'pipe', encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const tail = out.trim().split('\n').filter(Boolean).slice(-4).join('\n   ');
    console.log(`===== ${entry}  exit=${r.status} =====\n   ${tail}`);
    if (r.status !== 0) bad++;
}
console.log(bad ? `\n${bad} 个测试文件失败` : '\n全部测试文件通过');
process.exit(bad ? 1 : 0);
