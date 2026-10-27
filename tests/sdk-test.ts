import './setup-host.cjs';
import { sdks } from '../src/sdk';
const only = process.argv[2];
const platforms = (only ? [only] : ['kw', 'kg', 'tx', 'wy', 'mg']) as (keyof typeof sdks)[];
const brief = (t: any) => t && `${t.name} - ${t.singer} [${t.album}] ${t.duration}s q=${(t.qualities || []).map((q: any) => q.type).join('/')} cover=${t.cover ? 'Y' : 'N'} meta=${JSON.stringify(t.meta || {}).slice(0, 80)}`;
(async () => { for (const p of platforms) {
  const sdk = sdks[p];
  const step = async (name: string, fn: () => Promise<string>) => { const t0 = Date.now(); try { console.log(`[${p}] ${name}: ${await fn()} (${Date.now() - t0}ms)`); } catch (e: any) { console.log(`[${p}] ${name}: ERROR ${e?.message}`); } };
  let first: any;
  await step('search', async () => { const r = await sdk.search('晴天 周杰伦', 1, 10); first = r.list.find(t => /晴天/.test(t.name)) || r.list[0]; return `${r.list.length}/${r.total} :: ${brief(first)}`; });
  if (first) await step('lyric', async () => { const l = await sdk.getLyric(first); return `lrc=${l.lyric.length} t=${l.tlyric?.length || 0} r=${l.rlyric?.length || 0} lx=${l.lxlyric?.length || 0} :: ${l.lyric.split('\n').filter(x => /\]\S/.test(x)).slice(3, 5).join(' | ')} :: ${(l.lxlyric || '').split('\n')[5] || ''}`.slice(0, 300); });
  if (first && sdk.getPic) await step('pic', async () => sdk.getPic!(first));
  await step('board', async () => { const r = await sdk.getBoardList(sdk.boards[0].bangid, 1); return `${sdk.boards[0].name} ${r.list.length}/${r.total} :: ${brief(r.list[0])}`; });
  let pl: any;
  await step('songlists', async () => { const r = await sdk.getSongLists(sdk.songListSorts[0].id, 1); pl = r.list[0]; return `${r.list.length}/${r.total} :: ${pl?.name} cover=${pl?.cover?.slice(0, 60)} play=${pl?.playCount}`; });
  if (pl) await step('songlist detail', async () => { const r = await sdk.getSongListDetail(pl.id, 1); return `${r.list.length}/${r.total} info=${r.info?.name} :: ${brief(r.list[0])}`; });
} })();
