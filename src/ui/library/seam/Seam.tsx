/**
 * 乐库书签里的内容：首页窄条（120）/ 书脊（64）/ 登录面板（300）。
 * 换内容时整张书签绕 Y 轴翻一页；首页窄条按窗口高度逐级收紧（去标题 → 紧凑 → 单字标签 → 藏快捷入口）。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc3, Ellipsis, FoldHorizontal, Folder, Maximize2, Mic2, PanelsTopLeft, Search, Settings } from 'lucide-react';
import { useLite } from '@/lib/lite';
import { PLATFORM_NAMES, PLATFORMS, type Platform } from '@/sdk/types';
import { ACCOUNT_META, useAccounts, type AccountPlatform } from '@/store/accounts';
import { usePlayer } from '@/store/player';
import { setSetting, useSettings, type LibraryTab, type LocalGroup } from '@/store/settings';
import { ui } from '@/store/ui';
import { PlayingBars, cx } from '../../components/common';
import { useWindowSize } from '../../hooks';
import { FM_ID, openDaily, openGuess, startFm } from '../actions';
import { LoginPanel, PlatformBadge } from '../LoginPanel';
import { TAB_NAMES } from '../tabs';
import { SeamCubes } from './SeamCubes';

export type SeamVariant = 'home' | 'spine' | 'login';
export const SEAM_WIDTHS: Record<SeamVariant, number> = { home: 120, spine: 64, login: 300 };

export const LIBRARY_TABS: LibraryTab[] = ['playlists', 'radio', 'albums', 'local', 'plaza', 'boards'];
const TAB_SHORT: Record<LibraryTab, string> = { playlists: '歌', radio: '台', albums: '专', local: '本', plaza: '广', boards: '榜' };
const PLATFORM_SHORT: Record<Platform, string> = { tx: 'QQ', wy: '网易', kg: '酷狗', kw: '酷我', mg: '咪咕' };
const LOCAL_GROUPS: [LocalGroup, string, ReactNode][] = [['albums', '按专辑', <Disc3 key="a" />], ['artists', '按歌手', <Mic2 key="b" />], ['folders', '按文件夹', <Folder key="c" />]];

export interface SeamActions {
    recenter: () => void;
    /** 收起书签（只留屏幕边上的标签） */
    fold: () => void;
    /** 书脊 → 展开 */
    expand: () => void;
    toggleAccounts: (anchor: HTMLElement) => void;
    toggleMore: (anchor: HTMLElement) => void;
    closeLogin: () => void;
    loginDone: () => void;
}

export interface SeamBodyProps {
    variant: SeamVariant;
    tab: LibraryTab;
    loginPlatform: AccountPlatform | null;
    actions: SeamActions;
    pop: 'account' | 'menu' | null;
    /** 底部留给播放胶囊的高度 */
    bottomSafe: number;
    /** 被其它界面盖住时暂停装饰动画 */
    paused: boolean;
}

/** 书签内容：按变体翻页切换 */
export function SeamBody(props: SeamBodyProps) {
    const { variant, loginPlatform, actions } = props;
    const reduce = useSettings(s => s.reduceMotion);
    const lite = useLite();
    const width = SEAM_WIDTHS[variant];
    const key = variant === 'login' ? `login:${loginPlatform}` : variant;
    // 精简模式：只淡入淡出，不做 3D 翻页
    const fade = reduce ? 0 : 0.12;
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={key}
                className="seam-content"
                style={{ width, marginLeft: -width / 2 }}
                initial={lite ? { opacity: 0 } : { rotateY: -90, opacity: 0 }}
                animate={lite ? { opacity: 1, transition: { duration: fade } } : { rotateY: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.24, ease: [0.2, 0.7, 0.25, 1] } }}
                exit={lite ? { opacity: 0, transition: { duration: fade } } : { rotateY: 90, opacity: 0, transition: { duration: reduce ? 0 : 0.16, ease: [0.4, 0, 1, 1] } }}
            >
                {variant === 'home' ? (
                    <SeamHome {...props} />
                ) : variant === 'spine' ? (
                    <SeamSpine {...props} />
                ) : loginPlatform ? (
                    <LoginPanel platform={loginPlatform} variant="seam" bottomSafe={props.bottomSafe} onDone={actions.loginDone} onClose={actions.closeLogin} />
                ) : null}
            </motion.div>
        </AnimatePresence>
    );
}

/** 按内容是否放得下逐级收紧；窗口尺寸 / 标签页变化时从头量 */
function useFitLevel(key: string, max: number) {
    const ref = useRef<HTMLDivElement>(null);
    const [fit, setFit] = useState({ key: '', level: 0 });
    const level = fit.key === key ? fit.level : 0;
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const over = el.scrollHeight > el.clientHeight + 1;
        if (over && level < max) setFit({ key, level: level + 1 });
        else if (fit.key !== key) setFit({ key, level });
    });
    return { ref, level };
}

/** 竖排标签页；滚轮在上面滚动时切换标签 */
function SeamTabs({ tab, mode }: { tab: LibraryTab; mode: 'normal' | 'compact' | 'short' }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let acc = 0;
        let last = 0;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            acc += event.deltaY;
            const now = Date.now();
            if (Math.abs(acc) < 60 || now - last < 220) return;
            last = now;
            const index = LIBRARY_TABS.indexOf(useSettings.getState().libraryTab);
            const next = LIBRARY_TABS[Math.max(0, Math.min(LIBRARY_TABS.length - 1, index + Math.sign(acc)))];
            acc = 0;
            setSetting('libraryTab', next);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);
    return (
        <div ref={ref} className={cx('seam-tabs shrink-0', mode === 'compact' && 'is-compact', mode === 'short' && 'is-compact is-short')} role="tablist" aria-label="乐库分类">
            {LIBRARY_TABS.map(t => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} title={TAB_NAMES[t]} onClick={() => setSetting('libraryTab', t)} className={cx(tab === t && 'is-active')}>
                    <span className="seam-vlabel">{mode === 'short' ? TAB_SHORT[t] : TAB_NAMES[t]}</span>
                </button>
            ))}
        </div>
    );
}

/** 广场 / 榜单的平台、本地的分组方式 */
function SecondaryNav({ tab, scroll }: { tab: LibraryTab; scroll: boolean }) {
    const plazaPlatform = useSettings(s => s.plazaPlatform);
    const boardPlatform = useSettings(s => s.boardPlatform);
    const localGroup = useSettings(s => s.localGroup);
    if (tab === 'local') {
        return (
            <div className="flex shrink-0 items-center gap-0.5 seam-rise-in">
                {LOCAL_GROUPS.map(([value, label, icon]) => (
                    <button key={value} type="button" title={label} aria-label={label} onClick={() => setSetting('localGroup', value)} className={cx('seam-icon !h-[30px] !w-[30px] !rounded-[10px] [&>svg]:!h-[15px] [&>svg]:!w-[15px]', localGroup === value ? 'is-active' : 'text-[color:var(--seam-ink-soft)]')}>
                        {icon}
                    </button>
                ))}
            </div>
        );
    }
    if (tab !== 'plaza' && tab !== 'boards') return null;
    const value = tab === 'plaza' ? plazaPlatform : boardPlatform;
    return (
        <div className={cx('seam-rise-in grid w-full grid-cols-2 gap-1 px-1', scroll ? 'scroll-none min-h-0 shrink overflow-y-auto' : 'shrink-0')} role="radiogroup" aria-label={tab === 'plaza' ? '广场平台' : '榜单平台'}>
            {PLATFORMS.map(p => (
                <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={value === p}
                    title={PLATFORM_NAMES[p]}
                    onClick={() => setSetting(tab === 'plaza' ? 'plazaPlatform' : 'boardPlatform', p)}
                    className={cx(
                        'h-[26px] truncate rounded-[8px] border border-transparent text-[11.5px] transition-colors',
                        value === p ? 'bg-[rgba(247,244,238,0.14)] font-extrabold text-[#f7f4ee]' : 'text-[color:var(--seam-ink-soft)] hover:border-white/15 hover:text-[#f7f4ee]',
                    )}
                >
                    {PLATFORM_SHORT[p]}
                </button>
            ))}
        </div>
    );
}

function Shortcuts() {
    const radio = usePlayer(s => s.radio);
    const playing = usePlayer(s => s.status === 'playing');
    const fmOn = radio?.id === FM_ID;
    return (
        <div className="flex shrink-0 flex-col items-center gap-2.5 text-[11.5px]">
            <span className="h-px w-[18px] bg-[color:var(--seam-ink-soft)] opacity-40" />
            <button type="button" onClick={fmOn ? ui.openPlayer : startFm} title={fmOn ? '私人FM 播放中，点击打开播放页' : '播放私人FM'} className={cx('flex items-center gap-1.5 transition-colors', fmOn ? 'font-bold text-[#f7f4ee]' : 'text-[color:var(--seam-ink-soft)] hover:text-[#f7f4ee]')}>
                {fmOn && <PlayingBars paused={!playing} className="h-2.5" />}私人FM
            </button>
            <button type="button" onClick={openDaily} title="每日推荐 30 首" className="text-[color:var(--seam-ink-soft)] transition-colors hover:text-[#f7f4ee]">每日推荐</button>
            <button type="button" onClick={openGuess} title="根据你的收藏与最近播放猜你喜欢" className="text-[color:var(--seam-ink-soft)] transition-colors hover:text-[#f7f4ee]">猜我喜欢</button>
        </div>
    );
}

/** 账号入口：已登录时是头像 + 平台角标 + 昵称；还没连接任何平台时只是一行文字；点开账号列表 */
function AccountEntry({ showName, onOpen, active, size = 36 }: { showName: boolean; onOpen: (el: HTMLElement) => void; active: boolean; size?: number }) {
    const accounts = useAccounts();
    const current = useSettings(s => s.libraryAccount);
    const state = accounts[current];
    const profile = state.profile;
    const expired = state.status === 'expired';
    const anyLogged = Object.values(accounts).some(a => a.profile);
    const meta = ACCOUNT_META[current];
    const label = profile ? `${meta.name}：${profile.nickname}${expired ? '（登录已失效）' : ''}` : anyLogged ? `${meta.name}未登录` : '连接在线平台（可选）';
    return (
        <button
            type="button"
            data-seam-pop="account"
            title={`${label}\n点击切换 / 登录平台`}
            aria-label={label}
            aria-expanded={active}
            onClick={event => onOpen(event.currentTarget)}
            className={cx('group flex max-w-full shrink-0 flex-col items-center gap-2 rounded-[12px] px-1.5 py-1 transition-colors', active && 'bg-white/[0.08]')}
        >
            {(profile || anyLogged) && (
                <span className="relative" style={{ width: size, height: size }}>
                    {profile ? (
                        profile.avatarUrl ? (
                            <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" draggable={false} className={cx('h-full w-full rounded-full object-cover ring-1 ring-white/15', expired && 'opacity-50 grayscale')} />
                        ) : (
                            <span className={cx('grid h-full w-full place-items-center rounded-full bg-white/10 text-[14px] font-extrabold', expired && 'opacity-50')}>{profile.nickname.slice(0, 1)}</span>
                        )
                    ) : (
                        <PlatformBadge platform={current} size={size} className="opacity-60" />
                    )}
                    {profile && <PlatformBadge platform={current} size={Math.round(size * 0.42)} className="absolute -bottom-0.5 -right-1 ring-2 ring-[#18181a]" />}
                    {expired && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-[#18181a]" />}
                </span>
            )}
            {(showName || (!profile && !anyLogged)) && (
                <span className={cx('max-w-[100px] truncate text-[12px] font-extrabold leading-tight', profile ? 'text-[#f7f4ee]' : 'text-[color:var(--seam-ink-soft)] group-hover:text-[#f7f4ee]')}>
                    {profile ? profile.nickname : anyLogged ? `登录${meta.short}` : showName ? '连接在线平台' : '登录'}
                </span>
            )}
        </button>
    );
}

function ToolIcon({ label, onClick, children, active, pop }: { label: string; onClick: (el: HTMLElement) => void; children: ReactNode; active?: boolean; pop?: string }) {
    return (
        <button type="button" title={label} aria-label={label} data-seam-pop={pop} onClick={event => onClick(event.currentTarget)} className={cx('seam-icon', active && 'is-active')}>
            {children}
        </button>
    );
}

function SeamHome({ tab, actions, pop, bottomSafe, paused }: SeamBodyProps) {
    const { h } = useWindowSize();
    const lite = useLite();
    const hasSecondary = tab === 'plaza' || tab === 'boards' || tab === 'local';
    // 0 完整 → 1 紧凑 → 2 去标题 → 3 单字标签、藏昵称 → 4 藏快捷入口、平台列表可滚动
    const { ref, level } = useFitLevel(`${h}:${tab}:${bottomSafe}`, 4);
    return (
        <div
            ref={ref}
            className={cx('flex h-full flex-col items-center overflow-hidden', level >= 1 ? 'gap-3 px-2 pt-4' : 'gap-[18px] px-2.5 pt-[22px]')}
            style={{ paddingBottom: bottomSafe }}
        >
            {level < 2 && (
                <button type="button" onClick={actions.recenter} title="回到起点（Home）" className="shrink-0 pl-[0.3em] text-[15px] font-extrabold leading-none tracking-[0.3em] text-[#f7f4ee]">
                    乐库
                </button>
            )}
            <ToolIcon label="收起书签" onClick={actions.fold}><FoldHorizontal /></ToolIcon>
            <SeamTabs tab={tab} mode={level >= 3 ? 'short' : level >= 1 ? 'compact' : 'normal'} />
            {hasSecondary && <SecondaryNav tab={tab} scroll={level >= 4} />}
            <div className="relative min-h-0 w-full flex-1">
                {!lite && <SeamCubes paused={paused} />}
            </div>
            {level < 4 && <Shortcuts />}
            <AccountEntry showName={level < 3} onOpen={actions.toggleAccounts} active={pop === 'account'} />
            <div className="grid shrink-0 grid-cols-2 gap-1">
                <ToolIcon label="搜索（Ctrl K）" onClick={() => ui.openSearch()}><Search /></ToolIcon>
                <ToolIcon label="设置（Ctrl ,）" onClick={() => ui.openSettings()}><Settings /></ToolIcon>
                <ToolIcon label="切换为封面流布局" onClick={() => setSetting('homeLayout', 'carousel')}><PanelsTopLeft /></ToolIcon>
                <ToolIcon label="更多" pop="menu" onClick={actions.toggleMore} active={pop === 'menu'}><Ellipsis /></ToolIcon>
            </div>
        </div>
    );
}

function SeamSpine({ tab, actions, pop, bottomSafe }: SeamBodyProps) {
    const { h } = useWindowSize();
    const { ref, level } = useFitLevel(`${h}:${bottomSafe}`, 2);
    return (
        <div ref={ref} className="flex h-full flex-col items-center gap-3 overflow-hidden px-1 pt-4" style={{ paddingBottom: bottomSafe }}>
            <ToolIcon label="展开书签" onClick={actions.expand}><Maximize2 /></ToolIcon>
            <SeamTabs tab={tab} mode={level >= 1 ? 'short' : 'compact'} />
            <div className="min-h-0 flex-1" />
            <AccountEntry showName={false} onOpen={actions.toggleAccounts} active={pop === 'account'} size={30} />
            <div className="flex shrink-0 flex-col gap-1">
                <ToolIcon label="搜索（Ctrl K）" onClick={() => ui.openSearch()}><Search /></ToolIcon>
                {level < 2 && <ToolIcon label="设置（Ctrl ,）" onClick={() => ui.openSettings()}><Settings /></ToolIcon>}
                <ToolIcon label="更多" pop="menu" onClick={actions.toggleMore} active={pop === 'menu'}><Ellipsis /></ToolIcon>
            </div>
        </div>
    );
}
