/** 乐库里的快捷操作：私人FM、每日推荐、猜我喜欢、登录在线平台 */
import type { Track } from '@/sdk/types';
import { dailySongs, personalFm } from '@/sdk/wyApi';
import type { AccountPlatform } from '@/store/accounts';
import { playRadio } from '@/store/player';
import { ui, useUi } from '@/store/ui';
import { guessSongs } from '@/player/guess';
import { playLoaded } from '../home/remote';

export const FM_ID = 'wy-fm';

/** 私人FM 每次只给 1~3 首，凑够 3 首再返回 */
export async function fmFeeder(): Promise<Track[]> {
    const out: Track[] = [];
    const seen = new Set<string>();
    let lastError: unknown;
    for (let i = 0; i < 4 && out.length < 3; i++) {
        try {
            for (const track of await personalFm()) {
                if (seen.has(track.id)) continue;
                seen.add(track.id);
                out.push(track);
            }
        } catch (error) {
            lastError = error;
            if (!out.length && i >= 1) break;
        }
    }
    if (!out.length && lastError) throw lastError;
    return out;
}

export const startFm = () => playRadio({ id: FM_ID, name: '私人FM' }, fmFeeder);
export const playDaily = () => playLoaded('每日推荐', dailySongs);
export const openDaily = () => ui.openDetail({ kind: 'daily', platform: 'wy', id: 'daily' });
export const playGuess = () => playLoaded('猜我喜欢', async () => (await guessSongs()).list);
export const openGuess = () => ui.openDetail({ kind: 'guess', platform: 'wy', id: 'guess' });
type LoginHandler = (p: AccountPlatform) => void;
let seamLogin: LoginHandler | null = null;

/** 乐库挂载时注册：乐库可见时登录在书签里进行 */
export function registerSeamLogin(fn: LoginHandler) {
    seamLogin = fn;
    return () => {
        if (seamLogin === fn) seamLogin = null;
    };
}

/** 登录在线平台：电脑上乐库可见时在书签里扫码，否则（被盖住 / 手机窄屏）弹出登录对话框 */
export function openLogin(p: AccountPlatform) {
    const s = useUi.getState();
    const covered = Boolean(s.detail || s.searchOpen || s.playerOpen || s.settingsOpen || s.dialog);
    // 手机竖屏（< 640px）放不下 300px 宽的书签，墙还得平移让位，容易被裁掉半个二维码，直接用对话框
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches;
    if (seamLogin && !covered && !phone) seamLogin(p);
    else ui.dialog({ type: 'login', platform: p });
}
