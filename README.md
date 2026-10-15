# WebADB Desk

通过网页桌面或 CLI 管理、打开并操作 Android 应用。两者使用同一个后端应用会话：CLI 打开的应用会出现在网页，网页中的点击、输入、最小化与关闭也会反映到 CLI。USB 和 Wi-Fi 连接统一由服务端的 ADB 管理。

## 功能

- One Half 明暗主题、跟随系统、本地字体与图标、桌面收藏和 PWA 更新提示。电脑使用多窗口工作台，手机采用双列工具、全屏应用和触控布局。
- 设备发现、授权状态、Wi-Fi 配对与连接、设备信息、电池状态及原屏镜像。
- 独立应用窗口、横竖屏、调整分辨率、触摸、拖动、滚轮、按键与文字输入。
- 单应用 JPEG 截图、无障碍 XML / JSON 元素树、元素点击及坐标操作，网页与 CLI 都可使用。
- 文件目录导航、搜索、排序、上传下载、进度显示；覆盖文件前确认。大文件在支持 File System Access 的浏览器中流式保存。
- 图片、视频、媒体链接三种来源作为系统虚拟摄像头输入，网页和 CLI 均支持后台推流。

默认即可控制，没有只读模式或模式切换确认。打开应用不会启动文件摄像头；选择文件也不会开始推流。必须手动点击“开始推流”，点击“停止推流”后释放相机。标题栏的声音按钮用于手动播放手机音频输出；目前没有麦克风推流功能，不会采集电脑麦克风。

## 本机运行

电脑和手机浏览器使用同一个服务。首页分为工具区和收藏应用区；系统摄像头在电脑上并排显示配置与预览，在手机上可独立滚动，底部推流操作始终可见。收起面板不会停止后台推流。

需要 Bun 1.4.3 或更新版本、Android Platform Tools，以及已允许 USB 调试的手机。文件摄像头还需要后端安装 FFmpeg（可用 `FFMPEG_PATH` 指定可执行文件）；容器已包含 FFmpeg：

```bash
bun install
adb start-server
bun run dev
```

- 开发网页：`http://127.0.0.1:5173`
- 后端 / CLI 服务：`http://127.0.0.1:3000`
- ADB Server：`127.0.0.1:5037`

生产运行：

```bash
bun run check
bun test
bun run build
bun run start
```

原屏镜像使用 scrcpy 4.1。独立应用会话通过 Android VirtualDevice、VirtualTouchscreen、ImageReader 和 UiAutomation 提供黑屏手机上的画面与操作，当前真机验收环境为 Android 16。独立窗口和文件摄像头需要 ROM 实现相应系统接口并允许 ADB shell 创建虚拟设备；不支持时返回错误，不尝试 root。应用本身也可能限制多屏、截图或音频捕获。

可配置 `PORT`、`HOST`、`ADB_SERVER_HOST`、`ADB_SERVER_PORT`、`STATIC_DIR` 与 `ALLOWED_ORIGINS`。默认仅监听本机；需要可信局域网访问时显式设置 `HOST=0.0.0.0`。生产反向代理请配置允许的完整来源，例如 `ALLOWED_ORIGINS=https://webadb.example.com`；多个来源用逗号分隔。本服务提供完整 ADB 控制能力，远程访问应使用具备身份验证的 HTTPS 代理。

## CLI

`awsl-webadb` 是同时包含服务端和客户端的单个可执行文件，不需要额外安装 Bun、Node.js 或 `node_modules`。网页、字体、scrcpy server 与手机 helper 均内置，复制二进制后可从任意目录启动。运行服务端的电脑仍需 ADB server；媒体推流需要 FFmpeg。

```bash
# 终端一：启动服务端，提供网页、API 与后台推流
adb start-server
awsl-webadb serve --host 127.0.0.1 --port 3000

# 终端二：同一个可执行文件作为客户端
awsl-webadb devices
awsl-webadb --url http://127.0.0.1:3000 sessions

# 查看帮助和版本
awsl-webadb --help
awsl-webadb --version
```

`serve` 还接受 `--adb-host`、`--adb-port`、`--ffmpeg` 和 `--static-dir`；也兼容原来的环境变量。网页地址默认为 `http://127.0.0.1:3000`。服务端需要持续运行，客户端命令执行完就退出；远程客户端通过 `--url` 或 `WEBADB_URL` 连接同一服务。源码开发也可用 `bun run serve` 和 `bun run cli …`。

```bash
awsl-webadb devices
awsl-webadb open com.miui.calculator --device 1
awsl-webadb sessions
awsl-webadb screenshot SESSION --output app.jpg
awsl-webadb xml SESSION --output app.xml
awsl-webadb elements SESSION
awsl-webadb click SESSION --text "1"
awsl-webadb click SESSION --resource-id com.example:id/button
awsl-webadb click SESSION --description "确定"
awsl-webadb click SESSION --node e12
awsl-webadb tap SESSION 100 200
awsl-webadb swipe SESSION 100 800 100 200 --duration 300
awsl-webadb text SESSION "你好" --resource-id com.example:id/input
awsl-webadb key SESSION BACK
awsl-webadb close SESSION
```

`SESSION` 是 `open` 返回的会话 ID，`--device` 使用 `devices` 返回的 transport ID。只有一台设备时可省略。通过 `--url http://host:3000` 或 `WEBADB_URL` 指定服务。`open --width 1080 --height 1920` 可设置显示尺寸；再次打开同一设备上的同一应用会复用会话并同步焦点。

坐标以会话的原始显示尺寸为准。XML 为带 `parentId` 的元素列表；元素 ID 只代表最近一次读取结果，页面变化后应重新读取。未指定元素的 `text` 写入当前焦点输入框；游戏、Canvas 或不提供无障碍节点的页面可通过截图坐标操作。网页每个应用底部的“页面与元素”按钮提供同样的截图、XML、分辨率、元素、按键和坐标操作。

浏览器关闭不会结束后端应用会话。没有读取或操作的应用会话在 15 分钟后自动释放；关闭窗口或 CLI `close` 会立即释放。服务器退出时清理本次创建的显示、临时 JAR、伴生关联和端口转发，不解锁或点亮手机主屏。

构建统一程序：`bun run build:binary`（`build:cli` 为兼容别名），输出 `bin/awsl-webadb`。GitHub Release 同时提供四份二进制及 `SHA256SUMS`：

| 平台 | 文件 |
| --- | --- |
| Linux x64 | `awsl-webadb-linux-amd64` |
| Linux arm64 | `awsl-webadb-linux-arm64` |
| macOS Intel | `awsl-webadb-macos-amd64` |
| macOS Apple Silicon | `awsl-webadb-macos-arm64` |

下载对应文件后 `chmod +x` 并重命名为 `awsl-webadb`；每份文件都兼具服务端与客户端能力。构建冒烟检查：`node scripts/smoke-binary.mjs bin/awsl-webadb`，从空目录核对服务、客户端、参数、来源限制及所有内置资源。

## 文件摄像头

在桌面或设置中打开“系统摄像头”，选择“图片”“视频”或“媒体链接”，手动开始推流。媒体链接接受 HTTP(S) 图片 / 视频直链和 HLS、RTSP、RTMP 视频流，不接受普通网页地址。输入链接时必须选择“图片直链”“视频直链”或“实时视频流”，按明确类型处理。图片持续发送静止画面，视频循环播放，暂停时保留当前帧。输出固定为 **960 × 1280（宽 × 高，竖屏 3:4）**：按长边等比缩放，居中补黑，不拉伸、不裁剪。没有音轨，原始文件不复制到手机存储。

同一设备的 WebADB 应用窗口共享前后虚拟摄像头，两者使用相同输入源；手机主屏应用保持原有摄像头行为。正式来源由后端 FFmpeg 解码并持有，关闭网页或 CLI、收起面板及关闭应用窗口后继续推流。其他客户端能看到共享来源、暂停状态和手机确认的帧数，可以切换、暂停或停止。后台服务必须持续运行；设备断开、停止推流或服务退出时释放本次资源。启停相机会重建虚拟设备中的应用显示，应用是否保留页面取决于其自身行为。

```bash
awsl-webadb camera start ./image.png
awsl-webadb camera start ./video.mp4
awsl-webadb camera start https://host/video.mp4 --kind video
awsl-webadb camera start rtsp://host/live --kind stream
awsl-webadb camera start https://host/live.m3u8 --kind stream
awsl-webadb camera status
awsl-webadb camera pause
awsl-webadb camera resume
awsl-webadb camera stop
```

`camera start` 成功后立即返回，服务后台继续供帧。多设备用 `--device` 选择；CLI 链接必须用 `--kind image|video|stream` 明确指定类型。本地文件先流式上传到运行后端的电脑，停止或切换后删除临时副本；原文件不会写入手机。视频流暂停时冻结送往手机的画面，恢复后读取最新帧。

内部联调页面 `camera-test.html` 用于在 Android Chrome 中检查相机画面，产品界面不提供该测试入口。开始推流后，在该页面打开摄像头并允许网站访问，使用真实 `getUserMedia()` 和 `BarcodeDetector` 核对画面与二维码。不会自动访问扫码链接。验收网页通过随机 ADB reverse 端口访问运行后端的电脑，要求 ADB server 与 WebADB 服务运行在同一台机器；远程容器需要自行保证该路径可达。

需要 Android 16 的 VirtualCamera API，具体兼容性依 ROM 而定。小米隐身模式、系统相机隐私开关或 Chrome 权限可能阻止相机读取；服务不会修改这些系统隐私设置，也不会全局授予 Chrome 相机权限。扫码验收仅在本次虚拟设备上下文授权，并在结束时撤销。本机已完成 960 × 1280 视频扫码与实时时钟画面验收；详细验证范围见 [验证记录](docs/verification.md)。

手机主屏可保持黑屏。应用预览最多约 8 FPS、宽度 720 像素；保存的截图使用应用原始分辨率。虚拟相机声明 30 FPS，后台视频按最高 12 FPS 处理，实际送帧速率受媒体和 ADB 通道影响。`camera-clock.html` 是额外的浏览器画布验收工具，显示当前时间和二维码，用于观察画面变化；该工具依赖页面保持打开，不属于正式后台媒体来源。

重建手机 helper：

```bash
CAMERA_JAVA_HOME=/path/to/jdk-21 \
CAMERA_ANDROID_JAR=/path/to/android-16-system-api.jar \
CAMERA_R8_JAR=/path/to/r8.jar \
bash scripts/build-camera.sh
```

仓库内提供已编译的 `public/camera/webadb-camera.jar`。构建使用 Android 16 系统 API stubs 或对应 Robolectric `android-all.jar`、Java 21 与 R8 / D8，输出 Java 17 字节码及 DEX；构建工具不进入手机 helper。

## 容器

```bash
docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -p 127.0.0.1:5037:5037 \
  -v awsl-webadb-data:/var/lib/awsl-webadb \
  ghcr.io/awsl-project/awsl-webadb:latest
```

容器自动启动 ADB server，使用 Wi-Fi 设备，不支持 USB 直通。持久化目录保存 ADB 授权密钥与配对缓存。也可以用 `docker compose up --build`。镜像与独立发行版使用同一个程序，可通过 `docker exec CONTAINER /app/awsl-webadb devices` 调用客户端；保留 `/app/webadb` 兼容软链接。

发布流水线运行类型检查、回归测试和前端构建，然后生成 CLI、构建 Linux amd64 / arm64 镜像并发布 GitHub Release。字体本地提供，更新字体使用 `scripts/fetch-fonts.py`；界面图标直接引用 Lucide SVG。PWA 离线只提供页面，设备操作仍需后端连接。

开源依赖与构建工具说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 界面开发

通用控件使用 shadcn/ui（Radix），布局使用 Tailwind CSS 4，图标统一使用 Lucide SVG。配置见 `components.json`，组件源码位于 `src/components/ui`；新增组件可运行 `bunx shadcn@latest add <组件名>`。主题色通过 `src/styles/ui.css` 映射 One Half 变量。原有窗口与设备画面样式放在 `legacy` CSS 层，组件样式和工具类在其后，避免反复覆盖。

应用中心、连接、设置、控制、摄像头及元素面板按需加载。新增界面优先组合现有组件，不新增测试入口或复制按钮、弹层和焦点管理逻辑。

## Homebrew 发布集成

本项目使用 Formula 安装命令行程序；同组织的 maxx 为桌面应用，使用 Cask。发布流程按系统和 CPU 架构选择上述四份二进制，用 `SHA256SUMS` 生成 `awsl-webadb.rb`，随 Release 一起提供。Formula 安装 FFmpeg，并提供 `brew services` 服务定义；ADB 按平台单独安装。

当 Formula 已更新到 `awsl-project/homebrew-awsl` 后，使用：

```bash
brew install awsl-project/awsl/awsl-webadb
# macOS 安装 ADB；Linux 使用发行版的软件包管理器安装 adb
brew install --cask android-platform-tools
adb start-server
brew services start awsl-project/awsl/awsl-webadb
awsl-webadb devices
```

仓库的 `HOMEBREW_TAP_TOKEN` secret 需要具备 `awsl-project/homebrew-awsl` 的 Contents 写入权限，才能在发布成功后自动更新 `Formula/awsl-webadb.rb`。可使用授予本仓库访问权限的同名组织 secret。未配置时明确跳过自动更新，不影响二进制与容器发布；配置后可手动运行 **Update Homebrew Formula** workflow，传入已发布版本补更新。不要将 token 写入源码或聊天。

参考：[maxx 的 Homebrew 更新流程](https://github.com/awsl-project/maxx/blob/main/.github/workflows/update-homebrew.yml)、[Homebrew Formula 与服务定义](https://docs.brew.sh/Formula-Cookbook#service-files)。
