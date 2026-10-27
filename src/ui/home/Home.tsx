/** 首页：乐库拼贴墙（默认）或 3D 封面流（我的歌单 / 歌单广场 / 排行榜），可在两者间切换 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Flame, FolderOpen, Heart, LayoutDashboard, Link2, Plus, Search, Settings, Trophy } from 'lucide-react';
import { extractPalette } from '@/lib/color';
import { formatCount } from '@/lib/util';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, PLATFORMS, type OnlinePlaylist, type Platform } from '@/sdk/types';
import { FAVORITES_ID, LOCAL_ID, RECENT_ID, playlistTracks, resolveCover, useLibrary } from '@/store/library';
import { playList } from '@/store/player';
import { setSetting, useSettings } from '@/store/settings';
import { ui, useUi } from '@/store/ui';
import { Chip, EmptyState, IconButton, Segmented, Spinner, cx } from '../components/common';
import { useCompact } from '../hooks';
import { Library } from '../library/Library';
import { ControlPill } from '../player/ControlPill';
import { Carousel, PosterArt, type CarouselItem } from './Carousel';
import { NowPlayingButton } from './NowPlayingButton';
import { playRemote } from './remote';

const focusMemory: Record<string, number> = {};

function useMineItems(): CarouselItem[] {
    const playlists = useLibrary(s => s.playlists);
    const tracks = useLibrary(s => s.tracks);
    const recent = useLibrary(s => s.recent);
    return useMemo(() => {
        const items: CarouselItem[] = [];
        for (const p of playlists) {
            const list = playlistTracks(p, tracks);
            const firstCover = p.cover || list.find(t => t.cover)?.cover;
            if (p.id === FAVORITES_ID) {
                items.push({
                    key: p.id,
                    title: p.name,
                    meta: `${list.length} 首 • 收藏`,
                    art: <PosterArt title="我喜欢" subtitle="Favorites" seed="fav" tone={[330, 280]} icon={<Heart fill="currentColor" />} />,
                    onOpen: () => ui.openDetail({ kind: 'user', id: p.id }),
                    onPlay: list.length ? () => playList(list) : undefined,
                });
                items.push({
                    key: RECENT_ID,
                    title: '最近播放',
                    meta: `${recent.length} 首 • 历史`,
                    art: <PosterArt title="最近播放" subtitle="Recently" seed="recent" tone={[205, 250]} icon={<Clock />} />,
                    onOpen: () => ui.openDetail({ kind: 'user', id: RECENT_ID }),
                    onPlay: recent.length ? () => playList(recent.map(id => tracks[id]).filter(Boolean)) : undefined,
                });
                continue;
            }
            if (p.id === LOCAL_ID) {
                items.push({
                    key: p.id,
                    title: p.name,
                    meta: `${list.length} 首 • 本地`,
                    cover: firstCover,
                    art: firstCover ? undefined : <PosterArt title="本地音乐" subtitle="Local" seed="local" tone={[160, 200]} icon={<FolderOpen />} />,
                    onOpen: () => ui.openDetail({ kind: 'user', id: p.id }),
                    onPlay: list.length ? () => playList(list) : undefined,
                });
                continue;
            }
            items.push({
                key: p.id,
                title: p.name,
                meta: `${list.length} 首 • ${p.origin ? PLATFORM_NAMES[p.origin.platform] : '自建歌单'}`,
                cover: firstCover,
                seed: p.name,
                onOpen: () => ui.openDetail({ kind: 'user', id: p.id }),
                onPlay: list.length ? () => playList(list) : undefined,
            });
        }
        items.push({
            key: '__create',
            title: '新建歌单',
            meta: '整理你喜欢的歌',
            art: <PosterArt title="新建歌单" subtitle="New" seed="new" tone={[250, 290]} icon={<Plus />} />,
            onOpen: () => ui.dialog({ type: 'createPlaylist' }),
        });
        items.push({
            key: '__import',
            title: '导入歌单',
            meta: '支持五大平台的歌单链接',
            art: <PosterArt title="导入歌单" subtitle="Import" seed="import" tone={[30, 350]} icon={<Link2 />} />,
            onOpen: () => ui.dialog({ type: 'importPlaylist' }),
        });
        return items;
    }, [playlists, tracks, recent]);
}

const plazaCache = new Map<string, { list: OnlinePlaylist[]; page: number; total: number }>();

function usePlazaItems(platform: Platform, enabled: boolean) {
    const key = platform;
    const [state, setState] = useState(() => plazaCache.get(key));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const load = async (page: number) => {
        setLoading(true);
        setError(null);
        try {
            const sdk = sdks[platform];
            const res = await sdk.getSongLists(sdk.songListSorts[0]?.id || '', page);
            const prevList = page === 1 ? [] : plazaCache.get(key)?.list || [];
            const seen = new Set(prevList.map(p => p.id));
            const next = { list: [...prevList, ...res.list.filter(p => !seen.has(p.id))], page, total: res.total };
            plazaCache.set(key, next);
            setState(next);
        } catch (err) {
            setError((err as Error).message || '加载失败');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (!enabled) return;
        const cached = plazaCache.get(key);
        setState(cached);
        if (!cached) void load(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);
    const items: CarouselItem[] = (state?.list || []).map(p => ({
        key: `${p.source}_${p.id}`,
        title: p.name,
        meta: [p.playCount ? `${formatCount(p.playCount)} 次播放` : '', p.author, PLATFORM_NAMES[p.source]].filter(Boolean).join(' • '),
        cover: p.cover,
        seed: p.name,
        onOpen: () => ui.openDetail({ kind: 'songlist', platform: p.source, id: p.id, info: p }),
        onPlay: () => playRemote(p.source, 'songlist', p.id, p.name),
    }));
    const loadMore = () => {
        if (loading || !state) return;
        if (state.total && state.list.length >= state.total) return;
        void load(state.page + 1);
    };
    return { items, loading, error, reload: () => load(1), loadMore };
}

function boardItems(platform: Platform): CarouselItem[] {
    return sdks[platform].boards.map((b, i) => ({
        key: b.id,
        title: b.name,
        meta: `${PLATFORM_NAMES[platform]} • 排行榜`,
        art: <PosterArt title={b.name} subtitle={PLATFORM_NAMES[platform]} seed={b.id} icon={i % 3 === 0 ? <Trophy /> : <Flame />} />,
        onOpen: () => ui.openDetail({ kind: 'board', platform, id: b.bangid, name: b.name }),
        onPlay: () => playRemote(platform, 'board', b.bangid, b.name),
    }));
}

export function Home() {
    const layout = useSettings(s => s.homeLayout);
    return layout === 'carousel' ? <CarouselHome /> : <Library />;
}

function CarouselHome() {
    const tab = useSettings(s => s.homeTab);
    const plazaPlatform = useSettings(s => s.plazaPlatform);
    const boardPlatform = useSettings(s => s.boardPlatform);
    const reduceMotion = useSettings(s => s.reduceMotion);
    const compact = useCompact();
    const overlay = useUi(s => Boolean(s.detail || s.searchOpen || s.playerOpen || s.settingsOpen || s.dialog));
    const mine = useMineItems();
    const plaza = usePlazaItems(plazaPlatform, tab === 'plaza');
    const boards = useMemo(() => boardItems(boardPlatform), [boardPlatform]);
    const items = tab === 'mine' ? mine : tab === 'plaza' ? plaza.items : boards;
    const memoryKey = tab === 'mine' ? 'mine' : tab === 'plaza' ? `plaza_${plazaPlatform}` : `boards_${boardPlatform}`;
    const [focus, setFocusState] = useState(() => focusMemory[memoryKey] || 0);
    useEffect(() => setFocusState(Math.min(focusMemory[memoryKey] || 0, Math.max(0, items.length - 1))), [memoryKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const setFocus = (index: number) => {
        focusMemory[memoryKey] = index;
        setFocusState(index);
        if (tab === 'plaza' && index > items.length - 5) plaza.loadMore();
    };
    const safeFocus = Math.min(focus, Math.max(0, items.length - 1));
    const item = items[safeFocus];

    // 背景跟随当前焦点封面取色
    useEffect(() => {
        let alive = true;
        const timer = setTimeout(async () => {
            const url = await resolveCover(item?.cover);
            const palette = url ? await extractPalette(url) : null;
            if (alive) useUi.setState({ bgPalette: palette });
        }, 220);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [item?.cover]);

    const tabSwitch = (
        <Segmented
            value={tab}
            onChange={v => setSetting('homeTab', v)}
            options={[
                { value: 'mine', label: '我的' },
                { value: 'plaza', label: '歌单广场' },
                { value: 'boards', label: '排行榜' },
            ]}
        />
    );

    return (
        <div className="absolute inset-0 flex flex-col">
            {compact ? (
                <header className="relative z-20 shrink-0 px-4 pt-3">
                    <div className="flex h-11 items-center justify-between">
                        <span className="text-[24px] font-bold leading-none tracking-[-0.02em] text-white/95">YEmusic</span>
                        <div className="flex items-center gap-0.5">
                            <IconButton label="搜索" onClick={() => ui.openSearch()}><Search className="h-5 w-5" /></IconButton>
                            <IconButton label="设置" onClick={() => ui.openSettings()}><Settings className="h-5 w-5" /></IconButton>
                            <IconButton label="切换为乐库布局" onClick={() => setSetting('homeLayout', 'library')}><LayoutDashboard className="h-5 w-5" /></IconButton>
                        </div>
                    </div>
                    <div className="mt-2.5 flex justify-center">{tabSwitch}</div>
                </header>
            ) : (
            <header className="drag relative z-20 flex h-[100px] shrink-0 items-start justify-between px-8 pt-[30px]">
                <div className="flex items-center gap-2">
                    <span className="mr-2 text-[26px] font-bold leading-none tracking-[-0.02em] text-white/95">YEmusic</span>
                    <IconButton label="设置（Ctrl ,）" size="sm" onClick={() => ui.openSettings()}><Settings className="h-[18px] w-[18px]" /></IconButton>
                    <IconButton label="切换为乐库布局" size="sm" onClick={() => setSetting('homeLayout', 'library')}><LayoutDashboard className="h-[18px] w-[18px]" /></IconButton>
                </div>
                <div className="absolute left-1/2 top-[30px] -translate-x-1/2">{tabSwitch}</div>
                <button
                    type="button"
                    onClick={() => ui.openSearch()}
                    className="no-drag flex h-10 w-[248px] items-center gap-2.5 rounded-full border border-white/[0.14] bg-white/[0.04] px-4 text-left text-[13px] text-white/40 backdrop-blur-xl transition-colors hover:border-white/25 hover:bg-white/[0.08]"
                >
                    <Search className="h-4 w-4 text-white/55" />
                    <span className="flex-1 truncate">搜索歌曲、歌手…</span>
                    <kbd>Ctrl K</kbd>
                </button>
            </header>
            )}

            <div className="relative z-10 flex h-10 shrink-0 items-center justify-center gap-1.5">
                {tab !== 'mine' && PLATFORMS.map(p => (
                    <Chip key={p} active={(tab === 'plaza' ? plazaPlatform : boardPlatform) === p} onClick={() => setSetting(tab === 'plaza' ? 'plazaPlatform' : 'boardPlatform', p)} className="h-7 px-3 text-[12px]">
                        {PLATFORM_NAMES[p]}
                    </Chip>
                ))}
            </div>

            <main className="relative min-h-0 flex-1">
                {tab === 'plaza' && !items.length ? (
                    <div className="absolute inset-0 grid place-items-center">
                        {plaza.error ? (
                            <EmptyState title="歌单加载失败" desc={plaza.error}>
                                <button type="button" onClick={plaza.reload} className="no-drag h-9 rounded-full bg-white px-5 text-[13px] font-medium text-black">重试</button>
                            </EmptyState>
                        ) : (
                            <div className="flex items-center gap-2 text-[13px] text-white/50"><Spinner />正在载入歌单…</div>
                        )}
                    </div>
                ) : (
                    <Carousel items={items} focus={safeFocus} onFocus={setFocus} keyboard={!overlay} reduceMotion={reduceMotion} />
                )}
            </main>

            <div className={cx('relative z-10 flex shrink-0 flex-col items-center', compact ? 'h-[84px] px-5' : 'h-[92px] px-8')}>
                <AnimatePresence mode="wait">
                    {item && (
                        <motion.div key={item.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }} className={cx('flex flex-col items-center', compact ? 'max-w-[90vw]' : 'max-w-[70vw]')}>
                            <div className={cx('max-w-full truncate font-bold tracking-tight text-white text-shadow-soft', compact ? 'text-[22px]' : 'text-[26px]')}>{item.title}</div>
                            <div className="mt-1.5 max-w-full truncate font-mono text-[12px] text-white/40">{item.meta}{tab === 'plaza' && plaza.loading ? ' • 加载中…' : ''}</div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <footer className={cx('relative z-20 flex shrink-0 justify-center', compact ? 'px-2 pb-2' : 'h-[100px] items-start')}>
                <ControlPill variant="home" />
            </footer>
            {!compact && <NowPlayingButton />}
        </div>
    );
}
