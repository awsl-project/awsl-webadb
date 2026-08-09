# WebADB Desk

浏览器通过 WebSocket 连接后端，后端再把原始 ADB 流量桥接到本机 `adb server`。前端以桌面环境展示 Android 应用，每个应用运行在独立的 scrcpy 虚拟显示中；USB 和 ADB Wi-Fi 连接统一由服务端 `adb` 管理。

## 特性

- 使用 `bun` 管理依赖与运行脚本
- 前端使用 React + Vite
- 后端使用 Express + WebSocket
- 浏览器端直接调用 `@yume-chan/adb`
- 服务端连接 `@yume-chan/adb-server-node-tcp`
- 使用 `@yume-chan/adb-scrcpy` 与 `@yume-chan/scrcpy-decoder-webcodecs`
- 独立应用窗口、多窗口、最小化、最大化、旋转及自适应缩放
- 支持 1080×1920 竖屏与 1920×1080 横屏虚拟显示，不支持宽屏的应用自动回退竖屏
- 支持画面控制、外部中英文输入、手机软键盘切换和浏览器音频播放
- 应用中文名称与图标、应用中心、文件窗口和设备控制中心
- 桌面应用按设备保存在 Local Storage，可从应用中心添加或移除
- 支持设备选择、ADB Wi‑Fi 连接、文件浏览、上传与下载
- 桌面端与手机端响应式布局，支持 PWA 安装和离线加载界面

## 本机运行

```bash
bun install
adb start-server
bun run dev
```

默认地址：

- 前端开发服务器：`http://0.0.0.0:5173`
- 后端 bridge：`http://0.0.0.0:3000`
- ADB Server：`127.0.0.1:5037`

可选环境变量：

```bash
PORT=3000
HOST=0.0.0.0
ADB_SERVER_HOST=127.0.0.1
ADB_SERVER_PORT=5037
ALLOWED_ORIGINS=https://webadb.example.com
```

生产构建：

```bash
bun run build
bun run start
```

## 容器化

当前仓库支持两种方式：

1. 本机运行
- Web 前后端在本机运行
- 使用本机 `adb server`

2. 容器运行
- 容器里跑前端静态文件和后端 ADB bridge
- 容器里自动启动 `adb server`
- 不处理 USB，只处理 ADB Wi‑Fi

镜像地址：

- `ghcr.io/awsl-project/awsl-webadb:latest`
- `ghcr.io/awsl-project/awsl-webadb:v0.2.0`

直接拉镜像运行：

```bash
docker run --rm \
  -p 3000:3000 \
  -p 5037:5037 \
  -v awsl-webadb-data:/var/lib/awsl-webadb \
  ghcr.io/awsl-project/awsl-webadb:latest
```

固定版本运行：

```bash
docker run --rm \
  -p 3000:3000 \
  -p 5037:5037 \
  -v awsl-webadb-data:/var/lib/awsl-webadb \
  ghcr.io/awsl-project/awsl-webadb:v0.2.0
```

访问：

- `http://127.0.0.1:3000`
- `adb -H 127.0.0.1 -P 5037 devices`

说明：

- 当前 `Dockerfile` 会安装 `adb`
- 容器内 Web 服务会先编译成单个可执行文件再运行
- 容器运行层不再依赖 Bun 和 `node_modules`
- 容器把 `HOME` 固定到 `/var/lib/awsl-webadb`
- 请持久化 `/var/lib/awsl-webadb`，这样 `~/.android` 下的认证文件和 Wi‑Fi 配对缓存不会丢
- 容器启动会自动执行 `adb -a start-server`
- 后端 bridge 默认连容器内的 `127.0.0.1:5037`
- 容器会同时暴露 `3000` 和 `5037`
- 设备连接方式是 `adb connect <ip:port>`
- `adb pair <ip:port> <code>` 和 `adb connect <ip:port>` 都可以在页面里完成
- 这套方案不支持 USB 直通
- 通过反向代理部署时，请用 `ALLOWED_ORIGINS` 配置允许访问 WebSocket bridge 的完整来源，多个来源用逗号分隔
- 正式环境建议使用 HTTPS，以启用完整的 PWA、剪贴板和浏览器音频能力

容器内 ADB Wi‑Fi 的链路是：

- `Web App Container -> Container adb server -> Wi-Fi Device`

## 开源说明

本项目只使用公开开源能力，没有复制参考仓库的私有服务或闭源资产。核心依赖：

- `@yume-chan/adb`
- `@yume-chan/adb-server-node-tcp`

参考仓库：`https://github.com/yume-chan/ya-webadb`

对应声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
