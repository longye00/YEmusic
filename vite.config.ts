import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    worker: { format: 'iife' },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'chrome130',
        chunkSizeWarningLimit: 4000,
        sourcemap: false,
        // 把大而稳定的依赖拆成独立 chunk：升级应用版本时这些文件的浏览器/磁盘缓存不失效，
        // 冷启动少下载几百 KB。三方库各自成组，避免和业务代码互相牵连。
        rolldownOptions: {
            output: {
                advancedChunks: {
                    groups: [
                        { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
                        { name: 'vendor-motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
                        { name: 'vendor-i18n', test: /node_modules[\\/](i18next|react-i18next)[\\/]/ },
                        // three / pixi 刻意不分组：它们只被懒加载的可视化器用到，
                        // rolldown 会在异步 chunk 之间自动共享；手动分组反而会让主包
                        // 静态依赖这个大 chunk（一个 interop helper 被提升进去），启动即下载。
                    ],
                },
            },
        },
    },
    server: { port: 5173, strictPort: true },
});
