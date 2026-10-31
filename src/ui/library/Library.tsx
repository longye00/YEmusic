/**
 * 乐库布局（Folia 式首页）：可拖动的拼贴墙，中间夹着一张“书签”。
 * 书签跟着墙一起被拖动，可以收成书脊、整张收起（屏幕边上留一个“乐库”标签），登录在线平台也在书签里完成。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleHelp, Dices, FoldHorizontal, Link2, ListFilter, ListMusic, LocateFixed, Maximize2, Plus, Radio, RefreshCw, Sparkles, X } from 'lucide-react';
import type { AccountPlatform } from '@/store/accounts';
import { exitRadio, usePlayer } from '@/store/player';
import { setSetting, useSettings, type LibraryTab, type SeamLevel } from '@/store/settings';
import { ui, useUi } from '@/store/ui';
import { Button, EmptyState, Spinner, cx } from '../components/common';
import { useCompact, useWindowSize } from '../hooks';
import { ControlPill } from '../player/ControlPill';
import { NowPlayingButton } from '../home/NowPlayingButton';
import { openGuess, openLogin, registerSeamLogin } from './actions';
import { SEAM_WIDTHS, SeamBody, type SeamActions, type SeamVariant } from './seam/Seam';
import { AccountList, SeamMenu, type PopPlacement, type SeamMenuItem } from './seam/SeamPopovers';
import { TAB_NAMES, TabProbe, type TabData } from './tabs';
import { Wall, seamLineFor, wallCellFor, type WallHandle } from './Wall';

const NO_DATA: TabData = { cards: [], loading: true, reload: () => {} };

function setSeamLevel(next: SeamLevel) {
    const cur = useSettings.getState().librarySeam;
    if (next === cur) return;
    if (next === 'hidden') setSetting('librarySeamRestore', cur === 'spine' ? 'spine' : 'full');
    setSetting('librarySeam', next);
}

/** 弹出面板放在书签旁边空间更大的一侧，底边与触发按钮对齐 */
function placePop(kind: PopPlacement['kind'], anchor: HTMLElement): PopPlacement {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 窄屏（手机竖屏）上别让弹层占满整屏：至少给屏幕两侧各留 16px
    const width = Math.min(kind === 'account' ? 288 : 256, vw - 32);
    const r = anchor.getBoundingClientRect();
    const seam = (anchor.closest('.seam') as HTMLElement | null)?.getBoundingClientRect() ?? r;
    const roomRight = vw - seam.right;
    const side = roomRight >= width + 20 || roomRight >= seam.left ? 'right' : 'left';
    const raw = side === 'right' ? seam.right + 10 : seam.left - 10 - width;
    return {
        kind,
        width,
        side,
        left: Math.round(Math.max(8, Math.min(vw - width - 8, raw))),
        bottom: Math.round(Math.max(12, Math.min(vh - 160, vh - r.bottom))),
    };
}

function FilterBar({ value, onChange, onClose, tab }: { value: string; onChange: (v: string) => void; onClose: () => void; tab: LibraryTab }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="no-drag pointer-events-auto flex h-10 w-[300px] max-w-full items-center gap-2 rounded-full bg-[rgba(26,26,25,0.95)] px-4 shadow-[0_0_0_1px_rgb(247_244_238/.14),0_12px_32px_rgb(0_0_0/.34)] backdrop-blur-xl"
        >
            <ListFilter className="h-4 w-4 shrink-0 text-white/50" />
            <input
                autoFocus
                value={value}
                onChange={event => onChange(event.target.value)}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        onClose();
                    }
                }}
                placeholder={`过滤「${TAB_NAMES[tab]}」…`}
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/35"
            />
            <button type="button" title="关闭（Esc）" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
        </motion.div>
    );
}

export function Library() {
    const tab = useSettings(s => s.libraryTab);
    const level = useSettings(s => s.librarySeam);
    const overlay = useUi(s => Boolean(s.detail || s.searchOpen || s.playerOpen || s.settingsOpen || s.dialog || s.menu));
    const radio = usePlayer(s => s.radio);
    const hasCurrent = usePlayer(s => Boolean(s.current));
    const { w, h } = useWindowSize();
    const compact = useCompact();
    const cell = wallCellFor(w, h);
    const lineX = seamLineFor(w);
    const wallRef = useRef<WallHandle | null>(null);
    const reloadRef = useRef<() => void>(() => {});
    const [data, setData] = useState<TabData | null>(null);
    const [filter, setFilter] = useState('');
    const [filterOpen, setFilterOpen] = useState(false);
    const [loginPlatform, setLoginPlatform] = useState<AccountPlatform | null>(null);
    const [pop, setPop] = useState<PopPlacement | null>(null);

    const variant: SeamVariant = loginPlatform ? 'login' : level === 'spine' ? 'spine' : 'home';
    const seamWidth = !loginPlatform && level === 'hidden' ? 0 : SEAM_WIDTHS[variant];
    const bottomSafe = compact ? 8 + (hasCurrent ? 94 : 48) + 8 : 24 + (hasCurrent ? 72 : 48) + 8;

    // 窗口跨过 900px 时自动在“书脊 / 展开”之间切换（收起状态不动）
    const narrow = w < 900;
    const prevNarrow = useRef(narrow);
    useEffect(() => {
        if (prevNarrow.current === narrow) return;
        prevNarrow.current = narrow;
        if (useSettings.getState().librarySeam !== 'hidden') setSetting('librarySeam', narrow ? 'spine' : 'full');
    }, [narrow]);

    // 乐库可见时，“登录”在书签里进行
    useEffect(() => registerSeamLogin(p => {
        setPop(null);
        setLoginPlatform(p);
        const rect = wallRef.current?.seamRect();
        const center = rect ? rect.left + rect.width / 2 : -1;
        if (!rect || center < SEAM_WIDTHS.login / 2 + 14 || center > window.innerWidth - SEAM_WIDTHS.login / 2 - 14) {
            requestAnimationFrame(() => wallRef.current?.openHere(SEAM_WIDTHS.login));
        }
    }), []);

    useEffect(() => {
        setFilter('');
        setFilterOpen(false);
    }, [tab]);
    useEffect(() => setPop(null), [tab, variant]);

    useEffect(() => {
        if (overlay) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if ((event.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]')) return;
            if (event.key === '/') {
                event.preventDefault();
                setFilterOpen(true);
            } else if (event.key === 'Escape') {
                if (filter || filterOpen) {
                    setFilter('');
                    setFilterOpen(false);
                } else if (loginPlatform) setLoginPlatform(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [overlay, filter, filterOpen, loginPlatform]);

    const actions = useMemo<SeamActions>(() => ({
        recenter: () => wallRef.current?.recenter(),
        fold: () => {
            setPop(null);
            setSeamLevel('hidden');
        },
        expand: () => setSeamLevel('full'),
        toggleAccounts: anchor => setPop(cur => (cur?.kind === 'account' ? null : placePop('account', anchor))),
        toggleMore: anchor => setPop(cur => (cur?.kind === 'menu' ? null : placePop('menu', anchor))),
        closeLogin: () => setLoginPlatform(null),
        loginDone: () => setLoginPlatform(null),
    }), []);

    const d = data ?? NO_DATA;
    const q = filter.trim().toLowerCase();
    const cards = useMemo(() => (q ? d.cards.filter(c => !c.action && `${c.title} ${c.desc || ''}`.toLowerCase().includes(q)) : d.cards), [d.cards, q]);
    const seed = `${tab}:${q}:${cards.length}`;
    const status = d.loading ? '正在载入…' : d.notice;
    const closeFilter = () => {
        setFilter('');
        setFilterOpen(false);
    };

    const menuItems: SeamMenuItem[] = [
        { icon: <Plus />, label: '新建歌单', run: () => ui.dialog({ type: 'createPlaylist' }) },
        { icon: <Link2 />, label: '导入歌单链接', run: () => ui.dialog({ type: 'importPlaylist' }) },
        { icon: <Sparkles />, label: '猜我喜欢', run: openGuess },
        { icon: <ListFilter />, label: '过滤当前页', hint: '/', separated: true, run: () => setFilterOpen(true) },
        { icon: <LocateFixed />, label: '回到起点', hint: 'Home', run: () => wallRef.current?.recenter() },
        { icon: <Dices />, label: '随机漫游', run: () => wallRef.current?.shuffle() },
        { icon: <RefreshCw />, label: '刷新当前页', run: () => reloadRef.current() },
        { icon: <ListMusic />, label: '播放队列', separated: true, run: () => useUi.setState({ playerOpen: true, panelOpen: true, panelTab: 'queue', searchOpen: false }) },
        level === 'spine'
            ? { icon: <Maximize2 />, label: '展开书签', run: () => setSeamLevel('full') }
            : { icon: <FoldHorizontal />, label: '收成书脊', run: () => setSeamLevel('spine') },
        ...(radio ? [{ icon: <Radio />, label: `退出电台模式（${radio.name}）`, run: exitRadio }] : []),
        { icon: <CircleHelp />, label: '帮助与快捷键', separated: true, run: () => ui.openSettings('about') },
    ];

    // 播放胶囊：居中，但不压到右下角的“正在播放”按钮
    const pillRight = (hasCurrent ? w - 140 : w) - 12;
    const pillWidth = Math.max(280, Math.min(560, w - 2 * (hasCurrent ? 152 : 24)));
    const pillCenter = Math.min(w / 2, pillRight - pillWidth / 2);
    const rightOf = lineX + seamWidth / 2;

    return (
        <div className="absolute inset-0 overflow-hidden bg-[#070707]">
            <TabProbe key={tab} tab={tab} onData={setData} reloadRef={reloadRef} />
            {/* 窗口顶部的拖动区。必须渲染在书签之前：-webkit-app-region 按文档顺序叠加，
                书签（no-drag）排在后面才能把自己从拖动区里挖掉，书签顶部的按钮才点得到 */}
            <div className="drag absolute inset-x-0 top-0 z-[4] h-6" />
            <Wall
                cards={cards}
                seed={seed}
                cell={cell}
                keyboard={!overlay && !pop}
                finite={Boolean(q) || cards.length < 4}
                handle={wallRef}
                seamWidth={seamWidth}
                edgeLabel="乐库"
                onRestore={() => setSeamLevel(useSettings.getState().librarySeamRestore)}
                seam={<SeamBody variant={variant} tab={tab} loginPlatform={loginPlatform} actions={actions} pop={pop?.kind ?? null} bottomSafe={bottomSafe} paused={overlay} />}
            />

            {!cards.length && (
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 grid place-items-center px-8" style={{ left: rightOf }}>
                    <div className="pointer-events-auto">
                        {d.loading ? (
                            <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-[13px] text-white/60"><Spinner />正在载入{TAB_NAMES[tab]}…</div>
                        ) : d.error ? (
                            <EmptyState title={`${TAB_NAMES[tab]}加载失败`} desc={d.error}><Button onClick={d.reload}><RefreshCw className="h-4 w-4" />重试</Button></EmptyState>
                        ) : !q && d.empty ? (
                            <EmptyState title={d.empty.title} desc={d.empty.desc}>
                                {d.empty.actions?.map(action => (
                                    <Button key={action.label} variant={action.primary ? 'white' : 'glass'} onClick={action.run}>{action.icon}{action.label}</Button>
                                ))}
                            </EmptyState>
                        ) : (
                            <EmptyState title={q ? `没有匹配「${filter.trim()}」的内容` : '这里还是空的'} desc={q ? '换个关键词，或按 Esc 清除过滤' : undefined} />
                        )}
                    </div>
                </div>
            )}

            <div className="pointer-events-none absolute top-4 z-20 flex flex-col items-center gap-2 px-4" style={{ left: rightOf, right: 0 }}>
                <AnimatePresence>
                    {filterOpen && <FilterBar key="filter" value={filter} onChange={setFilter} onClose={closeFilter} tab={tab} />}
                </AnimatePresence>
                <AnimatePresence>
                    {cards.length > 0 && status && (
                        <motion.div
                            key={status}
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex max-w-[min(520px,100%)] items-center gap-2 rounded-full bg-black/70 px-3.5 py-1.5 text-[12px] text-white/70 shadow-[0_8px_30px_rgba(0,0,0,.4)]"
                        >
                            {d.loading && <Spinner className="h-3.5 w-3.5" />}
                            <span className="truncate">{status}</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <AnimatePresence>
                {pop?.kind === 'account' && <AccountList key="account" placement={pop} onClose={() => setPop(null)} onLogin={openLogin} />}
                {pop?.kind === 'menu' && <SeamMenu key="menu" placement={pop} items={menuItems} onClose={() => setPop(null)} />}
            </AnimatePresence>

            <footer className={cx('pointer-events-none absolute z-20 flex justify-center', compact ? 'inset-x-2 bottom-[calc(0.5rem+var(--safe-bottom))]' : 'bottom-6')} style={compact ? undefined : { left: pillCenter - pillWidth / 2, width: pillWidth }}>
                <ControlPill variant="home" maxWidth={pillWidth} />
            </footer>
            {!compact && <NowPlayingButton />}
        </div>
    );
}
