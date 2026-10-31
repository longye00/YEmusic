/** 歌单 / 排行榜详情页 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookmarkPlus, CalendarDays, Check, ChevronLeft, Clock, Download, FilePlus2, FolderPlus, Heart, ListEnd, Pencil, Play, RefreshCw, Search, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { extractPalette } from '@/lib/color';
import { isAndroid } from '@/lib/host';
import { formatCount } from '@/lib/util';
import { guessSongs } from '@/player/guess';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, type ListDetail, type Platform, type Track } from '@/sdk/types';
import { albumDetail, dailySongs } from '@/sdk/wyApi';
import { txAlbumDetail } from '@/sdk/tx';
import { downloadMany } from '@/store/downloads';
import { addLocalFolder, clearRecent, createPlaylist, deletePlaylist, FAVORITES_ID, LOCAL_ID, pickAudioFiles, playlistTracks, RECENT_ID, rescanLocal, resolveCover, saveOnlinePlaylist, upsertTracks, useLibrary } from '@/store/library';
import { playList, playNext } from '@/store/player';
import { useSettings } from '@/store/settings';
import { toast } from '@/store/toast';
import { isRemoteTarget, ui, useUi, type DetailTarget, type RemoteTarget } from '@/store/ui';
import { Button, Cover, EmptyState, IconButton, Spinner, cx } from '../components/common';
import { VirtualTrackList } from '../components/TrackList';
import { PosterArt } from '../home/Carousel';
import { MiniPlayer } from '../player/MiniPlayer';

interface RemoteState { list: Track[]; total: number; page: number; loading: boolean; error?: string; name?: string; cover?: string; desc?: string; author?: string; playCount?: number }

const todayText = () => {
    const d = new Date();
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

async function fetchRemote(target: RemoteTarget, page: number): Promise<ListDetail> {
    if (target.kind === 'board') return sdks[target.platform].getBoardList(target.id, page);
    if (target.kind === 'songlist') return sdks[target.platform].getSongListDetail(target.id, page);
    if (target.kind === 'album' && target.platform === 'tx') {
        const tracks = await txAlbumDetail(target.id);
        const first = tracks[0];
        return { list: tracks, total: tracks.length, page: 1, limit: Math.max(1, tracks.length), info: { name: target.info?.name || first?.album || '专辑', cover: target.info?.cover || first?.cover, author: target.info?.author || first?.singer } };
    }
    if (target.kind === 'album') {
        const { info, tracks } = await albumDetail(target.id);
        return { list: tracks, total: tracks.length, page: 1, limit: Math.max(1, tracks.length), info: { name: info.name, cover: info.cover, desc: info.desc, author: info.artist } };
    }
    if (target.kind === 'guess') {
        const { list, desc } = await guessSongs();
        return { list, total: list.length, page: 1, limit: Math.max(1, list.length), info: { name: '猜我喜欢', desc } };
    }
    const tracks = await dailySongs();
    return { list: tracks, total: tracks.length, page: 1, limit: Math.max(1, tracks.length), info: { name: '每日推荐', desc: `网易云 · ${todayText()}的推荐（每天 6:00 更新）` } };
}

function useRemoteList(target: DetailTarget | null) {
    const [state, setState] = useState<RemoteState>({ list: [], total: 0, page: 0, loading: false });
    const remoteTarget = isRemoteTarget(target) ? target : null;
    const key = remoteTarget ? `${remoteTarget.kind}:${remoteTarget.platform}:${remoteTarget.id}` : '';
    const load = async (page: number) => {
        if (!remoteTarget) return;
        setState(s => ({ ...s, loading: true, error: undefined }));
        try {
            const res = await fetchRemote(remoteTarget, page);
            setState(s => {
                const base = page === 1 ? [] : s.list;
                const seen = new Set(base.map(t => t.id));
                return {
                    ...s,
                    list: [...base, ...res.list.filter(t => !seen.has(t.id))],
                    total: res.total || res.list.length,
                    page,
                    loading: false,
                    name: s.name || res.info?.name,
                    cover: s.cover || res.info?.cover,
                    // 猜我喜欢每次生成的说明不同（换一批后要更新）
                    desc: remoteTarget.kind === 'guess' ? res.info?.desc || s.desc : s.desc || res.info?.desc,
                    author: s.author || res.info?.author,
                    playCount: s.playCount || res.info?.playCount,
                };
            });
        } catch (error) {
            setState(s => ({ ...s, loading: false, error: (error as Error).message || '加载失败' }));
        }
    };
    useEffect(() => {
        if (!key || !remoteTarget) return;
        const info = remoteTarget.kind === 'songlist' || remoteTarget.kind === 'album' ? remoteTarget.info : undefined;
        const name = info?.name || (remoteTarget.kind === 'board' ? remoteTarget.name : remoteTarget.kind === 'daily' ? '每日推荐' : remoteTarget.kind === 'guess' ? '猜我喜欢' : undefined);
        setState({ list: [], total: 0, page: 0, loading: true, name, cover: info?.cover, desc: info?.desc, author: info?.author, playCount: info?.playCount });
        void load(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    const loadMore = () => {
        if (state.loading || state.error || !state.page || state.list.length >= state.total) return;
        void load(state.page + 1);
    };
    return { ...state, loadMore, reload: () => load(1) };
}

export function DetailView() {
    const target = useUi(s => s.detail);
    const tracksMap = useLibrary(s => s.tracks);
    const playlists = useLibrary(s => s.playlists);
    const recent = useLibrary(s => s.recent);
    const scan = useLibrary(s => s.scan);
    const localFolders = useSettings(s => s.localFolders);
    const remote = useRemoteList(target);
    const [filter, setFilter] = useState('');

    const playlist = target?.kind === 'user' ? playlists.find(p => p.id === target.id) : undefined;
    const isRecent = target?.kind === 'user' && target.id === RECENT_ID;
    const isLocal = playlist?.id === LOCAL_ID;
    const isGroup = target?.kind === 'tracks';
    const isStatic = target?.kind === 'user' || isGroup;
    const tracks = useMemo(() => {
        if (target?.kind === 'tracks') return target.trackIds.map(id => tracksMap[id]).filter(Boolean);
        if (target?.kind !== 'user') return remote.list;
        if (isRecent) return recent.map(id => tracksMap[id]).filter(Boolean);
        return playlistTracks(playlist, tracksMap);
    }, [target, remote.list, isRecent, recent, tracksMap, playlist]);

    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return tracks;
        return tracks.filter(t => `${t.name} ${t.singer} ${t.album}`.toLowerCase().includes(q));
    }, [tracks, filter]);

    const canSaveOrigin = target?.kind === 'songlist' || target?.kind === 'board';
    const savedOnline = target && canSaveOrigin && isRemoteTarget(target) ? playlists.find(p => p.origin?.platform === target.platform && p.origin.id === target.id) : undefined;

    const title = target?.kind === 'user' ? (isRecent ? '最近播放' : playlist?.name || '歌单') : target?.kind === 'tracks' ? target.name : remote.name || (target?.kind === 'album' ? '专辑' : '歌单');
    const cover = target?.kind === 'user'
        ? playlist?.cover || tracks.find(t => t.cover)?.cover
        : target?.kind === 'tracks'
            ? target.cover || tracks.find(t => t.cover)?.cover
            : remote.cover || (target?.kind === 'board' || target?.kind === 'daily' || target?.kind === 'guess' ? tracks.find(t => t.cover)?.cover : undefined);
    const platform: Platform | undefined = isRemoteTarget(target) ? target.platform : playlist?.origin?.platform;
    const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);

    useEffect(() => {
        let alive = true;
        (async () => {
            const url = await resolveCover(cover);
            const palette = url ? await extractPalette(url) : null;
            if (alive && palette) useUi.setState({ bgPalette: palette });
        })();
        return () => { alive = false; };
    }, [cover]);

    useEffect(() => setFilter(''), [target]);

    if (!target) return null;
    if (target.kind === 'user' && !playlist && !isRecent) {
        return (
            <Shell>
                <EmptyState title="歌单不存在" desc="它可能已被删除。"><Button onClick={ui.closeDetail}>返回</Button></EmptyState>
            </Shell>
        );
    }

    const meta = [
        `${isStatic ? tracks.length : remote.total || tracks.length} 首`,
        totalDuration > 0 && (isStatic || target.kind === 'album') ? (totalDuration >= 3600 ? `${Math.floor(totalDuration / 3600)} 小时 ${Math.round((totalDuration % 3600) / 60)} 分钟` : `${Math.max(1, Math.round(totalDuration / 60))} 分钟`) : '',
        target.kind === 'guess' ? '为你推荐' : platform ? PLATFORM_NAMES[platform] : isLocal || isGroup ? '本地' : isRecent ? '历史' : playlist?.id === FAVORITES_ID ? '收藏' : '自建',
        target.kind === 'album' ? '专辑' : target.kind === 'daily' ? todayText() : isGroup ? target.desc || '' : '',
        remote.playCount ? `${formatCount(remote.playCount)} 次播放` : '',
        remote.author || '',
    ].filter(Boolean).join(' • ');

    const refreshImported = async () => {
        if (!playlist?.origin) return;
        const { platform: p, id, type } = playlist.origin;
        toast('正在刷新歌单…', 'info', { duration: 1200 });
        try {
            const sdk = sdks[p];
            const first = type === 'board' ? await sdk.getBoardList(id, 1) : await sdk.getSongListDetail(id, 1);
            const list = [...first.list];
            const pages = Math.min(20, Math.ceil((first.total || list.length) / (first.limit || 100)));
            for (let page = 2; page <= pages; page++) {
                const more = type === 'board' ? await sdk.getBoardList(id, page).catch(() => null) : await sdk.getSongListDetail(id, page).catch(() => null);
                if (!more?.list.length) break;
                list.push(...more.list);
            }
            saveOnlinePlaylist({ name: playlist.name, cover: first.info?.cover || playlist.cover, platform: p, id, type }, list);
            toast(`已刷新，共 ${list.length} 首`, 'success');
        } catch (error) {
            toast(`刷新失败：${(error as Error).message}`, 'error');
        }
    };

    /** 专辑 / 每日推荐：保存为一个本地歌单（快照） */
    const saveSnapshot = () => {
        if (!tracks.length) return;
        upsertTracks(tracks);
        const name = target.kind === 'daily' ? `每日推荐 ${todayText().replace(/\s/g, '')}` : target.kind === 'guess' ? `猜我喜欢 ${todayText().replace(/\s/g, '')}` : title;
        const saved = createPlaylist(name, tracks.map(t => t.id), { cover: cover && !cover.startsWith('idb:') ? cover : undefined, desc: remote.desc });
        toast(`已保存为歌单「${saved.name}」`, 'success', { action: { label: '打开', run: () => ui.openDetail({ kind: 'user', id: saved.id }) } });
    };

    const saveRemote = async () => {
        if (target.kind !== 'songlist' && target.kind !== 'board') return;
        let list = remote.list;
        // 收藏时尽量取全
        let page = remote.page;
        while (list.length < remote.total && page < 20) {
            page++;
            const sdk = sdks[target.platform];
            const more = target.kind === 'board' ? await sdk.getBoardList(target.id, page).catch(() => null) : await sdk.getSongListDetail(target.id, page).catch(() => null);
            if (!more?.list.length) break;
            list = [...list, ...more.list];
        }
        const saved = saveOnlinePlaylist({ name: title, cover: remote.cover || list.find(t => t.cover)?.cover, desc: remote.desc, platform: target.platform, id: target.id, type: target.kind }, list);
        toast(`已收藏到「我的」：${saved.name}`, 'success');
    };

    return (
        <Shell>
            <div className="flex h-full min-h-0 gap-10 px-10 pb-8 pt-20 max-lg:flex-col max-lg:gap-5 max-sm:gap-3 max-sm:px-4 max-sm:pb-3 max-sm:pt-[68px] short:flex-row short:gap-5 short:px-4 short:pb-2 short:pt-14">
                <motion.aside initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="flex w-[300px] shrink-0 flex-col max-lg:w-full max-lg:flex-row max-lg:items-end max-lg:gap-6 max-sm:grid max-sm:grid-cols-[88px_1fr] max-sm:gap-x-4 max-sm:gap-y-3 short:w-[230px] short:flex-col short:items-stretch short:gap-3 short:overflow-y-auto">
                    <div className="aspect-square w-full overflow-hidden rounded-[26px] shadow-[0_30px_80px_rgba(0,0,0,.5)] ring-1 ring-white/15 max-lg:w-40 max-sm:w-full max-sm:rounded-[18px] short:w-24 short:shrink-0 short:rounded-[18px]">
                        {playlist?.id === FAVORITES_ID ? (
                            <PosterArt title="我喜欢" subtitle="Favorites" seed="fav" tone={[330, 280]} icon={<Heart fill="currentColor" />} />
                        ) : target.kind === 'daily' ? (
                            <PosterArt title={todayText()} subtitle="Daily" seed="daily" tone={[350, 20]} icon={<CalendarDays />} />
                        ) : target.kind === 'guess' ? (
                            <PosterArt title="猜我喜欢" subtitle="For you" seed="guess" tone={[275, 330]} icon={<Sparkles />} />
                        ) : isRecent ? (
                            <PosterArt title="最近播放" subtitle="Recently" seed="recent" tone={[205, 250]} icon={<Clock />} />
                        ) : !cover && target.kind === 'board' ? (
                            <PosterArt title={title} subtitle={PLATFORM_NAMES[target.platform]} seed={target.id} />
                        ) : (
                            <Cover src={cover} seed={title} className="h-full w-full" rounded="rounded-[26px]" eager />
                        )}
                    </div>
                    <div className="min-w-0 max-lg:flex-1 max-sm:contents">
                        <div className="min-w-0">
                            <h1 className="mt-6 line-clamp-2 text-[28px] font-bold leading-tight tracking-tight max-lg:mt-0 max-sm:text-[21px]">{title}</h1>
                            <div className="mt-2 font-mono text-[12px] text-white/45 max-sm:mt-1.5 max-sm:text-[11px]">{meta}</div>
                            {(remote.desc || playlist?.desc) && <p className="scroll-thin mt-3 max-h-[84px] overflow-y-auto whitespace-pre-line text-[12.5px] leading-relaxed text-white/45 max-lg:hidden">{remote.desc || playlist?.desc}</p>}
                        </div>
                        <div className="min-w-0 max-sm:col-span-full">
                        <div className="mt-5 flex flex-wrap items-center gap-1.5 max-sm:mt-0">
                            <Button variant="white" disabled={!tracks.length} onClick={() => playList(shown, 0)} className="h-10 px-4"><Play className="h-4 w-4" fill="currentColor" />播放全部</Button>
                            <IconButton variant="glass" label="随机播放" disabled={!tracks.length} onClick={() => playList(shown, 0, { shuffle: true })}><Shuffle className="h-4 w-4" /></IconButton>
                            <IconButton variant="glass" label="全部加入下一首播放" disabled={!tracks.length} onClick={() => playNext(shown)}><ListEnd className="h-4 w-4" /></IconButton>
                            {!isLocal && !isGroup && <IconButton variant="glass" label="下载全部" disabled={!tracks.length} onClick={() => ui.confirm('下载全部', `将下载 ${shown.length} 首歌曲到下载目录，确定吗？`, () => downloadMany(shown))}><Download className="h-4 w-4" /></IconButton>}
                            {target.kind === 'guess' && <IconButton variant="glass" label="换一批" disabled={remote.loading} onClick={remote.reload}><RefreshCw className={cx('h-4 w-4', remote.loading && 'animate-spin')} /></IconButton>}
                            {(target.kind === 'album' || target.kind === 'daily' || target.kind === 'guess') && <IconButton variant="glass" label="保存为我的歌单" disabled={!tracks.length} onClick={saveSnapshot}><BookmarkPlus className="h-4 w-4" /></IconButton>}
                            {canSaveOrigin && (
                                savedOnline
                                    ? <IconButton variant="glass" label="已收藏（点击打开）" active onClick={() => ui.openDetail({ kind: 'user', id: savedOnline.id })}><Check className="h-4 w-4" /></IconButton>
                                    : <IconButton variant="glass" label="收藏到我的歌单" disabled={!tracks.length} onClick={saveRemote}><BookmarkPlus className="h-4 w-4" /></IconButton>
                            )}
                            {playlist?.origin && <IconButton variant="glass" label="从平台刷新" onClick={refreshImported}><RefreshCw className="h-4 w-4" /></IconButton>}
                            {playlist && playlist.kind !== 'favorites' && playlist.kind !== 'local' && (
                                <>
                                    <IconButton variant="glass" label="重命名" onClick={() => ui.dialog({ type: 'renamePlaylist', id: playlist.id, name: playlist.name })}><Pencil className="h-4 w-4" /></IconButton>
                                    <IconButton variant="glass" label="删除歌单" onClick={() => ui.confirm('删除歌单', `确定删除「${playlist.name}」吗？歌曲本身不会被删除。`, () => { deletePlaylist(playlist.id); ui.closeDetail(); }, { danger: true, confirmText: '删除' })}><Trash2 className="h-4 w-4" /></IconButton>
                                </>
                            )}
                            {isRecent && recent.length > 0 && <IconButton variant="glass" label="清空最近播放" onClick={() => ui.confirm('清空最近播放', '确定清空播放历史吗？', clearRecent, { danger: true, confirmText: '清空' })}><Trash2 className="h-4 w-4" /></IconButton>}
                        </div>
                        {isLocal && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button onClick={addLocalFolder}><FolderPlus className="h-4 w-4" />添加文件夹</Button>
                                <Button onClick={pickAudioFiles}><FilePlus2 className="h-4 w-4" />添加文件</Button>
                                {localFolders.length > 0 && <Button onClick={() => rescanLocal()} disabled={scan.active}>{scan.active ? <Spinner /> : <RefreshCw className="h-4 w-4" />}重新扫描</Button>}
                            </div>
                        )}
                        {scan.active && isLocal && <div className="mt-3 truncate font-mono text-[11px] text-white/40">扫描中 {scan.done}/{scan.total || '…'} {scan.current ? `· ${scan.current.split(/[\\/]/).pop()}` : ''}</div>}
                        </div>
                    </div>
                </motion.aside>

                <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 30, delay: 0.04 }} className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="mb-3 flex items-center gap-3">
                        <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 backdrop-blur-xl focus-within:border-white/25">
                            <Search className="h-4 w-4 text-white/40" />
                            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={`在「${title}」中搜索`} className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/30" />
                        </div>
                    </div>
                    {remote.error && !tracks.length ? (
                        <EmptyState title="加载失败" desc={remote.error}><Button onClick={remote.reload}><RefreshCw className="h-4 w-4" />重试</Button></EmptyState>
                    ) : !tracks.length && (remote.loading || (isRemoteTarget(target) && !remote.page)) ? (
                        <div className="space-y-2">{Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
                    ) : !shown.length ? (
                        <EmptyState
                            title={filter ? '没有匹配的歌曲' : isLocal ? '还没有本地音乐' : '这里还是空的'}
                            desc={filter ? '换个关键词试试' : isLocal ? '添加音乐文件夹后会自动扫描歌曲、读取标签与封面。' : `在搜索结果或歌单里${isAndroid ? '长按' : '右键'}歌曲即可添加。`}
                        >
                            {isLocal && !filter && <Button variant="white" onClick={addLocalFolder}><FolderPlus className="h-4 w-4" />添加文件夹</Button>}
                        </EmptyState>
                    ) : (
                        <VirtualTrackList
                            tracks={shown}
                            className="mask-fade-y -mx-2 min-h-0 flex-1 px-2"
                            padding={8}
                            showIndex
                            showPlatform={target.kind === 'user'}
                            playlistId={playlist?.id}
                            onPlay={(_, index) => playList(shown, index)}
                            onEndReached={!filter ? remote.loadMore : undefined}
                            footer={<>{remote.loading && tracks.length ? <div className="flex justify-center py-4 text-white/40"><Spinner /></div> : null}<div className="h-16" /></>}
                        />
                    )}
                </motion.section>
            </div>
        </Shell>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <motion.div
            className="pointer-events-auto absolute inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
        >
            <div className="drag absolute inset-x-0 top-0 h-14 touch:hidden" />
            <IconButton variant="solid" label="返回" className={cx('absolute left-6 top-6 z-10')} onClick={ui.closeDetail}><ChevronLeft className="h-5 w-5" /></IconButton>
            {children}
            <MiniPlayer />
        </motion.div>
    );
}
