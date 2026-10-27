/** Android 返回键：先逐层关闭界面，已在最外层时把应用退到后台（音乐继续播放） */
import { App } from '@capacitor/app';
import { handleBack } from './shortcuts';

export function installAndroidBack() {
    void App.addListener('backButton', () => {
        if (!handleBack()) void App.minimizeApp();
    });
}
