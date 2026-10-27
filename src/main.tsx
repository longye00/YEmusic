// Android 外壳要先于 host.ts 求值，注入 window.ye
import './lib/androidHost';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { host, isAndroid } from './lib/host';
import './lib/lite';
import { installAndroidBack } from './ui/androidBack';
import { importFiles, loadLibrary, rescanLocal, useLibrary } from './store/library';
import { playList, playTrack, restorePlayback, usePlayer } from './store/player';
import { setSetting, useSettings } from './store/settings';
import { callSource, loadSources, setBlockedHosts, useSources } from './store/sources';
import { findAlternatives, resolveUrl } from './player/resolver';
import { toLxMusicInfo } from './player/musicInfo';
import { sdks } from './sdk';
import { useUi } from './store/ui';
import { useWyAccount } from './store/wyAccount';
import { initAccounts, useOtherAccounts } from './store/accounts';

// 调试用：在开发者工具中可通过 __ye 查看状态
Object.defineProperty(window, '__ye', { value: { player: usePlayer, ui: useUi, sources: useSources, library: useLibrary, settings: useSettings, wyAccount: useWyAccount, accounts: useOtherAccounts, host, resolveUrl, callSource, toLxMusicInfo, sdks, findAlternatives, actions: { importFiles, rescanLocal, setSetting, playTrack, playList } } });

const settings = useSettings.getState();
setBlockedHosts(settings.blockedHosts);
host.setCloseToTray(settings.closeToTray).catch(() => undefined);
if (isAndroid) installAndroidBack();

// 阻止把文件拖进窗口时直接导航离开应用
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

(async () => {
    await Promise.allSettled([loadLibrary(), loadSources()]);
    restorePlayback();
    initAccounts();
})();
