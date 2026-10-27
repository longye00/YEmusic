/** 右键菜单、对话框、提示条 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ClipboardPaste, Copy, Download, FolderOpen, Heart, Info, Link2, ListEnd, ListPlus, ListVideo, Play, Plus, Search, Trash2, XCircle } from 'lucide-react';
import { readClipboardText } from '@/lib/clipboard';
import { host, isAndroid } from '@/lib/host';
import { formatSize, formatTime } from '@/lib/util';
import { fetchOnlinePlaylist, parseInput, resolveInput } from '@/player/importPlaylist';
import { PLATFORM_NAMES, PLATFORMS, QUALITY_NAMES, type Platform } from '@/sdk/types';
import { downloadTrack } from '@/store/downloads';
import { addToPlaylist, createPlaylist, FAVORITES_ID, getPlaylist, LOCAL_ID, removeFromPlaylist, renamePlaylist, saveOnlinePlaylist, toggleFavorite, upsertTracks, useLibrary } from '@/store/library';
import { addToQueue, playNext, playTrack } from '@/store/player';
import { toast, useToasts } from '@/store/toast';
import { ui, useUi } from '@/store/ui';
import { Button, Cover, Modal, PlatformTag, Spinner, cx } from './components/common';
import { LoginDialog } from './library/LoginDialog';

// ---------------- 右键菜单 ----------------
function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
    return (
        <button type="button" onClick={onClick} className={cx('flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] transition-colors', danger ? 'text-red-300 hover:bg-red-500/15' : 'text-white/85 hover:bg-white/10 hover:text-white')}>
            <span className="text-white/55 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
            {children}
        </button>
    );
}

export function ContextMenu() {
    const menu = useUi(s => s.menu);
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const favorites = useLibrary(s => s.playlists.find(p => p.id === FAVORITES_ID)?.trackIds);
    useLayoutEffect(() => {
        if (!menu || !ref.current) return;
        const { offsetWidth: w, offsetHeight: h } = ref.current;
        setPos({ x: Math.min(menu.x, window.innerWidth - w - 8), y: Math.min(menu.y, window.innerHeight - h - 8) });
    }, [menu]);
    useEffect(() => {
        if (!menu) return;
        const close = () => ui.menu(null);
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
        window.addEventListener('pointerdown', close);
        window.addEventListener('blur', close);
        window.addEventListener('keydown', onKey);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('blur', close);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', close);
        };
    }, [menu]);
    if (!menu) return null;
    const { track, list, playlistId } = menu;
    const liked = Boolean(favorites?.includes(track.id));
    const playlist = playlistId ? getPlaylist(playlistId) : undefined;
    const run = (fn: () => void) => () => {
        ui.menu(null);
        fn();
    };
    return (
        <div ref={ref} onPointerDown={event => event.stopPropagation()} className="fixed z-[90] w-56 rounded-2xl border border-white/10 bg-[rgba(29,27,38,0.95)] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,.55)] backdrop-blur-2xl" style={{ left: pos.x, top: pos.y }}>
            <div className="mb-1 truncate px-3 pb-1.5 pt-1 text-[12px] text-white/40">{track.name} · {track.singer}</div>
            <MenuItem icon={<Play />} onClick={run(() => playTrack(track, list))}>播放</MenuItem>
            <MenuItem icon={<ListEnd />} onClick={run(() => playNext(track))}>下一首播放</MenuItem>
            <MenuItem icon={<ListVideo />} onClick={run(() => addToQueue([track]))}>添加到播放队列</MenuItem>
            <MenuItem icon={<ListPlus />} onClick={run(() => ui.dialog({ type: 'addToPlaylist', tracks: [track] }))}>添加到歌单…</MenuItem>
            <MenuItem icon={<Heart />} onClick={run(() => toggleFavorite(track))}>{liked ? '取消喜欢' : '喜欢'}</MenuItem>
            <div className="mx-2 my-1 h-px bg-white/[0.08]" />
            {track.source !== 'local' && <MenuItem icon={<Download />} onClick={run(() => downloadTrack(track))}>下载</MenuItem>}
            {track.source === 'local' && track.path && !isAndroid && <MenuItem icon={<FolderOpen />} onClick={run(() => host.showItemInFolder(track.path!))}>在文件夹中显示</MenuItem>}
            <MenuItem icon={<Search />} onClick={run(() => ui.openSearch(track.singer))}>搜索歌手</MenuItem>
            <MenuItem icon={<Copy />} onClick={run(() => { void navigator.clipboard.writeText(`${track.name} - ${track.singer}`); toast('已复制歌曲信息', 'success'); })}>复制歌名</MenuItem>
            <MenuItem icon={<Info />} onClick={run(() => ui.dialog({ type: 'trackInfo', track }))}>歌曲信息</MenuItem>
            {playlist && playlist.id !== LOCAL_ID && (
                <>
                    <div className="mx-2 my-1 h-px bg-white/[0.08]" />
                    <MenuItem danger icon={<Trash2 />} onClick={run(() => removeFromPlaylist(playlist.id, [track.id]))}>从「{playlist.name}」移除</MenuItem>
                </>
            )}
        </div>
    );
}

// ---------------- 对话框 ----------------
function TextInput({ value, onChange, placeholder, autoFocus, onEnter }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
    return (
        <input
            value={value}
            autoFocus={autoFocus}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onEnter?.(); }}
            placeholder={placeholder}
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-[14px] outline-none transition-colors placeholder:text-white/30 focus:border-white/30"
        />
    );
}

function NameDialog({ title, initial, confirmText, onSubmit, onClose }: { title: string; initial: string; confirmText: string; onSubmit: (name: string) => void; onClose: () => void }) {
    const [name, setName] = useState(initial);
    const submit = () => {
        if (!name.trim()) return;
        onSubmit(name.trim());
        onClose();
    };
    return (
        <Modal open onClose={onClose} title={title}>
            <div className="space-y-5 px-7 pb-7 pt-3">
                <TextInput value={name} onChange={setName} placeholder="歌单名称" autoFocus onEnter={submit} />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>取消</Button>
                    <Button variant="white" onClick={submit} disabled={!name.trim()}>{confirmText}</Button>
                </div>
            </div>
        </Modal>
    );
}

function AddToPlaylistDialog({ tracks, onClose }: { tracks: import('@/sdk/types').Track[]; onClose: () => void }) {
    // 注意：选择器必须返回稳定引用，否则 zustand + React 19 会无限重渲染（原先点击即黑屏）
    const allPlaylists = useLibrary(s => s.playlists);
    const playlists = useMemo(() => allPlaylists.filter(p => p.kind !== 'local'), [allPlaylists]);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const add = (id: string) => {
        upsertTracks(tracks);
        addToPlaylist(id, tracks.map(t => t.id));
        onClose();
    };
    return (
        <Modal open onClose={onClose} title={`添加到歌单${tracks.length > 1 ? `（${tracks.length} 首）` : ''}`}>
            <div className="scroll-thin max-h-[52vh] space-y-1 overflow-y-auto px-5 pb-3 pt-2">
                {playlists.map(p => (
                    <button key={p.id} type="button" onClick={() => add(p.id)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-white/[0.07]">
                        <PlaylistThumb id={p.id} />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-semibold">{p.name}</div>
                            <div className="font-mono text-[11px] text-white/40">{p.trackIds.length} 首</div>
                        </div>
                    </button>
                ))}
            </div>
            <div className="border-t border-white/[0.07] px-7 py-5">
                {creating ? (
                    <div className="flex gap-2">
                        <TextInput value={name} onChange={setName} placeholder="新歌单名称" autoFocus onEnter={() => { if (name.trim()) add(createPlaylist(name).id); }} />
                        <Button variant="white" className="h-11" disabled={!name.trim()} onClick={() => add(createPlaylist(name).id)}>创建并添加</Button>
                    </div>
                ) : (
                    <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />新建歌单</Button>
                )}
            </div>
        </Modal>
    );
}

export function PlaylistThumb({ id, className = 'h-11 w-11' }: { id: string; className?: string }) {
    const cover = useLibrary(s => {
        const p = s.playlists.find(x => x.id === id);
        if (!p) return undefined;
        if (p.cover) return p.cover;
        const withCover = p.trackIds.find(t => s.tracks[t]?.cover);
        return withCover ? s.tracks[withCover].cover : undefined;
    });
    const name = useLibrary(s => s.playlists.find(x => x.id === id)?.name || '');
    if (id === FAVORITES_ID) {
        return <div className={cx('grid shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#fb7185,#c026d3)]', className)}><Heart className="h-1/2 w-1/2 text-white" fill="currentColor" /></div>;
    }
    return <Cover src={cover} size={64} seed={name} className={cx('shrink-0', className)} rounded="rounded-xl" />;
}

/** 链接输入框：可粘贴整段分享文字，旁边带“粘贴”按钮，下面实时提示识别结果 */
function LinkField({ value, onChange, fallback, placeholder, autoFocus, onSubmit, failed }: { value: string; onChange: (v: string) => void; fallback: Platform; placeholder: string; autoFocus?: boolean; onSubmit?: () => void; failed?: boolean }) {
    const parsed = useMemo(() => parseInput(value, fallback), [value, fallback]);
    const [pasteNote, setPasteNote] = useState('');
    const paste = async () => {
        try {
            const text = await readClipboardText();
            if (!text.trim()) { setPasteNote('剪贴板里没有文字'); return; }
            onChange(text);
            setPasteNote('');
        } catch {
            setPasteNote('无法直接读取剪贴板，请长按输入框选择「粘贴」');
        }
    };
    let hint = '';
    let tone = 'text-white/45';
    if (pasteNote) { hint = pasteNote; tone = 'text-amber-300'; }
    else if (value.trim()) {
        if (parsed.ref) { hint = `识别到：${PLATFORM_NAMES[parsed.ref.platform]} · 歌单 ${parsed.ref.id}`; tone = 'text-emerald-300'; }
        else if (parsed.pending.length) hint = '识别到分享短链接，导入时会自动解析';
        else if (parsed.error) { hint = parsed.error; tone = failed ? 'text-red-300' : 'text-amber-300'; }
    }
    return (
        <div className="space-y-1.5">
            <div className="relative">
                <textarea
                    value={value}
                    autoFocus={autoFocus}
                    rows={3}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={event => onChange(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit?.(); } }}
                    placeholder={placeholder}
                    className="scroll-thin block w-full resize-none rounded-2xl border border-white/10 bg-black/30 py-3 pl-4 pr-16 text-[14px] leading-snug outline-none transition-colors placeholder:text-white/30 focus:border-white/30"
                />
                <button type="button" onClick={paste} className="no-drag absolute right-2 top-2 inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2.5 text-[12px] font-medium text-white/80 active:bg-white/20">
                    <ClipboardPaste className="h-3.5 w-3.5" />粘贴
                </button>
            </div>
            <p className={cx('min-h-[18px] break-words text-[12px] leading-snug', tone)}>{hint}</p>
        </div>
    );
}

function PlatformChips({ value, active, onChange }: { value: Platform; active?: Platform; onChange: (p: Platform) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {PLATFORMS.map(p => (
                <button key={p} type="button" onClick={() => onChange(p)} className={cx('h-7 rounded-full px-3 text-[12px] font-medium transition-colors', (active || value) === p ? 'bg-white text-black' : 'bg-white/[0.08] text-white/70')}>{PLATFORM_NAMES[p]}</button>
            ))}
        </div>
    );
}

function CheckBox({ on }: { on: boolean }) {
    return <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors', on ? 'border-white bg-white text-black' : 'border-white/30 text-transparent')}><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>;
}

/** 新建歌单：可顺便把已有歌单 / 在线歌单链接里的歌曲导进来 */
function CreatePlaylistDialog({ trackIds, onClose }: { trackIds?: string[]; onClose: () => void }) {
    // 选择器必须返回稳定引用（见 AddToPlaylistDialog 的说明）
    const allPlaylists = useLibrary(s => s.playlists);
    const sources = useMemo(() => allPlaylists.filter(p => p.kind !== 'local' && p.trackIds.length > 0), [allPlaylists]);
    const [name, setName] = useState('');
    const [picked, setPicked] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const [link, setLink] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const pickedCount = useMemo(() => new Set(picked.flatMap(id => allPlaylists.find(p => p.id === id)?.trackIds || [])).size, [picked, allPlaylists]);
    const importing = picked.length > 0 || link.trim().length > 0;
    const canSubmit = !busy && (name.trim().length > 0 || importing);
    const toggle = (id: string) => setPicked(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]));

    const submit = async () => {
        if (!canSubmit) return;
        setError('');
        const ids: string[] = [...(trackIds || [])];
        for (const id of picked) ids.push(...(getPlaylist(id)?.trackIds || []));
        let importedName = '';
        if (link.trim()) {
            try {
                setBusy('正在识别链接…');
                const ref = await resolveInput(link, 'wy');
                setBusy('正在读取歌单…');
                const online = await fetchOnlinePlaylist(ref, count => setBusy(`正在读取歌单（${count} 首）…`));
                upsertTracks(online.list);
                ids.push(...online.list.map(t => t.id));
                importedName = online.name;
            } catch (e) {
                setError((e as Error).message);
                setBusy('');
                return;
            }
        }
        const pickedName = picked.length === 1 ? getPlaylist(picked[0])?.name || '' : '';
        const created = createPlaylist(name.trim() || importedName || pickedName || '新建歌单', ids);
        toast(created.trackIds.length ? `已创建「${created.name}」，共 ${created.trackIds.length} 首` : `已创建「${created.name}」`, 'success');
        onClose();
        if (importing) ui.openDetail({ kind: 'user', id: created.id });
    };

    return (
        <Modal open onClose={onClose} title="新建歌单">
            <div className="scroll-thin max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto px-7 pb-7 pt-3">
                <TextInput value={name} onChange={setName} placeholder={importing ? '歌单名称（留空则沿用导入歌单的名称）' : '歌单名称'} autoFocus={!isAndroid} onEnter={submit} />
                {sources.length > 0 && (
                    <div>
                        <button type="button" onClick={() => setOpen(o => !o)} className="no-drag flex w-full items-center gap-2 text-left text-[13px] font-semibold text-white/75">
                            <ListPlus className="h-4 w-4 text-white/50" />
                            <span className="flex-1">从我的歌单导入歌曲</span>
                            <span className="text-[12px] font-normal text-white/40">{picked.length ? `已选 ${picked.length} 个 · ${pickedCount} 首` : '可选'}</span>
                            <ChevronDown className={cx('h-4 w-4 text-white/40 transition-transform', open && 'rotate-180')} />
                        </button>
                        {open && (
                            <div className="scroll-thin mt-2 max-h-[30vh] space-y-0.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-1.5">
                                {sources.map(p => (
                                    <button key={p.id} type="button" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)} className="no-drag flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left active:bg-white/10">
                                        <PlaylistThumb id={p.id} className="h-10 w-10" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-[13.5px] font-semibold">{p.name}</div>
                                            <div className="font-mono text-[11px] text-white/40">{p.trackIds.length} 首</div>
                                        </div>
                                        <CheckBox on={picked.includes(p.id)} />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div>
                    <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-white/75"><Link2 className="h-4 w-4 text-white/50" />导入在线歌单<span className="text-[12px] font-normal text-white/40">可选 · 粘贴分享链接</span></div>
                    <LinkField value={link} onChange={v => { setLink(v); setError(''); }} fallback="wy" placeholder="网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕的歌单分享链接（可直接粘贴整段分享文字）" onSubmit={submit} failed={Boolean(error)} />
                </div>
                {error && <p className="break-words rounded-xl bg-red-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-red-300">{error}</p>}
                <div className="flex items-center justify-end gap-2">
                    {busy && <span className="mr-auto flex items-center gap-2 text-[12px] text-white/50"><Spinner />{busy}</span>}
                    <Button variant="ghost" onClick={onClose}>取消</Button>
                    <Button variant="white" onClick={submit} disabled={!canSubmit}>{busy && <Spinner />}创建{importing ? '并导入' : ''}</Button>
                </div>
            </div>
        </Modal>
    );
}

/** 导入在线歌单：保存为可刷新的独立歌单，或并入已有歌单 */
function ImportPlaylistDialog({ onClose }: { onClose: () => void }) {
    const [platform, setPlatform] = useState<Platform>('wy');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [target, setTarget] = useState('');
    const allPlaylists = useLibrary(s => s.playlists);
    const targets = useMemo(() => allPlaylists.filter(p => p.kind === 'user' || p.kind === 'favorites'), [allPlaylists]);
    const parsed = useMemo(() => parseInput(text, platform), [text, platform]);

    const submit = async () => {
        if (busy || !text.trim()) return;
        setError('');
        try {
            setBusy('正在识别链接…');
            const ref = await resolveInput(text, platform);
            setBusy('正在读取歌单…');
            const online = await fetchOnlinePlaylist(ref, count => setBusy(`正在读取歌单（${count} 首）…`));
            if (target && getPlaylist(target)) {
                upsertTracks(online.list);
                const added = addToPlaylist(target, online.list.map(t => t.id), { silent: true });
                const targetName = getPlaylist(target)?.name || '歌单';
                toast(added ? `已把「${online.name}」里的 ${added} 首歌加入「${targetName}」` : `「${online.name}」里的歌都已在「${targetName}」里`, added ? 'success' : 'info');
                onClose();
                ui.openDetail({ kind: 'user', id: target });
            } else {
                const saved = saveOnlinePlaylist({ name: online.name, cover: online.cover, desc: online.desc, platform: ref.platform, id: ref.id, type: 'songlist' }, online.list);
                toast(`已导入「${saved.name}」共 ${online.list.length} 首`, 'success');
                onClose();
                ui.openDetail({ kind: 'user', id: saved.id });
            }
        } catch (e) {
            setError((e as Error).message || '导入失败');
            setBusy('');
        }
    };

    return (
        <Modal open onClose={onClose} title="导入在线歌单">
            <div className="scroll-thin max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto px-7 pb-7 pt-3">
                <p className="text-[13px] leading-relaxed text-white/50">在 QQ音乐 / 网易云 / 酷狗 / 酷我 / 咪咕 里把歌单「分享 → 复制链接」，回到这里粘贴整段文字即可（短链接也行），也可以只输入歌单 ID。</p>
                <LinkField value={text} onChange={v => { setText(v); setError(''); }} fallback={platform} placeholder="例如 https://music.163.com/playlist?id=3778678" autoFocus={!isAndroid} onSubmit={submit} failed={Boolean(error)} />
                <div className="space-y-1.5">
                    <div className="text-[12px] text-white/40">只输入歌单 ID 时，请选择它属于哪个平台</div>
                    <PlatformChips value={platform} active={parsed.ref?.platform} onChange={setPlatform} />
                </div>
                {targets.length > 0 && (
                    <label className="flex items-center gap-3 text-[13px]">
                        <span className="shrink-0 font-semibold text-white/75">导入到</span>
                        <select value={target} onChange={event => setTarget(event.target.value)} className="no-drag h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#17161f] px-3 text-[13px] text-white/85 outline-none focus:border-white/30">
                            <option value="">新歌单（保留来源，可刷新）</option>
                            {targets.map(p => <option key={p.id} value={p.id}>并入「{p.name}」</option>)}
                        </select>
                    </label>
                )}
                {error && <p className="break-words rounded-xl bg-red-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-red-300">{error}</p>}
                <div className="flex items-center justify-end gap-2">
                    {busy && <span className="mr-auto flex items-center gap-2 text-[12px] text-white/50"><Spinner />{busy}</span>}
                    <Button variant="ghost" onClick={onClose}>取消</Button>
                    <Button variant="white" onClick={submit} disabled={!text.trim() || Boolean(busy)}>{busy && <Spinner />}导入</Button>
                </div>
            </div>
        </Modal>
    );
}

function TrackInfoDialog({ track, onClose }: { track: import('@/sdk/types').Track; onClose: () => void }) {
    const rows: [string, ReactNode][] = [
        ['歌手', track.singer],
        ['专辑', track.album || '—'],
        ['时长', track.duration ? formatTime(track.duration) : '—'],
        ['来源', track.source === 'local' ? '本地文件' : PLATFORM_NAMES[track.source]],
    ];
    if (track.source !== 'local') {
        rows.push(['歌曲 ID', <span className="font-mono">{track.songmid}</span>]);
        if (track.qualities?.length) rows.push(['可用音质', track.qualities.map(q => `${QUALITY_NAMES[q.type]}${q.size ? ` (${q.size})` : ''}`).join('、')]);
    } else {
        rows.push(['格式', [track.codec, track.bitrate ? `${track.bitrate} kbps` : '', track.lossless ? '无损' : ''].filter(Boolean).join(' · ') || '—']);
        if (track.fileSize) rows.push(['大小', formatSize(track.fileSize)]);
        rows.push(['路径', <span className="break-all font-mono text-[11px]">{track.path}</span>]);
    }
    return (
        <Modal open onClose={onClose} title="歌曲信息">
            <div className="px-7 pb-7 pt-2">
                <div className="mb-5 flex items-center gap-4">
                    <Cover src={track.cover} size={80} seed={track.name} className="h-20 w-20" rounded="rounded-2xl" />
                    <div className="min-w-0">
                        <div className="text-[18px] font-bold leading-tight">{track.name}</div>
                        <div className="mt-2"><PlatformTag source={track.source} /></div>
                    </div>
                </div>
                <div className="space-y-2.5">
                    {rows.map(([k, v]) => (
                        <div key={k} className="flex gap-4 text-[13px]">
                            <span className="w-16 shrink-0 text-white/40">{k}</span>
                            <span className="min-w-0 flex-1 text-white/85">{v}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

export function Dialogs() {
    const dialog = useUi(s => s.dialog);
    const close = () => ui.dialog(null);
    if (!dialog) return null;
    switch (dialog.type) {
        case 'createPlaylist':
            return <CreatePlaylistDialog trackIds={dialog.trackIds} onClose={close} />;
        case 'renamePlaylist':
            return <NameDialog title="重命名歌单" initial={dialog.name} confirmText="保存" onClose={close} onSubmit={name => renamePlaylist(dialog.id, name)} />;
        case 'addToPlaylist':
            return <AddToPlaylistDialog tracks={dialog.tracks} onClose={close} />;
        case 'importPlaylist':
            return <ImportPlaylistDialog onClose={close} />;
        case 'trackInfo':
            return <TrackInfoDialog track={dialog.track} onClose={close} />;
        case 'login':
            return <LoginDialog platform={dialog.platform} onClose={close} />;
        case 'confirm':
            return (
                <Modal open onClose={close} title={dialog.title}>
                    <div className="space-y-6 px-7 pb-7 pt-2">
                        <p className="text-[14px] leading-relaxed text-white/65">{dialog.message}</p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={close}>取消</Button>
                            <Button variant={dialog.danger ? 'danger' : 'white'} onClick={() => { close(); dialog.onConfirm(); }}>{dialog.confirmText || '确定'}</Button>
                        </div>
                    </div>
                </Modal>
            );
    }
}

// ---------------- 提示条 ----------------
export function Toasts() {
    const toasts = useToasts(s => s.toasts);
    const dismiss = useToasts(s => s.dismiss);
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[100] flex flex-col items-center gap-2 px-6">
            <AnimatePresence initial={false}>
                {toasts.map(t => (
                    <motion.div
                        key={t.key || t.id}
                        layout
                        initial={{ opacity: 0, y: 16, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        className="pointer-events-auto flex max-w-[640px] items-center gap-2.5 rounded-full border border-white/10 bg-[rgba(28,27,36,0.9)] py-2 pl-3 pr-4 text-[13px] text-white/90 shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-2xl"
                        onClick={() => dismiss(t.id)}
                    >
                        {t.kind === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" /> : t.kind === 'error' ? <XCircle className="h-4 w-4 shrink-0 text-red-300" /> : t.kind === 'warning' ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" /> : <Info className="h-4 w-4 shrink-0 text-sky-300" />}
                        <span className="line-clamp-2">{t.message}</span>
                        {t.action && (
                            <button type="button" className="ml-1 shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] font-medium hover:bg-white/20" onClick={event => { event.stopPropagation(); t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
                        )}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
