# src/folia —— Folia 的歌词动画（第三方代码，AGPL-3.0）

这个目录里的代码来自 **Folia**（<https://github.com/chthollyphile/folia-major>），许可证 **GNU AGPL-3.0**
（全文见仓库根目录 `LICENSE-AGPL-3.0.txt`）。版权属于 chthollyphile 及 Folia 的贡献者。
YEmusic 自有代码仍是 Apache-2.0；但包含这个目录的**整体程序**（Windows 安装包、Android APK）按 AGPL-3.0 分发。

| 项目 | 内容 |
| --- | --- |
| 上游版本 | Folia **v0.7.20**（commit `1b39fd868e2ddda95788f1baa839c032f3e7a285`） |
| 引入范围 | Folia **v0.5.0 及之后**新增的歌词动画（共 8 种，见下表） |
| 文件数 | 315 个源文件：305 个与上游**逐字节相同**，9 个**有修改**，1 个**新增**；另有 2 个由脚本裁剪生成的语言文件 |

## 引入了哪些动画

| 动画 | 中文名 | Folia 首次出现 |
| --- | --- | --- |
| `monet` | 莫奈 | 0.5.0 |
| `claddagh` | 回环 | 0.5.23 |
| `diorama` | 镜台 | 0.5.27 |
| `pendolo` | 时计 | 0.6.3 |
| `sonnet` | 商籁 | 0.6.9 |
| `tempera` | 凝彩 | 0.6.20 |
| `still` | 静止 | 0.6.22 |
| `lumiere` | 绘光 | 0.7.10 |

没有引入的：v0.5.0 之前就有的动画（classic / cadenza / partita / fume）、cappella、tilt，Folia 的背景渲染器、视频层、
Folium 模组系统、Dexie 数据库、完整的歌词解析器（TTML / YRC / QRC / KRC）、AI 主题生成、自定义分段等。
这些都不是“歌词动画本体”，YEmusic 有自己对应的部分。

## 与上游不同的文件（都在文件头部有 “YEmusic modification / shim (2026)” 说明）

| 文件 | 改动 |
| --- | --- |
| `components/visualizer/VisualizerRenderer.tsx` | 背景模式默认值改从 `types/visualizerModes` 取（背景注册表没有引入） |
| `components/visualizer/VisualizerShell.tsx` | 去掉 Folia 的背景渲染器、Folium 舞台层、视频层（YEmusic 在播放页自己画背景）；字体注入、返回按钮与面板热区逻辑不变 |
| `components/visualizer/settingsPanels.tsx` | 只保留 Diorama 与 Claddagh 两个面板（这两种动画的面板写在这个文件里），旧动画（classic / partita / fume / cappella / tilt）的面板去掉 |
| `components/visualizer/sonnet/VisualizerSonnet.tsx` | 一处 import 路径由 `@/` 别名改为相对路径 |
| `hooks/usePlayerBottomBarBottomPx.ts` | 精简替代：YEmusic 的控制条位置固定，只保留动画需要的那部分 |
| `mods/folium/registries/tunings.tsx` | 精简替代：没有 Folium 模组，所有调节项取恒等值 |
| `services/db.ts` | 精简替代：用 IndexedDB 直接实现动画需要的键值缓存（原版是 Dexie） |
| `types/visualizerModes.ts` | 模式列表只保留上面 8 种，默认模式为 `still` |
| `utils/lyrics/parserCore.ts` | 精简替代：YEmusic 自己解析歌词（`src/lib/lyric.ts`，经 `src/ui/player/folia/lyricsAdapter.ts` 转换）；这里只保留动画需要的间奏占位、逐字时间合成（`buildTimedWords`，新增 export）与 `finalizeParsedLyricLines`，函数体与上游一致 |
| `i18n/index.ts`（新增） | 替代 Folia 的 i18n 配置：只加载裁剪后的 `zh-CN.json` / `en.json` |
| `i18n/zh-CN.json`、`i18n/en.json`（生成） | 只含这些代码用到的 252 个键，由 `scripts/gen-folia-locales.mjs` 生成 |

其余文件没有改动。上游文件里保留着原作者的注释与常量写法（包括一些写给 AI 工具的注释、以及不影响运行结果的常量运算），
为保持与上游一致，这里一律原样保留。

## YEmusic 一侧的接入（自有代码）

`src/ui/player/folia/` 是 YEmusic 写的适配层：把 YEmusic 的歌词 / 播放进度 / 配色 / 音频能量转换成 Folia 动画需要的数据，
按需（懒加载）载入动画代码，加载失败时回退到 Luminous；`src/store/foliaTunings.ts` 保存每种动画的参数。
这些文件直接引用了本目录里的 AGPL 代码，因此同样是 AGPL 整体的一部分。

## 更新到更新的 Folia 版本

1. 取新版 folia-major 源码；对本目录的每个文件，先看上面“有修改”的 9 个，其余文件直接用上游同路径的文件覆盖即可
   （引入的文件集合是 8 种动画的 `entry.tsx` / `tuning.ts` 以及它们的静态 import 闭包）。
2. 有修改的文件按上表重新套一遍改动（文件头有说明）。
3. `FOLIA_SRC=<folia-major 目录> node scripts/gen-folia-locales.mjs` 重新生成语言文件。
4. `npm run typecheck && npm run build` 并在播放页逐个检查 8 种动画。

## 分发时需要做的事（AGPL-3.0 第 6 条）

向别人提供安装包 / APK 时，要同时提供对应版本的完整源代码（例如把 `YEmusic-<版本>-source.zip` 放在同一个下载页），
或附上获取源码的书面说明；并保留本目录与 `LICENSE-AGPL-3.0.txt`。
