/** 乐库各标签页的数据：把歌单 / 电台 / 专辑 / 本地 / 广场 / 榜单整理成拼贴墙卡片 */
import { useLayoutEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { Clock, Disc3, FilePlus2, Folder, FolderOpen, FolderPlus, Heart, Link2, ListMusic, Mic2, Plus, QrCode, Radio, RefreshCw, Sparkles, Trophy } from 'lucide-react';
import { formatCount } from '@/lib/util';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, type OnlinePlaylist, type Platform, type Track } from '@/sdk/types';
import { albumDetail, newAlbums, recommendPlaylists, subAlbums, userPlaylists, wyToplistMeta } from '@/sdk/wyApi';
import { txUserAlbums, txUserPlaylists } from '@/sdk/txAuth';
import { kgUserPlaylists } from '@/sdk/kgAuth';
import { txAlbumDetail } from '@/sdk/tx';
import { ACCOUNT_META, useAccounts, type AccountPlatform } from '@/store/accounts';
import { addLocalFolder, FAVORITES_ID, LOCAL_ID, pickAudioFiles, playlistTracks, rescanLocal, useLibrary } from '@/store/library';
import { playList, usePlayer } from '@/store/player';
import { useSettings, type LibraryTab, type LocalGroup } from '@/store/settings';
import { ui } from '@/store/ui';
import { useAsync } from '../hooks';
import { playLoaded, playRemote } from '../home/remote';
import { FM_ID, openDaily, openGuess, openLogin, playDaily, playGuess, startFm } from './actions';
import { DailyArt, FmArt, PatternArt } from './art';
import type { WallCard } from './Wall';

export interface TabData {
    cards: WallCard[];
    loading: boolean;
    /** 没有任何卡片时显示的错误 */
    error?: string;
    /** 不阻塞展示的提示（如账号歌单加载失败） */
    notice?: string;
    /** 没有卡片时的空状态 */
    empty?: { title: string; desc?: string; actions?: { label: string; icon?: ReactNode; primary?: boolean; run: () => void }[] };
    reload: () => void;
}

export const TAB_NAMES: Record<LibraryTab, string> = { playlists: '歌单', radio: '电台', albums: '专辑', local: '本地', plaza: '广场', boards: '榜单' };

const firstCover = (list: Track[]) => list.find(t => t.cover)?.cover;
const errorText = (error: Error | undefined) => error?.message || '加载失败';

function playlistCard(p: OnlinePlaylist, extra: Partial<WallCard> = {}): WallCard {
    return {
        key: `${p.source}_${p.id}`,
        title: p.name,
        desc: p.desc || [p.playCount ? `${formatCount(p.playCount)} 次播放` : '', p.author].filter(Boolean).join(' · '),
        badge: p.total ? `歌单 · ${p.total}` : '歌单',
        cover: p.cover,
        stack: true,
        onOpen: () => ui.openDetail({ kind: 'songlist', platform: p.source, id: p.id, info: p }),
        onPlay: () => playRemote(p.source, 'songlist', p.id, p.name),
        ...extra,
    };
}

/** 网易云 / QQ音乐的专辑 */
export interface LibraryAlbum { id: string; platform: 'wy' | 'tx'; name: string; artist: string; cover?: string; size?: number; publishTime?: number | string; desc?: string }

const albumYear = (t?: number | string) => (typeof t === 'number' ? new Date(t).getFullYear() : t ? String(t).slice(0, 4) : '');

function albumCard(album: LibraryAlbum, badge: string, extra: Partial<WallCard> = {}): WallCard {
    const load = album.platform === 'tx' ? () => txAlbumDetail(album.id) : async () => (await albumDetail(album.id)).tracks;
    return {
        key: `album_${album.platform}_${album.id}`,
        title: album.name,
        desc: [album.artist, albumYear(album.publishTime)].filter(Boolean).join(' · '),
        badge: album.size ? `${badge} · ${album.size}` : badge,
        cover: album.cover,
        stack: true,
        onOpen: () => ui.openDetail({ kind: 'album', platform: album.platform, id: album.id, info: { name: album.name, cover: album.cover, author: album.artist, desc: album.desc } }),
        onPlay: () => playLoaded(album.name, load),
        ...extra,
    };
}

function actionCard(key: string, title: string, desc: string, icon: ReactNode, onOpen: () => void, tone?: [number, number]): WallCard {
    return { key, title, desc, action: true, art: <PatternArt seed={key} icon={icon} tone={tone} />, onOpen };
}

const LOGIN_TONES: Record<AccountPlatform, [number, number]> = { wy: [350, 10], tx: [140, 170], kg: [215, 235] };
const loginCard = (p: AccountPlatform, desc: string) => actionCard(`__login_${p}`, `登录${ACCOUNT_META[p].name}`, desc, <QrCode />, () => openLogin(p), LOGIN_TONES[p]);

/** 当前平台账号的歌单 */
async function accountPlaylists(p: AccountPlatform, id: string) {
    if (p === 'wy') return userPlaylists(Number(id));
    if (p === 'tx') return txUserPlaylists(id);
    return kgUserPlaylists();
}

/** 用来铺满墙面的推荐歌单：网易云为（个性化）推荐，其它平台为广场的热门歌单 */
async function fillerPlaylists(p: AccountPlatform, loggedIn: boolean) {
    if (p === 'wy') return recommendPlaylists(loggedIn);
    return loadPlaza(p);
}

// ---------------- 歌单 ----------------
function usePlaylistsTab(): TabData {
    const playlists = useLibrary(s => s.playlists);
    const tracks = useLibrary(s => s.tracks);
    const recent = useLibrary(s => s.recent);
    const provider = useSettings(s => s.libraryAccount);
    const account = useAccounts()[provider];
    const profile = account.profile;
    const meta = ACCOUNT_META[provider];
    const needLogin = !profile || account.status === 'expired';
    const remote = useAsync(profile && !needLogin ? `${provider}:playlists:${profile.id}:${account.version}` : null, () => accountPlaylists(provider, profile!.id));
    // 自己的歌单还不多时，用推荐歌单把墙铺满（网易云登录后为个性化推荐）
    const ownCount = playlists.length + (remote.data?.length || 0);
    const recs = useAsync(ownCount < 12 && !remote.loading ? `${provider}:fill:${profile?.id || 0}:${account.version}` : null, () => fillerPlaylists(provider, Boolean(profile)));
    const cards = useMemo(() => {
        const out: WallCard[] = [];
        const imported = new Set(playlists.map(p => (p.origin ? `${p.origin.platform}_${p.origin.id}` : '')).filter(Boolean));
        const accountLists = (profile && remote.data) || [];
        const isImported = (p: OnlinePlaylist) => imported.has(`${p.source}_${p.id}`);
        // 账号的“我喜欢”排到整面墙最前面：登录了音乐平台之后，最想看到的就是自己的收藏。
        // 本地收藏卡片（同名、往往是空的）跟在它后面，两者用角标区分开。
        const liked = accountLists.find(p => p.liked && !isImported(p));
        const likedCard = (p: (typeof accountLists)[number]) => playlistCard(p as OnlinePlaylist, {
            featured: true,
            desc: `${meta.short} · ${p.total || 0} 首`,
            badge: `${meta.short} · ${p.total || 0}`,
            badgeIcon: <Heart fill="currentColor" />,
        });
        if (liked) out.push(likedCard(liked));
        for (const p of playlists) {
            const list = playlistTracks(p, tracks);
            const cover = p.cover || firstCover(list);
            if (p.id === FAVORITES_ID) {
                out.push({
                    key: p.id,
                    title: p.name,
                    desc: list.length ? `${list.length} 首 · 本地收藏` : '点亮歌曲旁的爱心即可收藏',
                    badge: `歌单 · ${list.length}`,
                    badgeIcon: <Heart fill="currentColor" />,
                    featured: true,
                    stack: true,
                    cover,
                    art: cover ? undefined : <PatternArt seed="fav" tone={[330, 280]} icon={<Heart fill="currentColor" />} />,
                    onOpen: () => ui.openDetail({ kind: 'user', id: p.id }),
                    onPlay: list.length ? () => playList(list) : undefined,
                });
                const recentTracks = recent.map(id => tracks[id]).filter(Boolean);
                const recentCover = firstCover(recentTracks.slice(0, 12));
                out.push({
                    key: 'recent',
                    title: '最近播放',
                    desc: recentTracks.length ? `上次听：${recentTracks[0].name}` : '还没有播放记录',
                    badge: `历史 · ${recentTracks.length}`,
                    stack: true,
                    badgeIcon: <Clock />,
                    cover: recentCover,
                    art: recentCover ? undefined : <PatternArt seed="recent" tone={[205, 250]} icon={<Clock />} />,
                    onOpen: () => ui.openDetail({ kind: 'user', id: 'recent' }),
                    onPlay: recentTracks.length ? () => playList(recentTracks) : undefined,
                });
                continue;
            }
            if (p.id === LOCAL_ID) {
                if (!list.length) continue;
                out.push({
                    key: p.id,
                    title: p.name,
                    desc: `${list.length} 首 · 本地文件`,
                    badge: `本地 · ${list.length}`,
                    stack: true,
                    cover,
                    art: cover ? undefined : <PatternArt seed="local" tone={[160, 200]} icon={<FolderOpen />} />,
                    onOpen: () => ui.openDetail({ kind: 'user', id: p.id }),
                    onPlay: () => playList(list),
                });
                continue;
            }
            out.push({
                key: p.id,
                title: p.name,
                desc: p.desc || (p.origin ? `导入自${PLATFORM_NAMES[p.origin.platform]}` : '自建歌单'),
                badge: `歌单 · ${list.length}`,
                cover,
                stack: true,
                onOpen: () => ui.openDetail({ kind: 'user', id: p.id }),
                onPlay: list.length ? () => playList(list) : undefined,
            });
        }
        if (profile && remote.data) {
            const mine = remote.data.filter(p => !p.subscribed);
            const subscribed = remote.data.filter(p => p.subscribed);
            // “我喜欢”排最前
            mine.sort((a, b) => Number(Boolean(b.liked)) - Number(Boolean(a.liked)));
            for (const p of [...mine, ...subscribed]) {
                if (imported.has(`${p.source}_${p.id}`)) continue;
                if (liked && p === liked) continue; // 已经排到墙最前面了
                out.push(playlistCard(p, {
                    featured: p.liked,
                    desc: p.liked ? `${meta.short} · ${p.total || 0} 首` : `${meta.short} · ${p.subscribed ? `收藏${p.author ? ` · ${p.author}` : ''}` : '创建'}`,
                    badgeIcon: p.liked ? <Heart fill="currentColor" /> : undefined,
                }));
            }
        }
        out.push(actionCard('__create', '新建歌单', '整理你喜欢的歌', <Plus />, () => ui.dialog({ type: 'createPlaylist' }), [250, 290]));
        out.push(actionCard('__import', '导入歌单', '粘贴五大平台的歌单链接', <Link2 />, () => ui.dialog({ type: 'importPlaylist' }), [30, 350]));
        if (needLogin) out.push(loginCard(provider, profile ? '登录已失效，重新扫码同步歌单' : `同步你的${meta.name}歌单`));
        if (ownCount < 12) {
            const seen = new Set(out.map(c => c.key));
            for (const p of recs.data || []) {
                const card = playlistCard(p, { badge: p.total ? `推荐 · ${p.total}` : '推荐' });
                if (!seen.has(card.key)) out.push(card);
            }
        }
        return out;
    }, [playlists, tracks, recent, profile, remote.data, recs.data, ownCount, provider, meta, needLogin]);
    return {
        cards,
        loading: remote.loading || recs.loading,
        notice: remote.error ? `${meta.name}歌单加载失败：${errorText(remote.error)}` : undefined,
        reload: () => { remote.reload(); recs.reload(); },
    };
}

// ---------------- 电台 ----------------
function useRadioTab(): TabData {
    const wy = useAccounts().wy;
    const profile = wy.profile;
    const version = wy.version;
    const radio = usePlayer(s => s.radio);
    const current = usePlayer(s => s.current);
    const recs = useAsync(`wy:fill:${profile?.id || 0}:${version}`, () => recommendPlaylists(Boolean(profile)));
    const fmActive = radio?.id === FM_ID;
    const fmCover = fmActive ? current?.cover : undefined;
    const cards = useMemo(() => {
        const today = new Date();
        const out: WallCard[] = [
            {
                key: 'fm',
                title: '私人FM',
                desc: fmActive && current ? `正在播放：${current.name}` : profile ? '按你的口味无限续播' : '通用推荐 · 登录后更懂你',
                badge: '电台',
                badgeIcon: <Radio />,
                special: true,
                featured: true,
                active: fmActive,
                art: <FmArt cover={fmCover} />,
                onOpen: fmActive ? ui.openPlayer : startFm,
                onPlay: startFm,
            },
            {
                key: 'daily',
                title: '每日推荐',
                desc: `${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${profile ? '根据你的口味生成' : '通用推荐'}`,
                badge: '每日推荐 · 30',
                special: true,
                featured: true,
                art: <DailyArt />,
                onOpen: openDaily,
                onPlay: playDaily,
            },
            {
                key: 'guess',
                title: '猜我喜欢',
                desc: '根据你的收藏与最近播放，猜你还没听过的歌',
                badge: '为你推荐',
                badgeIcon: <Sparkles />,
                special: true,
                featured: true,
                art: <PatternArt seed="guess" tone={[275, 330]} icon={<Sparkles />} />,
                onOpen: openGuess,
                onPlay: playGuess,
            },
        ];
        for (const p of recs.data || []) out.push(playlistCard(p));
        if (!profile) out.push(loginCard('wy', '私人FM 与每日推荐按你的口味生成'));
        return out;
    }, [recs.data, profile, fmActive, fmCover, current]);
    return { cards, loading: recs.loading, notice: recs.error ? `推荐歌单加载失败：${errorText(recs.error)}` : undefined, reload: recs.reload };
}

// ---------------- 专辑 ----------------
function useAlbumsTab(): TabData {
    const provider = useSettings(s => s.libraryAccount);
    const account = useAccounts()[provider];
    const profile = account.profile;
    const supported = provider !== 'kg';
    const needLogin = !profile || account.status === 'expired';
    const subs = useAsync(
        !needLogin && supported ? `${provider}:subalbums:${profile!.id}:${account.version}` : null,
        async (): Promise<LibraryAlbum[]> => (provider === 'tx'
            ? (await txUserAlbums(profile!.id)).map(a => ({ id: a.mid, platform: 'tx', name: a.name, artist: a.artist, cover: a.cover, size: a.size, publishTime: a.publishTime }))
            : (await subAlbums()).map(a => ({ ...a, platform: 'wy' }))),
    );
    const fresh = useAsync('wy:newalbums', async (): Promise<LibraryAlbum[]> => (await newAlbums()).map(a => ({ ...a, platform: 'wy' })));
    const cards = useMemo(() => {
        const out: WallCard[] = [];
        const seen = new Set<string>();
        (subs.data || []).forEach((album, i) => {
            seen.add(`${album.platform}_${album.id}`);
            out.push(albumCard(album, '专辑', { featured: i < 2 }));
        });
        (fresh.data || []).forEach((album, i) => {
            if (seen.has(`${album.platform}_${album.id}`)) return;
            out.push(albumCard(album, '新碟', { featured: !subs.data?.length && i < 2 }));
        });
        if (needLogin && supported) out.push(loginCard(provider, '显示你收藏的专辑'));
        return out;
    }, [subs.data, fresh.data, provider, supported, needLogin]);
    const errors = [subs.error && `收藏专辑：${errorText(subs.error)}`, fresh.error && `新碟上架：${errorText(fresh.error)}`].filter(Boolean).join('；');
    return {
        cards,
        loading: subs.loading || fresh.loading,
        error: cards.length <= 1 && errors ? errors : undefined,
        notice: errors || (profile && !supported ? '酷狗音乐暂不支持同步收藏的专辑，这里显示新碟上架' : undefined),
        reload: () => { subs.reload(); fresh.reload(); },
    };
}

// ---------------- 本地 ----------------
const splitArtists = (singer: string) => String(singer || '').split(/\s*(?:[、,，/&;；]|\s(?:feat\.?|ft\.?)\s)\s*/i).map(s => s.trim()).filter(Boolean);
const dirname = (path = '') => path.replace(/[\\/][^\\/]*$/, '');

function groupLocal(list: Track[], by: LocalGroup) {
    const groups = new Map<string, Track[]>();
    const add = (name: string, track: Track) => {
        const items = groups.get(name);
        if (items) items.push(track);
        else groups.set(name, [track]);
    };
    for (const track of list) {
        if (by === 'albums') add(track.album?.trim() || '未知专辑', track);
        else if (by === 'artists') {
            const artists = splitArtists(track.singer);
            for (const artist of artists.length ? artists.slice(0, 4) : ['未知歌手']) add(artist, track);
        }
        else add(track.folder || dirname(track.path) || '未知文件夹', track);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN'));
}

function mostCommon(values: string[]) {
    const counts = new Map<string, number>();
    for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function useLocalTab(): TabData {
    const playlists = useLibrary(s => s.playlists);
    const tracks = useLibrary(s => s.tracks);
    const scanning = useLibrary(s => s.scan.active);
    const by = useSettings(s => s.localGroup);
    const folders = useSettings(s => s.localFolders);
    const cards = useMemo(() => {
        const local = playlistTracks(playlists.find(p => p.id === LOCAL_ID), tracks);
        const out: WallCard[] = [];
        if (!local.length) return out;
        out.push({
            key: 'local_all',
            title: '全部本地歌曲',
            desc: `${local.length} 首 · ${folders.length} 个文件夹`,
            badge: `本地 · ${local.length}`,
            featured: true,
            stack: true,
            cover: firstCover(local),
            onOpen: () => ui.openDetail({ kind: 'user', id: LOCAL_ID }),
            onPlay: () => playList(local),
        });
        const label = by === 'albums' ? '专辑' : by === 'artists' ? '歌手' : '文件夹';
        for (const [name, items] of groupLocal(local, by)) {
            const desc = by === 'albums'
                ? mostCommon(items.map(t => splitArtists(t.singer)[0] || ''))
                : by === 'artists'
                    ? `${new Set(items.map(t => t.album).filter(Boolean)).size} 张专辑 · ${items.length} 首`
                    : name;
            const title = by === 'folders' ? name.split(/[\\/]/).filter(Boolean).pop() || name : name;
            out.push({
                key: `local_${by}_${name}`,
                title,
                desc,
                badge: `${label} · ${items.length}`,
                stack: true,
                cover: firstCover(items),
                art: firstCover(items) ? undefined : <PatternArt seed={name} icon={by === 'albums' ? <Disc3 /> : by === 'artists' ? <Mic2 /> : <Folder />} />,
                onOpen: () => ui.openDetail({ kind: 'tracks', id: `local:${by}:${name}`, name: title, desc: by === 'folders' ? name : desc, cover: firstCover(items), trackIds: items.map(t => t.id) }),
                onPlay: () => playList(items),
            });
        }
        out.push(actionCard('__add_folder', '添加文件夹', '扫描更多本地音乐', <FolderPlus />, addLocalFolder, [160, 200]));
        if (folders.length) out.push(actionCard('__rescan', scanning ? '正在扫描…' : '重新扫描', '同步文件夹里的新增 / 删除', <RefreshCw />, () => { if (!scanning) void rescanLocal(); }, [140, 190]));
        return out;
    }, [playlists, tracks, by, folders, scanning]);
    return {
        cards,
        loading: scanning,
        empty: {
            title: scanning ? '正在扫描本地音乐…' : '还没有本地音乐',
            desc: '添加音乐文件夹后会自动扫描歌曲、读取标签与内嵌封面，并按专辑 / 歌手 / 文件夹整理在这里。',
            actions: [
                { label: '添加文件夹', icon: <FolderPlus className="h-4 w-4" />, primary: true, run: () => void addLocalFolder() },
                { label: '添加文件', icon: <FilePlus2 className="h-4 w-4" />, run: () => void pickAudioFiles() },
            ],
        },
        reload: () => { if (folders.length) void rescanLocal(); },
    };
}

// ---------------- 广场 ----------------
async function loadPlaza(platform: Platform): Promise<OnlinePlaylist[]> {
    const sdk = sdks[platform];
    const sort = sdk.songListSorts[0]?.id || '';
    const first = await sdk.getSongLists(sort, 1);
    const list = [...first.list];
    if (!first.total || first.total > list.length) {
        const second = await sdk.getSongLists(sort, 2).catch(() => null);
        const seen = new Set(list.map(p => p.id));
        for (const p of second?.list || []) if (!seen.has(p.id)) list.push(p);
    }
    return list;
}

function usePlazaTab(): TabData {
    const platform = useSettings(s => s.plazaPlatform);
    const data = useAsync(`library:plaza:${platform}`, () => loadPlaza(platform));
    const cards = useMemo(() => (data.data || []).map((p, i) => playlistCard(p, { featured: i < 2 })), [data.data]);
    return { cards, loading: data.loading, error: data.error ? `${PLATFORM_NAMES[platform]}歌单加载失败：${errorText(data.error)}` : undefined, reload: data.reload };
}

// ---------------- 榜单 ----------------
function useBoardsTab(): TabData {
    const platform = useSettings(s => s.boardPlatform);
    const meta = useAsync(platform === 'wy' ? 'wy:toplist' : null, wyToplistMeta);
    const cards = useMemo(() => sdks[platform].boards.map((b, i): WallCard => {
        const info = meta.data?.get(b.bangid);
        return {
            key: b.id,
            title: b.name,
            desc: [PLATFORM_NAMES[platform], info?.desc].filter(Boolean).join(' · '),
            badge: '榜单',
            featured: i < 2,
            cover: info?.cover,
            art: info?.cover ? undefined : <PatternArt seed={b.id} icon={i % 3 === 0 ? <Trophy /> : <ListMusic />} />,
            onOpen: () => ui.openDetail({ kind: 'board', platform, id: b.bangid, name: b.name }),
            onPlay: () => playRemote(platform, 'board', b.bangid, b.name),
        };
    }), [platform, meta.data]);
    return { cards, loading: meta.loading, reload: meta.reload };
}

const HOOKS: Record<LibraryTab, () => TabData> = {
    playlists: usePlaylistsTab,
    radio: useRadioTab,
    albums: useAlbumsTab,
    local: useLocalTab,
    plaza: usePlazaTab,
    boards: useBoardsTab,
};

/** 每个标签页一个组件（按标签页 key 重新挂载），保证 hooks 调用顺序稳定；数据通过回调交给乐库 */
export function TabProbe({ tab, onData, reloadRef }: { tab: LibraryTab; onData: (data: TabData) => void; reloadRef: MutableRefObject<() => void> }) {
    const data = HOOKS[tab]();
    reloadRef.current = data.reload;
    const last = useRef<TabData | null>(null);
    useLayoutEffect(() => {
        const prev = last.current;
        last.current = data;
        if (prev && prev.cards === data.cards && prev.loading === data.loading && prev.error === data.error && prev.notice === data.notice && prev.empty?.title === data.empty?.title) return;
        onData(data);
    });
    return null;
}
