/**
 * 在线平台账号（都是可选的）：网易云音乐 / QQ音乐 / 酷狗音乐。
 * 网易云沿用 wyAccount；QQ音乐与酷狗在这里管理。乐库的“当前平台”（settings.libraryAccount）决定歌单 / 专辑页显示谁的收藏。
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { parseCookieString } from '@/sdk/wyAuth';
import { captchaSent, loginCellphone, qrCheck, qrCreate } from '@/sdk/wyApi';
import { getTxCredential, hasTxLogin, parseTxCookie, setTxCredential, txFallbackName, txFetchProfile, txQqQrCheck, txQqQrCreate, txQqQrFinish, txWxQrCheck, txWxQrCreate, txWxQrFinish, type TxCredential } from '@/sdk/txAuth';
import { getKgCredential, hasKgLogin, isKgAuthError, kgQrCheck, kgQrCreate, kgUserPlaylists, parseKgCookie, setKgCredential, type KgCredential } from '@/sdk/kgAuth';
import { sleep } from '@/lib/util';
import { setSetting, useSettings } from './settings';
import { toast } from './toast';
import { completeWyLogin, initWyAccount, logoutWy, useWyAccount } from './wyAccount';

export type AccountPlatform = 'wy' | 'tx' | 'kg';
export const ACCOUNT_PLATFORMS: AccountPlatform[] = ['wy', 'tx', 'kg'];

export const ACCOUNT_META: Record<AccountPlatform, { name: string; short: string; badge: string; color: string; scanWith: string; perks: string }> = {
    wy: { name: '网易云音乐', short: '网易云', badge: '云', color: '#dc2626', scanWith: '网易云音乐 App', perks: '你的歌单、收藏专辑，私人FM 与每日推荐按你的口味生成' },
    tx: { name: 'QQ音乐', short: 'QQ音乐', badge: 'Q', color: '#16a34a', scanWith: 'QQ 或微信', perks: '你创建 / 收藏的歌单（含“我喜欢”）与收藏的专辑' },
    kg: { name: '酷狗音乐', short: '酷狗', badge: 'K', color: '#2563eb', scanWith: '酷狗音乐 App', perks: '你的歌单（含“我喜欢”）与收藏的歌单' },
};

export interface AccountProfile { id: string; nickname: string; avatarUrl?: string }
export type AccountStatus = 'anonymous' | 'checking' | 'ready' | 'expired';
export interface AccountState { profile: AccountProfile | null; status: AccountStatus; version: number }

const txProfile = (c: TxCredential | null): AccountProfile | null => (c ? { id: c.uin, nickname: c.nickname || txFallbackName(c), avatarUrl: c.avatarUrl } : null);
const kgProfile = (c: KgCredential | null): AccountProfile | null => (c ? { id: c.userid, nickname: c.nickname || `酷狗 ${c.userid}`, avatarUrl: c.avatarUrl } : null);

export const useOtherAccounts = create<{ tx: AccountState; kg: AccountState }>(() => ({
    tx: { profile: txProfile(getTxCredential()), status: hasTxLogin() ? 'checking' : 'anonymous', version: 0 },
    kg: { profile: kgProfile(getKgCredential()), status: hasKgLogin() ? 'checking' : 'anonymous', version: 0 },
}));

const patch = (p: 'tx' | 'kg', next: Partial<AccountState> | ((s: AccountState) => Partial<AccountState>)) =>
    useOtherAccounts.setState(s => ({ [p]: { ...s[p], ...(typeof next === 'function' ? next(s[p]) : next) } }) as Partial<{ tx: AccountState; kg: AccountState }>);

/** 三个平台的账号状态 */
export function useAccounts(): Record<AccountPlatform, AccountState> {
    const wyProfile = useWyAccount(s => s.profile);
    const wyStatus = useWyAccount(s => s.status);
    const wyVersion = useWyAccount(s => s.version);
    const tx = useOtherAccounts(s => s.tx);
    const kg = useOtherAccounts(s => s.kg);
    return useMemo(() => ({
        wy: { profile: wyProfile ? { id: String(wyProfile.userId), nickname: wyProfile.nickname, avatarUrl: wyProfile.avatarUrl } : null, status: wyStatus, version: wyVersion },
        tx,
        kg,
    }), [wyProfile, wyStatus, wyVersion, tx, kg]);
}

export const useAccount = (p: AccountPlatform) => useAccounts()[p];

/** 乐库当前显示的平台；没登录过任何平台时为网易云 */
export function useCurrentAccount(): AccountPlatform {
    return useSettings(s => s.libraryAccount);
}

function isLoggedIn(p: AccountPlatform) {
    if (p === 'wy') return Boolean(useWyAccount.getState().profile);
    return Boolean(useOtherAccounts.getState()[p].profile);
}

const afterLogin = (p: AccountPlatform) => setSetting('libraryAccount', p);

function afterLogout(p: AccountPlatform) {
    if (useSettings.getState().libraryAccount !== p) return;
    const other = ACCOUNT_PLATFORMS.find(x => x !== p && isLoggedIn(x));
    if (other) setSetting('libraryAccount', other);
}

// ---------------- QQ音乐 ----------------
/**
 * 保存 QQ 音乐凭据并拉取资料。
 * fresh = 刚用扫码拿到的凭据：它是 QQ 音乐刚刚签发的，资料接口暂时说不清楚时也先登录进去，不能因为校验环节的小问题把登录拦下；
 * 手动粘贴的 Cookie 则必须校验通过。
 */
export async function completeTxLogin(cred: TxCredential, fresh = false): Promise<AccountProfile> {
    let info: Awaited<ReturnType<typeof txFetchProfile>> = null;
    try {
        info = await txFetchProfile(cred);
    } catch (error) {
        // 资料接口偶尔不可用：扫码拿到的凭据仍然可用
        if (!fresh) throw error;
    }
    if (!info && !fresh) throw new Error('登录凭据无效或已过期');
    const saved: TxCredential = { ...cred, nickname: info?.nickname || cred.nickname, avatarUrl: info?.avatarUrl || cred.avatarUrl };
    setTxCredential(saved);
    const profile = txProfile(saved)!;
    patch('tx', s => ({ profile, status: 'ready', version: s.version + 1 }));
    afterLogin('tx');
    return profile;
}

export function logoutTx() {
    setTxCredential(null);
    patch('tx', s => ({ profile: null, status: 'anonymous', version: s.version + 1 }));
    afterLogout('tx');
    toast('已退出 QQ音乐 账号', 'success');
}

async function initTxAccount() {
    const cred = getTxCredential();
    if (!cred) return;
    try {
        const info = await txFetchProfile(cred);
        if (!info) {
            patch('tx', { status: 'expired' });
            toast('QQ音乐 登录已失效，可在乐库中重新登录', 'warning', { duration: 5000 });
            return;
        }
        const saved = { ...cred, nickname: info.nickname, avatarUrl: info.avatarUrl || cred.avatarUrl };
        setTxCredential(saved);
        patch('tx', { profile: txProfile(saved), status: 'ready' });
    } catch {
        patch('tx', { status: 'ready' });
    }
}

// ---------------- 酷狗音乐 ----------------
export async function completeKgLogin(cred: KgCredential): Promise<AccountProfile> {
    const previous = getKgCredential();
    setKgCredential(cred);
    try {
        await kgUserPlaylists();
    } catch (error) {
        if (isKgAuthError(error)) {
            setKgCredential(previous);
            throw new Error('登录凭据无效或已过期');
        }
    }
    const profile = kgProfile(cred)!;
    patch('kg', s => ({ profile, status: 'ready', version: s.version + 1 }));
    afterLogin('kg');
    return profile;
}

export function logoutKg() {
    setKgCredential(null);
    patch('kg', s => ({ profile: null, status: 'anonymous', version: s.version + 1 }));
    afterLogout('kg');
    toast('已退出酷狗音乐账号', 'success');
}

async function initKgAccount() {
    if (!getKgCredential()) return;
    try {
        await kgUserPlaylists();
        patch('kg', { status: 'ready' });
    } catch (error) {
        if (isKgAuthError(error)) {
            patch('kg', { status: 'expired' });
            toast('酷狗音乐登录已失效，可在乐库中重新登录', 'warning', { duration: 5000 });
        } else patch('kg', { status: 'ready' });
    }
}

// ---------------- 统一入口 ----------------
export function initAccounts() {
    const current = useSettings.getState().libraryAccount;
    if (!isLoggedIn(current)) {
        // 当前平台没登录：换到已登录的平台；一个都没登录时回到网易云（匿名推荐最全）
        const other = ACCOUNT_PLATFORMS.find(isLoggedIn) ?? 'wy';
        if (other !== current) setSetting('libraryAccount', other);
    }
    void initWyAccount();
    void initTxAccount();
    void initKgAccount();
}

export async function logoutAccount(p: AccountPlatform) {
    if (p === 'wy') {
        await logoutWy();
        afterLogout('wy');
    } else if (p === 'tx') logoutTx();
    else logoutKg();
}

export async function loginWithCookie(p: AccountPlatform, text: string): Promise<AccountProfile> {
    if (p === 'wy') {
        const cookies = parseCookieString(text);
        if (!cookies.MUSIC_U) throw new Error('没有找到 MUSIC_U，请粘贴完整的 Cookie 或 MUSIC_U 的值');
        const profile = await completeWyLogin(cookies);
        afterLogin('wy');
        return { id: String(profile.userId), nickname: profile.nickname, avatarUrl: profile.avatarUrl };
    }
    if (p === 'tx') {
        const cred = parseTxCookie(text);
        if (!cred) throw new Error('没有找到 uin 与 qqmusic_key（或 qm_keyst），请粘贴完整的 Cookie');
        return completeTxLogin(cred);
    }
    const cred = parseKgCookie(text);
    if (!cred) throw new Error('没有找到 userid 与 token，请按 userid=…; token=… 的格式粘贴');
    return completeKgLogin(cred);
}

// ---------------- 手机验证码登录（仅网易云） ----------------
/** 发送登录验证码；成功后 UI 自行做 60s 倒计时 */
export async function sendWyCaptcha(phone: string): Promise<void> {
    await captchaSent(phone.replace(/\s+/g, ''));
}

/** 手机号 + 验证码登录网易云；复用扫码登录的凭据落地路径 */
export async function loginWyWithPhone(phone: string, captcha: string): Promise<AccountProfile> {
    const cookies = await loginCellphone(phone.replace(/\s+/g, ''), captcha.replace(/\s+/g, ''));
    const profile = await completeWyLogin(cookies);
    afterLogin('wy');
    return { id: String(profile.userId), nickname: profile.nickname, avatarUrl: profile.avatarUrl };
}

// ---------------- 扫码登录流程 ----------------
export type LoginMethod = 'qr' | 'qq' | 'wechat';
export interface LoginQr { kind: 'image' | 'text'; value: string }
export type LoginPhase =
    | { phase: 'loading' }
    | { phase: 'waiting' }
    | { phase: 'scanned'; nickname?: string; avatarUrl?: string }
    | { phase: 'finishing' }
    | { phase: 'expired' }
    | { phase: 'refused' }
    | { phase: 'done'; profile: AccountProfile }
    | { phase: 'error'; message: string };

/** 开始一次扫码登录；返回取消函数 */
export function startQrLogin(p: AccountPlatform, method: LoginMethod, onQr: (qr: LoginQr | null) => void, onPhase: (phase: LoginPhase) => void): () => void {
    let alive = true;
    const emit = (phase: LoginPhase) => { if (alive) onPhase(phase); };
    const finish = async (run: () => Promise<AccountProfile>) => {
        emit({ phase: 'finishing' });
        try {
            emit({ phase: 'done', profile: await run() });
        } catch (error) {
            emit({ phase: 'error', message: (error as Error).message || '登录失败' });
        }
    };
    /** 普通轮询：网络抖动时继续 */
    const poll = async <T,>(check: () => Promise<T>, handle: (value: T) => Promise<boolean> | boolean, interval = 2000) => {
        await sleep(1200);
        while (alive) {
            try {
                if (await handle(await check())) return;
            } catch { /* 继续轮询 */ }
            await sleep(interval);
        }
    };
    onQr(null);
    emit({ phase: 'loading' });
    (async () => {
        try {
            if (p === 'wy') {
                const qr = await qrCreate();
                if (!alive) return;
                onQr({ kind: 'text', value: qr.url });
                emit({ phase: 'waiting' });
                await poll(() => qrCheck(qr.key), async s => {
                    if (s.code === 802) emit({ phase: 'scanned', nickname: s.nickname, avatarUrl: s.avatarUrl });
                    else if (s.code === 803) {
                        await finish(async () => {
                            const profile = await completeWyLogin(s.cookies || {});
                            afterLogin('wy');
                            return { id: String(profile.userId), nickname: profile.nickname, avatarUrl: profile.avatarUrl };
                        });
                        return true;
                    } else if (s.code === 800) {
                        emit({ phase: 'expired' });
                        return true;
                    } else if (s.code !== 801) {
                        emit({ phase: 'error', message: s.message ? `${s.message}（${s.code}）` : `登录失败（${s.code}）` });
                        return true;
                    }
                    return false;
                });
            } else if (p === 'tx' && method === 'wechat') {
                const qr = await txWxQrCreate();
                if (!alive) return;
                onQr({ kind: 'image', value: qr.image });
                emit({ phase: 'waiting' });
                let last: number | undefined;
                while (alive) {
                    let state;
                    try {
                        state = await txWxQrCheck(qr.key, last);
                    } catch {
                        await sleep(2000);
                        continue;
                    }
                    if (!alive) return;
                    if (state.code === 'scanned') {
                        last = 404;
                        emit({ phase: 'scanned' });
                    } else if (state.code === 'done') {
                        const code = state.wxCode;
                        await finish(async () => completeTxLogin(await txWxQrFinish(code), true));
                        return;
                    } else if (state.code === 'expired' || state.code === 'refused') {
                        emit({ phase: state.code });
                        return;
                    }
                }
            } else if (p === 'tx') {
                const qr = await txQqQrCreate();
                if (!alive) return;
                onQr({ kind: 'image', value: qr.image });
                emit({ phase: 'waiting' });
                await poll(() => txQqQrCheck(qr.key), async s => {
                    if (s.code === 'scanned') emit({ phase: 'scanned' });
                    else if (s.code === 'done') {
                        await finish(async () => completeTxLogin(await txQqQrFinish(s.url, s.jar), true));
                        return true;
                    } else if (s.code === 'expired' || s.code === 'refused') {
                        emit({ phase: s.code });
                        return true;
                    } else if (s.code === 'error') {
                        emit({ phase: 'error', message: s.message });
                        return true;
                    }
                    return false;
                });
            } else {
                const qr = await kgQrCreate();
                if (!alive) return;
                onQr({ kind: 'image', value: qr.image });
                emit({ phase: 'waiting' });
                await poll(() => kgQrCheck(qr.key), async s => {
                    if (s.code === 'scanned') emit({ phase: 'scanned', nickname: s.nickname, avatarUrl: s.avatarUrl });
                    else if (s.code === 'done') {
                        await finish(() => completeKgLogin(s.credential));
                        return true;
                    } else if (s.code === 'expired') {
                        emit({ phase: 'expired' });
                        return true;
                    }
                    return false;
                });
            }
        } catch (error) {
            emit({ phase: 'error', message: (error as Error).message || '获取二维码失败' });
        }
    })();
    return () => { alive = false; };
}
