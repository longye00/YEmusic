/** 全屏搜索：平台切换、热搜、搜索历史、分页加载 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Flame, Search, Trash2, X } from 'lucide-react';
import { sdks } from '@/sdk';
import { PLATFORM_NAMES, PLATFORMS, type Platform, type Track } from '@/sdk/types';
import { useLibrary } from '@/store/library';
import { playTrack } from '@/store/player';
import { setSetting, useSettings } from '@/store/settings';
import { ui, useUi } from '@/store/ui';
import { Chip, EmptyState, IconButton, Spinner } from '../components/common';
import { VirtualTrackList } from '../components/TrackList';
import { MiniPlayer } from '../player/MiniPlayer';

type SearchSource = Platform | 'local';
const HISTORY_KEY = 'ye.searchHistory';

function readHistory(): string[] {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
        return [];
    }
}

interface ResultState { key: string; list: Track[]; total: number; page: number; loading: boolean; error?: string }

export function SearchOverlay() {
    const query = useUi(s => s.searchQuery);
    const savedPlatform = useSettings(s => s.searchPlatform);
    const [source, setSource] = useState<SearchSource>(savedPlatform);
    const [text, setText] = useState(query);
    const [submitted, setSubmitted] = useState(query.trim());
    const [history, setHistory] = useState(readHistory);
    const [hot, setHot] = useState<string[]>([]);
    const [result, setResult] = useState<ResultState>({ key: '', list: [], total: 0, page: 0, loading: false });
    const inputRef = useRef<HTMLInputElement>(null);
    const tracks = useLibrary(s => s.tracks);
    const seq = useRef(0);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setSubmitted(text.trim()), 450);
        return () => clearTimeout(timer);
    }, [text]);

    useEffect(() => {
        if (source === 'local') return;
        let alive = true;
        setHot([]);
        sdks[source].hotSearch?.().then(list => { if (alive) setHot(list.slice(0, 16)); }).catch(() => {});
        return () => { alive = false; };
    }, [source]);

    const localResults = useMemo(() => {
        if (source !== 'local' || !submitted) return [];
        const q = submitted.toLowerCase();
        return Object.values(tracks).filter(t => `${t.name} ${t.singer} ${t.album}`.toLowerCase().includes(q)).slice(0, 500);
    }, [source, submitted, tracks]);

    const run = async (keyword: string, platform: Platform, page: number) => {
        const id = ++seq.current;
        const key = `${platform}:${keyword}`;
        setResult(r => ({ ...(page === 1 ? { list: [], total: 0, page: 0 } : r), key, loading: true, error: undefined }));
        try {
            const res = await sdks[platform].search(keyword, page, 30);
            if (id !== seq.current) return;
            setResult(r => {
                const base = page === 1 ? [] : r.list;
                const seen = new Set(base.map(t => t.id));
                return { key, list: [...base, ...res.list.filter(t => !seen.has(t.id))], total: res.total, page, loading: false };
            });
        } catch (error) {
            if (id !== seq.current) return;
            setResult(r => ({ ...r, key, loading: false, error: (error as Error).message || '搜索失败' }));
        }
    };

    useEffect(() => {
        if (!submitted || source === 'local') return;
        void run(submitted, source, 1);
        const next = [submitted, ...readHistory().filter(h => h !== submitted)].slice(0, 20);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        setHistory(next);
    }, [submitted, source]); // eslint-disable-line react-hooks/exhaustive-deps

    const pickSource = (s: SearchSource) => {
        setSource(s);
        if (s !== 'local') setSetting('searchPlatform', s);
    };

    const list = source === 'local' ? localResults : result.key === `${source}:${submitted}` ? result.list : [];
    const loading = source !== 'local' && result.loading;
    const hasMore = source !== 'local' && result.list.length < result.total && result.page > 0;

    return (
        <motion.div className="absolute inset-0 z-50 flex flex-col bg-[rgba(9,9,13,0.88)] backdrop-blur-2xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="drag absolute inset-x-0 top-0 h-10 touch:hidden" />
            <motion.div className="mx-auto flex w-full max-w-[1080px] min-h-0 flex-1 flex-col px-8 pt-12 max-sm:px-4 max-sm:pt-4" initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
                <div className="flex items-center gap-3">
                    <div className="flex h-12 flex-1 items-center gap-3 rounded-[18px] border border-white/[0.14] bg-white/[0.04] px-4 focus-within:border-white/30">
                        <Search className="h-[18px] w-[18px] text-white/50" />
                        <input
                            ref={inputRef}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') setSubmitted(text.trim());
                            }}
                            placeholder="搜索歌曲、歌手、专辑"
                            className="h-full flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-white/30"
                        />
                        {text && <button type="button" onClick={() => { setText(''); inputRef.current?.focus(); }} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>}
                    </div>
                    <IconButton variant="glass" size="lg" label="关闭搜索 (Esc)" onClick={ui.closeSearch}><X className="h-5 w-5" /></IconButton>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    {PLATFORMS.map(p => <Chip key={p} active={source === p} onClick={() => pickSource(p)}>{PLATFORM_NAMES[p]}</Chip>)}
                    <Chip active={source === 'local'} onClick={() => pickSource('local')}>本地 / 曲库</Chip>
                </div>

                <div className="mt-5 flex min-h-0 flex-1 flex-col">
                    {!submitted ? (
                        <div className="scroll-thin space-y-8 overflow-y-auto pb-10">
                            {history.length > 0 && (
                                <section>
                                    <div className="mb-3 flex items-center justify-between">
                                        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-white/60"><Clock className="h-4 w-4" />搜索历史</h3>
                                        <button type="button" onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }} className="flex items-center gap-1 text-[12px] text-white/35 hover:text-white/70"><Trash2 className="h-3.5 w-3.5" />清空</button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">{history.map(h => <Chip key={h} onClick={() => { setText(h); setSubmitted(h); }}>{h}</Chip>)}</div>
                                </section>
                            )}
                            {hot.length > 0 && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white/60"><Flame className="h-4 w-4" />{PLATFORM_NAMES[source as Platform]}热搜</h3>
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-4">
                                        {hot.map((h, i) => (
                                            <button key={h} type="button" onClick={() => { setText(h); setSubmitted(h); }} className="flex items-center gap-3 rounded-xl px-2 py-2 text-left text-[13px] text-white/75 hover:bg-white/[0.06] hover:text-white">
                                                <span className={`w-5 font-mono text-[12px] ${i < 3 ? 'text-rose-300' : 'text-white/30'}`}>{i + 1}</span>
                                                <span className="truncate">{h}</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            )}
                            {!history.length && !hot.length && <EmptyState icon={<Search className="h-8 w-8" />} title="想听点什么？" desc="输入歌名、歌手或专辑，按回车搜索。可在上方切换平台；“本地 / 曲库”会搜索已导入和收藏过的歌曲。" />}
                        </div>
                    ) : result.error && source !== 'local' && !list.length ? (
                        <EmptyState title="搜索失败" desc={result.error}><Chip onClick={() => run(submitted, source as Platform, 1)}>重试</Chip></EmptyState>
                    ) : !list.length && loading ? (
                        <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
                    ) : !list.length ? (
                        <EmptyState title="没有找到结果" desc={source === 'local' ? '曲库中没有匹配的歌曲，试试在线平台。' : '换个关键词或切换到其他平台试试。'} />
                    ) : (
                        <VirtualTrackList
                            tracks={list}
                            className="-mx-2 min-h-0 flex-1 px-2"
                            showPlatform={source === 'local'}
                            onPlay={track => playTrack(track)}
                            onEndReached={() => { if (hasMore && !loading) void run(submitted, source as Platform, result.page + 1); }}
                            footer={
                                <div className="flex flex-col items-center py-5">
                                    {loading ? <Spinner className="h-5 w-5 text-white/50" /> : hasMore ? (
                                        <button type="button" onClick={() => run(submitted, source as Platform, result.page + 1)} className="h-10 rounded-full border border-white/15 bg-white/[0.04] px-6 text-[13px] font-medium text-white/85 hover:bg-white/[0.1]">加载更多</button>
                                    ) : <span className="font-mono text-[11px] text-white/25">共 {list.length} 首</span>}
                                    <div className="h-24 max-sm:h-[86px]" />
                                </div>
                            }
                        />
                    )}
                </div>
            </motion.div>
            <MiniPlayer />
        </motion.div>
    );
}
