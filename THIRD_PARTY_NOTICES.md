# 第三方声明 / Third-party notices

## 许可证概览

| 部分 | 许可证 | 文件 |
| --- | --- | --- |
| YEmusic 自有代码（`electron/`、`src/` 中除 `src/folia/` 以外的部分、`android/`、`scripts/`、`packaging/` 等） | Apache License 2.0 | `LICENSE` |
| Folia 的歌词动画代码（`src/folia/`，自 0.5.0 起引入） | GNU AGPL-3.0 | `LICENSE-AGPL-3.0.txt` |
| 其余第三方库 | 见下文各自的许可证 | — |

**由于 0.5.0 起程序中包含了 AGPL-3.0 的 Folia 代码，包含它的整体程序（Windows 安装包、Android APK）按 AGPL-3.0 分发。**
向他人提供安装包 / APK 时，必须同时提供对应版本的完整源代码（或附上获取源码的书面说明），并保留版权声明与许可文本。
YEmusic 自有代码本身仍可按 Apache-2.0 单独使用；只是与 `src/folia/` 合在一起构成的整体受 AGPL-3.0 约束。

## Folia（歌词动画）
- 版权所有 © chthollyphile 及 Folia 贡献者
- 许可证：GNU AGPL-3.0 — https://github.com/chthollyphile/folia-major
- 引入版本：Folia **v0.7.20**（commit `1b39fd868e2ddda95788f1baa839c032f3e7a285`）
- 引入内容：Folia v0.5.0 及之后新增的 8 种歌词动画——莫奈（monet）、回环（claddagh）、镜台（diorama）、时计（pendolo）、
  商籁（sonnet）、凝彩（tempera）、静止（still）、绘光（lumiere）——以及它们的渲染器、参数面板与所需的工具代码，
  放在 `src/folia/`（共 315 个文件，其中 305 个与上游逐字节相同）。
- 与上游不同的文件、更新方法、分发要求见 `src/folia/VENDOR.md`；这些文件的头部都有修改说明，原作者的版权声明与注释均已保留。
- 另外，YEmusic 的界面**视觉风格与交互**（首页封面轮播、「乐库」拼贴墙与书签、海报卡片、沉浸式播放页、Latent 背景、逐字歌词动效等）
  参考了 Folia，这部分界面代码为本项目独立编写。
- `src/ui/player/folia/`、`src/store/foliaTunings.ts` 是 YEmusic 写的接入层，因为直接引用 `src/folia/`，同样属于 AGPL 整体的一部分。

## lx-music-desktop（洛雪音乐助手）
- 版权所有 © lyswhut 及 lx-music-desktop 贡献者
- 许可证：Apache License 2.0 — https://github.com/lyswhut/lx-music-desktop
- 本项目的「自定义音源」运行环境（`lx` 全局对象、`musicInfo` 字段格式、脚本头信息格式）以及
  各平台搜索 / 歌单 / 排行榜 / 歌词接口的调用方式参考并移植自 lx-music-desktop，并做了修改
  （改为 TypeScript、在独立 Worker 中运行、增加超时 / 熔断 / 跨平台换源等逻辑）。

## 运行时依赖（随程序分发）

### 桌面版 / 界面（npm）
| 项目 | 版本 | 许可证 |
| --- | --- | --- |
| Electron / Chromium（仅 Windows 版） | 44.7.0 | MIT / BSD 等（见安装目录下 `LICENSE.electron.txt`、`LICENSES.chromium.html`） |
| React、React DOM | 19.3 | MIT |
| framer-motion | 14.1 | MIT |
| zustand | 5.0 | MIT |
| lucide-react | 1.55 | ISC |
| music-metadata | 12.1 | MIT |
| pixi.js（Folia 动画：商籁 / 凝彩 / 绘光） | 8.22 | MIT |
| three、@react-three/fiber（Folia 动画：镜台） | 0.185 / 9.8 | MIT |
| @chenglou/pretext（文字排版测量，Folia 动画使用） | 0.0.9 | MIT |
| i18next、react-i18next（Folia 代码使用） | 26.5 / 17.1 | MIT |
| fflate | 0.8 | MIT |
| QR Code for JavaScript（Kazuhiko Arase，`src/lib/vendor/qrcode.js`，仅用于显示网易云登录二维码） | — | MIT |

### Android 版
| 项目 | 版本 | 许可证 |
| --- | --- | --- |
| Capacitor（`@capacitor/core`、`@capacitor/app`、`@capacitor/android`） | 8.x | MIT |
| OkHttp、okhttp-brotli（Square） | 4.12.0 | Apache-2.0 |
| AndroidX（appcompat、coordinatorlayout、core-splashscreen、media 等，Google） | 见 `android/variables.gradle` | Apache-2.0 |

### 构建工具（不随程序分发）
Vite、Tailwind CSS、TypeScript、esbuild、Gradle / Android Gradle 插件、`@electron/asar`、`resedit`、`pe-library`、NSIS 等。

## 内置音源脚本
- `src/plugins/presets/yemusic-merged.js`（YEmusic 聚合音源）由 `scripts/build-merged-source.mjs` 生成：
  把「星海」「墨澜聚合」「长青SVIP」「K×H」四个音源脚本原样打包进同一个文件，外加一层按平台竞速 / 自动回退的调度逻辑。
  四个子音源的代码版权归各自作者所有（原始脚本见 `sources/merged/subs/`），YEmusic 只做组合与调度。
- `src/plugins/presets/聚合音源特供版.js`（全豆要聚合音源）由原作者发布，版权归原作者所有。
- 已失效而停用的旧预置脚本（lx-music-source-v3、Huibq、野花、野草）移到了 `sources/retired/`，不再随安装包分发。

以上脚本都只是可选的预置音源，可在「设置 → 音源」中禁用或删除。

YEmusic 本身不提供、不存储任何音乐内容；所有音频均由用户自行添加的音源脚本从第三方获取，
请遵守当地法律法规并支持正版音乐。
