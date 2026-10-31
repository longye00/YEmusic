# YEmusic 0.5.3

融合 **洛雪音乐（lx-music）自定义音源生态** 与 **Folia 风格沉浸式界面** 的音乐播放器：**Windows 桌面版（Electron）** 与 **Android 版（Capacitor）**，
共用同一套界面、播放引擎与音源运行环境。内置 **10 种歌词动画**（其中 8 种来自 Folia，见文末「许可」）。

> 0.5.3 是一次安全与性能加固：主进程全部出网请求增加 DNS rebinding 防护（解析结果必须是公网 IP）、
> 渲染进程读文件增加目录白名单（与写白名单同机制）、音频代理令牌改为密码学随机；
> 渲染层做了 vendor 分包，主包体积约降 32%。详见 `CHANGELOG.md`。

| 产物 | 说明 |
| --- | --- |
| `YEmusic-setup-<版本>.exe` | Windows x64 安装包（按用户安装，无需管理员） |
| `YEmusic-<版本>-android.apk` | Android 7.0+（API 24）安装包，v2 签名 |
| `YEmusic-<版本>-source.zip` | 对应版本的完整源码（按 AGPL-3.0 分发安装包 / APK 时需要一并提供，见文末「许可」） |

## 目录结构
```
electron/        主进程（窗口、托盘、任务栏按钮、网络转发、音频代理、下载与标签写入、本地曲库扫描）
android/         Android 工程（Capacitor 外壳 + 自写原生插件：网络 / 音频代理 / 本地文件(SAF) / 下载 / 标签 / 媒体通知）
src/             渲染进程（React + TypeScript + Tailwind），桌面与 Android 共用
  plugins/       LX 自定义音源运行环境（每个音源独立 Worker）与预置音源（YEmusic 聚合音源 + 全豆要）
  sdk/           五大平台接口：搜索 / 歌单广场 / 排行榜 / 歌词（QQ、网易云、酷狗、酷我、咪咕）
  player/        播放引擎、取链（音质降级 → 换源 → 跨平台同名匹配，带超时预算与熔断）、歌词
  store/         状态（zustand）：播放器、曲库、音源、设置、下载、界面、Folia 动画参数
  ui/            界面：乐库拼贴墙 / 封面流首页、详情页、搜索、沉浸式播放页、设置等
    player/folia/  Folia 歌词动画的接入层（YEmusic 自己写的适配代码）
  lib/host.ts    宿主抽象：桌面（Electron preload）/ Android（Capacitor 插件）/ 浏览器
  folia/         Folia 的歌词动画代码（第三方，AGPL-3.0，见 src/folia/VENDOR.md）
shared/          主进程、Android 与渲染进程共用的配置（平台接口域名白名单）
sources/         聚合音源的子音源脚本（merged/subs）与已停用的旧音源（retired）
scripts/         构建脚本：build-merged-source.mjs（聚合音源）、build-electron.mjs、build-android.mjs、make-icons.py、gen-folia-locales.mjs
packaging/       Windows 安装包（NSIS）脚本
build/           图标（icon-source.png 为源图，其余由 scripts/make-icons.py 生成）
```

## 开发与构建
需要 Node.js 22+。
```bash
npm install
npm run typecheck          # TypeScript 类型检查
npm run build              # 类型检查 + 打包渲染进程(dist/) + 打包主进程(dist-electron/)
npx electron .             # 运行（需要先 build）
```
渲染层分包策略见 `vite.config.ts`：react / framer-motion / i18next 各拆一个稳定 vendor chunk（升级版本时缓存不失效）；
three.js / pixi.js 刻意不手动分组——它们只被懒加载的可视化器引用，打包器会自动在异步 chunk 间共享，
手动分组反而会让主包静态依赖大 chunk。

### 生成 Windows 安装包
需要：Windows x64 版 Electron 44 运行时（解压后的 `electron-v44.x-win32-x64` 目录；0.5.0 用的是 44.7.0）、NSIS 3（`makensis`，Linux 上也可以用发行版的 `nsis` 包，
并设置 `NSISDIR` 指向它的数据目录）、以及打包依赖 `npm i -D @electron/asar resedit pe-library`（或用 `--tools <含 node_modules 的目录>` 指定）。
```bash
npm run build
node packaging/build-win.mjs --runtime <electron-win32-x64 目录> [--makensis <makensis 路径>] [--out release]
```
脚本会：组装 `resources/app.asar` → 写入 exe 多尺寸图标与版本信息 → 关闭 RunAsNode / NODE_OPTIONS / --inspect 熔断
→ 用 `packaging/installer.nsi` 生成 `release/YEmusic-setup-<版本>.exe`。

安装包说明：按用户安装（无需管理员），默认目录 `%LOCALAPPDATA%\Programs\YEmusic`；
会自动识别并移除 0.1.x 旧版程序文件（用户数据保留）；安装 / 卸载前会自动关闭正在运行的 YEmusic；
卸载时可选是否删除用户数据（`%APPDATA%\YEmusic`，默认保留）。支持 `/S` 静默安装、`/D=<目录>` 指定目录。

### 生成 Android APK
需要：Node.js 22+、**JDK 21**、Android SDK（`platforms;android-36`，`build-tools` 35 或更新），
用环境变量 `ANDROID_HOME`（或 `android/local.properties` 里的 `sdk.dir=…`）指向 SDK。
注意 SDK 目录名必须精确匹配：`android-36.1` 不能当作 `android-36` 使用（AGP 会校验包 ID 与目录一致），
`build-tools/35.0.0` 缺失时 `assembleRelease` 会报 `Failed to find Build Tools revision 35.0.0`。
```bash
npm install
npm run android:apk        # = tsc 类型检查 → vite build → cap sync android → gradlew assembleRelease
                           #   → release/YEmusic-<版本>-android.apk
```
- 只改了原生代码时可以 `node scripts/build-android.mjs --skip-web` 跳过前端打包。`npm run android:sync` 只同步前端到 Android 工程（再用 Android Studio 打开 `android/` 调试）。
- **签名**：`android/keystore.properties` 存在时自动签名，内容形如
  ```properties
  storeFile=yemusic-release.jks
  storePassword=<密钥库密码>
  keyAlias=yemusic
  keyPassword=<密钥密码>
  ```
  密钥库用 `keytool -genkeypair -v -keystore android/yemusic-release.jks -alias yemusic -keyalg RSA -keysize 4096 -validity 36500` 生成。
  **请自己保管好密钥库与密码**（它们不进版本库）：以后的更新必须用同一把密钥签名，否则无法覆盖安装已有版本。
  没有 `keystore.properties` 时会产出 `YEmusic-<版本>-android-unsigned.apk`，需自行用 `apksigner` 签名。
- 版本号：`versionName` / `versionCode` 写在 `android/app/build.gradle`（`package.json` 的 `version` 用于桌面版与产物文件名），发新版时两处一起改。
- 包名 `app.yemusic.player`，`minSdk 24`、`targetSdk 36`；权限只有网络（含 Wi-Fi 状态）、唤醒锁（息屏后继续播放）、前台媒体服务与通知；本地音乐通过系统文件夹选择器（SAF）授权，不申请“所有文件”权限。

### Android 版与桌面版的差异
- 本地音乐：在乐库的「本地」（或 设置 → 曲库与数据）里添加音乐文件夹 / 音乐文件（系统选择器，持久授权）。下载默认保存在应用的音乐目录并自动并入本地曲库，也可在 设置 → 下载 里改选文件夹。
- 通知栏 / 锁屏媒体控件与耳机线控由前台媒体服务提供（Android 13+ 首次播放会请求通知权限，拒绝后仍可播放）。返回键逐层关闭界面，最外层时退到后台。
- 没有窗口控制、托盘、键盘快捷键；歌曲菜单用长按代替右键。

### 更新图标
`build/icon-source.png`（1024×1024，透明底的圆角方形）是图标源图；`npm run icons`（需要 `pip install pillow numpy`）
生成托盘 / 关于页图标、Android 启动图标（含自适应与单色主题图标）与安装向导图，`python3 scripts/make-icons.py --ico` 同时重新生成 `build/icon.ico`。

### 应用内更新（发版流程）
应用启动后会检查一次新版本，发现新版时弹窗提示并在应用内下载安装（Android 下完调起系统安装器，Windows 下完运行安装包）；
设置 → 关于里也有「检查更新」按钮。清单读取顺序是 GitHub Release 里的 `update.json`，连不上时回退到 jsDelivr 上的仓库副本。

发布一个版本：
```bash
# 1. 改版本号：package.json 的 version、android/app/build.gradle 的 versionName 与 versionCode（三处一起）
# 2. 生成清单（写入仓库根的 update.json）
node scripts/make-update-manifest.mjs --notes "本次更新说明"
# 3. 构建两个安装包
npm run android:apk                                   # → release/YEmusic-<版本>-android.apk
npm run build && node packaging/build-win.mjs --runtime <electron-win32-x64>   # → release/YEmusic-setup-<版本>.exe
```
4. 在 GitHub 上建一个 Release，tag 用 **`latest`**（应用请求的是 `releases/latest/download/…`，用别的 tag 名就取不到），
   把 `release/YEmusic-<版本>-android.apk`、`release/YEmusic-setup-<版本>.exe` 和仓库根的 `update.json` 三个文件都传上去。
   文件名要与 `update.json` 里的 `android` / `windows` 字段一致（脚本已按版本号自动写好）。
   `update.json` 也留在仓库根目录，这样 jsDelivr 的兜底地址才有内容。

要点：
- 仓库地址写在 `src/lib/updater.ts` 顶部的 `OWNER` / `REPO`，换仓库只改这两行。
- `update.json` 的域名要能被网络层放行：桌面版的白名单在 `shared/proxy-hosts.json`，Android 原生层读同一份文件
  （`android/app/build.gradle` 把 `shared/` 加进了 assets），已包含 `github.com` / `githubusercontent.com` / `jsdelivr.net`。
- APK 下载走的是 `Downloader`（只校验公网域名，不受白名单限制），安装包落在 `cacheDir/updates`，
  由 `FileProvider`（authority `<包名>.apkprovider`，路径见 `android/app/src/main/res/xml/apk_paths.xml`）共享给系统安装器。
  首次更新时系统会要求允许本应用「安装未知应用」；`installApk` 只接受缓存目录里的文件，不接受任意路径。
- 清单拉不到（离线、仓库还没发版、格式不对）时静默跳过，不弹错误提示。

## 安全设计（桌面版）
- **进程隔离**：`contextIsolation` + `sandbox`，渲染进程只能通过 preload 显式列出的 30 个 IPC 通道访问主进程，没有通用 invoke 后门。
- **网络出口**：所有主进程出网请求（`ye:fetch` 系列 / 音频代理上游 / 下载）经 `electron/net.cjs` 统一处理：
  协议白名单、逐跳校验的重定向跟随、响应体大小限制；`isPublicHost` 拒绝内网域名/字面量，`publicLookup` DNS 钩子在连接前校验解析结果
  （拒绝私有段、CGNAT、IPv6 ULA/链路本地），防 DNS rebinding。平台元数据接口另有域名白名单（`shared/proxy-hosts.json`）。
- **文件系统**：写入限制在下载/音乐/文档/userData 与用户在对话框中选择过的目录（`allowed-dirs.json`）；读取同机制（0.5.3 新增），
  文件对话框选中文件后其所在目录自动放行。
- **音频代理**：只监听 127.0.0.1，随机端口，访问凭据为 `crypto.randomBytes` 令牌（本地文件 / 远程流分开授权），不是任意转发器。
- **音源脚本**：在独立 Web Worker 中运行，网络请求全部经主进程代理并做公网校验 + 用户屏蔽名单。
- **Electron fuses**：RunAsNode / NODE_OPTIONS / --inspect 在打包时关闭。

## 播放链接的两条通道
解析播放链接（`src/player/resolver.ts`）时按顺序尝试两条通道，先拿到可用链接的胜出：

1. **平台官方通道**（`src/sdk/official.ts`，设置 → 播放 → 「优先用平台官方接口取播放链接」，默认开）：
   直接用平台自己的播放接口取链，**带上已登录账号的凭据**，所以 VIP 歌曲能拿到会员音质（无损 / Hi-Res），
   链接来自平台自己的 CDN，不受第三方音源存活情况影响。网易云对游客也开放（上限 320k）；
   QQ音乐 / 酷狗的官方接口未登录一律拒绝，因此只在已登录时尝试。
   平台按会员等级降档时以平台回答的实际档位为准（请求无损却只给 320k 就记作 320k），
   并先让音源脚本按请求档位试一次，脚本也拿不到时才用降档链接兜底；只有试听片段的链接直接弃用。
   官方通道的失败**不计入**音源脚本的熔断与降权统计。
2. **洛雪音源脚本**：见下面「聚合音源」。官方通道拿不到时逐档、逐源竞速。

两条都失败才会按「歌名 + 歌手 + 时长」到其他平台匹配同一首歌。下载走的是同一条解析链路。
没有装任何音源脚本时，只要官方通道可用（网易云，或已登录 QQ音乐 / 酷狗）依然能播放。

## 聚合音源
`src/plugins/presets/yemusic-merged.js` 是把多个 LX 音源合成一个的脚本，可以直接导入洛雪音乐 / YEmusic。
子音源放在 `sources/merged/subs/`，调度逻辑在 `sources/merged/runtime.js`，修改后运行
`node scripts/build-merged-source.mjs` 重新生成。每个平台按顺序竞速（前一个没在限定时间内返回就同时启动下一个），
先拿到可用链接的胜出；某个子源失败会自动换下一个，播放器重试时会排除上次失败的子源。

## 乐库（Folia 式首页）
默认首页为「乐库」：可无限拖动的封面拼贴墙中间夹着一张**书签**——墙在书签处被撕开，书签跟着墙一起移动。
书签上切换 歌单 / 电台 / 专辑 / 本地 / 广场 / 榜单，可收成 64px 的书脊（窄窗口自动切换），或整张收起、只在屏幕边上留一个「乐库」标签。
拖动、滚轮（Shift + 滚轮横向）、方向键（Shift 加速）都可以平移，Home 回到起点，`/` 过滤当前页，
点击卡片打开、双击直接播放。

**在线平台账号（可选）**：网易云音乐（桌面端扫码 / 安卓端手机验证码）、QQ音乐（QQ / 微信扫码）、酷狗音乐（扫码），都支持粘贴 Cookie 备用。安卓端不提供扫码入口（手机上"存二维码到相册再去扫一扫"太绕），网易云用手机验证码、QQ音乐与酷狗用 Cookie。
登录在书签里完成；点书签底部的头像可在已登录的平台之间切换，乐库会显示该平台你创建 / 收藏的歌单与专辑
（网易云还会按你的口味生成私人FM 与每日推荐）。凭据只保存在本机，不登录也能用通用推荐。设置 → 外观 → 首页布局 可切回封面流。

## 歌词动画
播放页右侧面板 → 歌词（以及 设置 → 歌词）里选择歌词动画：YEmusic 自带 **光晕（Luminous）**、**滚动（Flow）**，
以及从 [Folia](https://github.com/chthollyphile/folia-major) 引入的 v0.5.0 起新增的 **8 种**：

| 动画 | 英文名 | Folia 首次出现 | 效果 |
| --- | --- | --- | --- |
| 莫奈 | Monet | 0.5.0 | 海报式歌词轨道，右侧肖像与底部频谱（可上传自定义肖像图） |
| 回环 | Claddagh | 0.5.23 | 歌词沿环形轨道回旋，随节奏起伏 |
| 镜台 | Diorama | 0.5.27 | 程序化 3D 歌词穿梭，随歌词运镜 |
| 时计 | Pendolo | 0.6.3 | 弧形歌词轮盘与钟表擒纵机芯 |
| 商籁 | Sonnet | 0.6.9 | 日式动态图形（MG）歌词 PV |
| 凝彩 | Tempera | 0.6.20 | 色块构图的歌词 PV |
| 静止 | Still | 0.6.22 | 低资源占用的静态排版 |
| 绘光 | Lumière | 0.7.10 | 舞台灯光：体积光、烟雾与光学线稿 |

选中后面板里会出现「<动画名> · 动画参数」（Folia 各动画自带的细调面板，静止没有可调项），参数按动画分别保存。
动画代码按需加载（选中才下载），在当前设备上跑不起来（例如没有 WebGL）时自动退回光晕。
代码在 `src/folia/`（Folia v0.7.20，AGPL-3.0），引入范围、与上游的差异和更新方法见 `src/folia/VENDOR.md`；
YEmusic 一侧的接入层在 `src/ui/player/folia/`。没有引入 v0.5.0 之前的动画（classic / cadenza / partita / fume）、cappella、tilt，
以及 Folia 的背景渲染器、Folium 模组、AI 主题生成等。

## 快捷键（桌面版）
| 按键 | 功能 |
| --- | --- |
| Space | 播放 / 暂停 |
| Ctrl + ← / → | 上一首 / 下一首 |
| 方向键 / Shift + 方向键（乐库） | 平移拼贴墙 |
| Home（乐库） | 回到起点 |
| /（乐库） | 过滤当前页 |
| Ctrl + ↑ / ↓ | 音量 |
| ← / →（播放页） | 快退 / 快进 5 秒 |
| Ctrl + K / Ctrl + F | 搜索 |
| Ctrl + P | 打开 / 关闭播放页 |
| Ctrl + , | 设置 |
| L / M | 喜欢 / 静音 |
| F11 | 全屏 |
| Esc | 逐层关闭 |

## 许可
- YEmusic 自有代码：**Apache License 2.0**（`LICENSE`）。
- `src/folia/` 中的 Folia 歌词动画代码：**GNU AGPL-3.0**（`LICENSE-AGPL-3.0.txt`，© chthollyphile 及 Folia 贡献者）。
- **因此包含这些代码的整体程序（Windows 安装包、Android APK）按 AGPL-3.0 分发**：把安装包 / APK 交给别人时，要同时提供对应版本的完整源码
  （例如把 `YEmusic-<版本>-source.zip` 放在同一个下载页）或附上获取源码的书面说明，并保留许可文本与版权声明（细则见 AGPL-3.0 第 6 条）。
  只自己使用不受此限；若要发布不含 Folia 代码的版本，需要移除 `src/folia/`、`src/ui/player/folia/`、`src/store/foliaTunings.ts` 以及它们在播放页 / 设置里的引用（并把 `package.json` 的许可证改回 Apache-2.0）。
- 其它第三方库与参考的项目见 `THIRD_PARTY_NOTICES.md`，更新内容见 `CHANGELOG.md`。
