import type { CapacitorConfig } from '@capacitor/cli';

/** YEmusic Android 版（Capacitor 外壳 + 自写的原生插件 YeNative，见 android/app/src/main/java）。 */
const config: CapacitorConfig = {
    appId: 'app.yemusic.player',
    appName: 'YEmusic',
    webDir: 'dist',
    backgroundColor: '#000000',
    server: {
        // http 方案：页面来源为 http://localhost（仍是安全上下文），可以直接加载本机回环音频代理，不触发混合内容拦截
        androidScheme: 'http',
        cleartext: true,
    },
    android: {
        allowMixedContent: true,
        webContentsDebuggingEnabled: false,
    },
    plugins: {
        // 深色界面：状态栏 / 导航栏图标用浅色；页面内容放在系统栏之内（insets 由原生层处理）
        SystemBars: { style: 'DARK', insetsHandling: 'css' },
    },
};

export default config;
