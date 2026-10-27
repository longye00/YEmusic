# 已退役的内置音源

0.1.x / 0.2.0 自带、经 2026-10 实测已失效的洛雪自定义源，仅作存档，不再打包进程序：

| 文件 | 名称 | 失效原因 |
| --- | --- | --- |
| lx-music-source-v3.js | 微信公众号：洛雪音乐 | 服务器 88.lxmusic.xn--fiqs8s 返回 502 / 超时；脚本带有篡改检测（改名会占满内存） |
| Huibq.js | Huibq_lxmusic源 | lxmusicapi.onrender.com 返回 503（服务已被所有者停用） |
| 野花.js | 野花🌷 | flower.tempmusics.tk 域名无法解析 |
| 野草.js | 野草🌾 | grass.tempmusics.tk 域名无法解析 |

升级到 0.3.0 时，已安装的这几个内置音源会被自动停用（不会删除，可在“设置 → 音源”中重新启用或删除）。
