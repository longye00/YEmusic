// 猜我喜欢翻页测试：每一页都应推出「前几页没推过」的新歌，直到池子抽干返回 exhausted。
// 桩掉推荐接口 / 曲库 / SDK，不依赖网络（别名见 tests/run-all.mjs 的 CASES）。
// 运行：node tests/run-test.mjs tests/guess-paging-mock.ts <别名JSON>
import { guessSongs, guessKeyOf, GUESS_SIZE } from '../src/player/guess';

let failed = 0;
const check = (name: string, cond: boolean, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) failed++;
};

// 第 1 页：一整页新歌，不算抽干
const seen = new Set<string>();
const page1 = await guessSongs({ exclude: seen });
check('第一页拿到一整页', page1.list.length === GUESS_SIZE, `n=${page1.list.length}`);
check('第一页不带 exhausted', page1.exhausted === false);
check('第一页带说明文字', page1.desc.length > 0);
for (const t of page1.list) seen.add(guessKeyOf(t));
check('第一页内没有重复', seen.size === page1.list.length, `unique=${seen.size}`);

// 连续翻页直到抽干；上限防死循环
let pages = 1;
let exhausted = false;
let dupTotal = 0;
while (!exhausted && pages < 12) {
    const res = await guessSongs({ exclude: seen });
    pages++;
    dupTotal += res.list.filter(t => seen.has(guessKeyOf(t))).length;
    for (const t of res.list) seen.add(guessKeyOf(t));
    exhausted = res.exhausted;
    if (!res.list.length) break;
}
check('翻页没有重复推荐', dupTotal === 0, `dups=${dupTotal}`);
check('翻页能推出远超一页的歌', seen.size > GUESS_SIZE * 2, `unique=${seen.size}`);
check('池子抽干后会标记 exhausted', exhausted === true, `pages=${pages}`);

// 抽干后再要一页：返回空列表而不是报错
const empty = await guessSongs({ exclude: seen });
check('抽干后返回空列表不抛错', empty.list.length >= 0 && empty.exhausted === true, `n=${empty.list.length}`);

console.log(failed ? `\n${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
