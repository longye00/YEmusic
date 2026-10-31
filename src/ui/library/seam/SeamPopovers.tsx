/** 书签旁弹出的小面板：账号列表（切换 / 登录 / 退出三个平台）与“更多”菜单 */
import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, LogIn, LogOut } from 'lucide-react';
import { ACCOUNT_META, ACCOUNT_PLATFORMS, logoutAccount, useAccounts, type AccountPlatform } from '@/store/accounts';
import { setSetting, useSettings } from '@/store/settings';
import { ui } from '@/store/ui';
import { cx } from '../../components/common';
import { PlatformBadge } from '../LoginPanel';

export interface PopPlacement {
    kind: 'account' | 'menu';
    left: number;
    bottom: number;
    width: number;
    side: 'left' | 'right';
}

/** 点外面 / Esc 关闭；点自己的触发按钮交给按钮自己切换 */
function usePopDismiss(kind: PopPlacement['kind'], onClose: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        const onDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (ref.current?.contains(target)) return;
            if (target?.closest?.(`[data-seam-pop="${kind}"]`)) return;
            closeRef.current();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                closeRef.current();
            }
        };
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('keydown', onKey, true);
        };
    }, [kind]);
    return ref;
}

function PopShell({ placement, onClose, children, label }: { placement: PopPlacement; onClose: () => void; children: ReactNode; label: string }) {
    const ref = usePopDismiss(placement.kind, onClose);
    const dx = placement.side === 'right' ? -8 : 8;
    return (
        <motion.div
            ref={ref}
            role="menu"
            aria-label={label}
            initial={{ opacity: 0, x: dx, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: dx / 2, scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.25, 1] }}
            className={cx('seam-pop no-drag scroll-thin overflow-y-auto', placement.side === 'right' ? 'origin-bottom-left' : 'origin-bottom-right')}
            style={{ left: placement.left, bottom: placement.bottom, width: placement.width, maxHeight: `calc(100% - ${placement.bottom + 12}px)` }}
        >
            {children}
        </motion.div>
    );
}

export function AccountList({ placement, onClose, onLogin }: { placement: PopPlacement; onClose: () => void; onLogin: (p: AccountPlatform) => void }) {
    const accounts = useAccounts();
    const current = useSettings(s => s.libraryAccount);
    return (
        <PopShell placement={placement} onClose={onClose} label="在线平台账号">
            <div className="px-2.5 pb-1 pt-2 text-[11px] font-bold tracking-[0.14em] text-white/45">在线平台</div>
            {ACCOUNT_PLATFORMS.map(p => {
                const state = accounts[p];
                const meta = ACCOUNT_META[p];
                const logged = Boolean(state.profile);
                const expired = state.status === 'expired';
                const isCurrent = logged && current === p;
                const usable = logged && !expired;
                return (
                    <div
                        key={p}
                        role="menuitem"
                        tabIndex={0}
                        title={usable ? (isCurrent ? '乐库正在显示这个平台' : `在乐库里显示${meta.name}的歌单与专辑`) : `登录${meta.name}`}
                        onClick={() => {
                            onClose();
                            if (usable) setSetting('libraryAccount', p);
                            else onLogin(p);
                        }}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                (event.currentTarget as HTMLElement).click();
                            }
                        }}
                        className={cx('seam-pop-item group cursor-pointer', isCurrent && 'bg-white/[0.05]')}
                    >
                        <span className="relative shrink-0">
                            {state.profile?.avatarUrl ? (
                                <img src={state.profile.avatarUrl} alt="" referrerPolicy="no-referrer" draggable={false} className={cx('h-8 w-8 rounded-full object-cover ring-1 ring-white/15', expired && 'opacity-50 grayscale')} />
                            ) : (
                                <PlatformBadge platform={p} size={32} className={cx(!logged && 'opacity-80 saturate-[.7]')} />
                            )}
                            {state.profile?.avatarUrl && <PlatformBadge platform={p} size={14} className="absolute -bottom-0.5 -right-1 ring-2 ring-[#1a1a19]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-bold text-[#f7f4ee]">{meta.name}</span>
                            <span className={cx('block truncate text-[11.5px]', expired ? 'text-amber-300/90' : 'text-white/50')}>
                                {expired ? '登录已失效，点击重新登录' : state.profile ? state.profile.nickname : state.status === 'checking' ? '正在检查登录…' : '未登录 · 点击登录'}
                            </span>
                        </span>
                        {logged && (
                            <button
                                type="button"
                                title={`退出${meta.name}`}
                                aria-label={`退出${meta.name}`}
                                onClick={event => {
                                    event.stopPropagation();
                                    onClose();
                                    ui.confirm(`退出${meta.name}`, `退出后乐库将不再显示你的${meta.name}歌单与收藏${p === 'wy' ? '，私人FM / 每日推荐变为通用推荐' : ''}。`, () => void logoutAccount(p), { confirmText: '退出', danger: true });
                                }}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/45 opacity-0 transition-opacity hover:bg-white/10 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-80 [&>svg]:h-3.5 [&>svg]:w-3.5"
                            >
                                <LogOut />
                            </button>
                        )}
                        {isCurrent ? <Check className="text-[rgb(var(--accent-soft))]" /> : !usable ? <LogIn className="text-white/40" /> : <span className="w-4 shrink-0" />}
                    </div>
                );
            })}
            <div className="seam-pop-sep" />
            <p className="px-2.5 pb-2 pt-1 text-[11px] leading-relaxed text-white/40">乐库的歌单与专辑来自当前选中的平台。登录是可选的，凭据只保存在本机。</p>
        </PopShell>
    );
}

export interface SeamMenuItem { icon: ReactNode; label: string; hint?: string; danger?: boolean; separated?: boolean; run: () => void }

export function SeamMenu({ placement, items, onClose }: { placement: PopPlacement; items: SeamMenuItem[]; onClose: () => void }) {
    return (
        <PopShell placement={placement} onClose={onClose} label="更多">
            {items.map(item => (
                <div key={item.label}>
                    {item.separated && <div className="seam-pop-sep" />}
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            onClose();
                            item.run();
                        }}
                        className={cx('seam-pop-item', item.danger && '!text-red-300')}
                    >
                        {item.icon}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && <kbd>{item.hint}</kbd>}
                    </button>
                </div>
            ))}
        </PopShell>
    );
}
