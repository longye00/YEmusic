/** 网易云账号（可选）：扫码登录后乐库会显示你的歌单、收藏专辑、个性化私人FM / 每日推荐 */
import { create } from 'zustand';
import { fetchAccount, logoutRemote, type WyProfile } from '@/sdk/wyApi';
import { clearWyCookies, getWyCookies, hasWyLogin, setWyCookies, type WyCookies } from '@/sdk/wyAuth';
import { toast } from './toast';

const PROFILE_KEY = 'ye.wy.profile';

interface WyAccountState {
    profile: WyProfile | null;
    status: 'anonymous' | 'checking' | 'ready' | 'expired';
    /** 登录 / 退出时递增，用于刷新依赖账号的缓存 */
    version: number;
}

function loadProfile(): WyProfile | null {
    if (!hasWyLogin()) return null;
    try {
        const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
        return value?.userId ? value : null;
    } catch {
        return null;
    }
}

export const useWyAccount = create<WyAccountState>(() => ({
    profile: loadProfile(),
    status: hasWyLogin() ? 'checking' : 'anonymous',
    version: 0,
}));

function saveProfile(profile: WyProfile | null) {
    try {
        if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
        else localStorage.removeItem(PROFILE_KEY);
    } catch { /* ignore */ }
}

/** 启动时校验登录状态（网络失败时沿用缓存的资料） */
export async function initWyAccount() {
    if (!hasWyLogin()) return;
    try {
        const profile = await fetchAccount();
        if (profile) {
            saveProfile(profile);
            useWyAccount.setState(s => ({ profile, status: 'ready', version: s.profile?.userId === profile.userId ? s.version : s.version + 1 }));
        } else {
            useWyAccount.setState({ status: 'expired' });
            toast('网易云登录已失效，可在乐库中重新扫码登录', 'warning', { duration: 5000 });
        }
    } catch {
        useWyAccount.setState(s => ({ status: s.profile ? 'ready' : 'expired' }));
    }
}

/** 保存登录凭据并拉取账号资料；凭据无效时抛错并恢复原状态 */
export async function completeWyLogin(cookies: WyCookies): Promise<WyProfile> {
    if (!cookies.MUSIC_U) throw new Error('没有拿到登录凭据（MUSIC_U），请重试或改用 Cookie 登录');
    const previous = { ...getWyCookies() };
    setWyCookies(cookies, true);
    let profile: WyProfile | null = null;
    try {
        profile = await fetchAccount();
    } catch (error) {
        setWyCookies(previous, true);
        throw error;
    }
    if (!profile) {
        setWyCookies(previous, true);
        throw new Error('登录凭据无效或已过期');
    }
    saveProfile(profile);
    useWyAccount.setState(s => ({ profile, status: 'ready', version: s.version + 1 }));
    return profile;
}

export async function logoutWy() {
    await logoutRemote();
    clearWyCookies();
    saveProfile(null);
    useWyAccount.setState(s => ({ profile: null, status: 'anonymous', version: s.version + 1 }));
    toast('已退出网易云账号', 'success');
}
