# WebADB Desk

通过网页桌面或 CLI 管理、打开并操作 Android 应用。两者使用同一个后端应用会话：CLI 打开的应用会出现在网页，网页中的点击、输入、最小化与关闭也会反映到 CLI。USB 和 Wi-Fi 连接统一由服务端的 ADB 管理。

## 功能

- One Half 明暗主题、跟随系统、本地字体与图标、桌面收藏、移动端布局和 PWA 更新提示。
- 设备发现、授权状态、Wi-Fi 配对与连接、设备信息、电池状态及原屏镜像。
- 独立应用窗口、横竖屏、调整分辨率、触摸、拖动、滚轮、按键与文字输入。
- 单应用 JPEG 截图、无障碍 XML / JSON 元素树、元素点击及坐标操作，网页与 CLI 都可使用。
- 文件目录导航、搜索、排序、上传下载、进度显示；覆盖文件前确认。大文件在支持 File System Access 的浏览器中流式保存。
- 图片、视频、媒体链接三种来源作为系统虚拟摄像头输入，网页和 CLI 均支持后台推流。

默认即可控制，没有只读模式或模式切换确认。打开应用不会启动文件摄像头；选择文件也不会开始推流。必须手动点击“开始推流”，点击“停止推流”后释放相机。标题栏的声音按钮用于手动播放手机音频输出；目前没有麦克风推流功能，不会采集电脑麦克风。

## 本机运行

需要 Bun、Android Platform Tools，以及已允许 USB 调试的手机。文件摄像头还需要后端安装 FFmpeg（可用 `FFMPEG_PATH` 指定可执行文件）；容器已包含 FFmpeg：

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

CLI 只需要后端运行，不需要浏览器。可以运行 `bun run serve`，或连接现有的生产服务。

```bash
bun run cli devices
bun run cli open com.miui.calculator --device 1
bun run cli sessions
bun run cli screenshot SESSION --output app.jpg
bun run cli xml SESSION --output app.xml
bun run cli elements SESSION
bun run cli click SESSION --text "1"
bun run cli click SESSION --resource-id com.example:id/button
bun run cli click SESSION --description "确定"
bun run cli click SESSION --node e12
bun run cli tap SESSION 100 200
bun run cli swipe SESSION 100 800 100 200 --duration 300
bun run cli text SESSION "你好" --resource-id com.example:id/input
bun run cli key SESSION BACK
bun run cli close SESSION
```

`SESSION` 是 `open` 返回的会话 ID，`--device` 使用 `devices` 返回的 transport ID。只有一台设备时可省略。通过 `--url http://host:3000` 或 `WEBADB_URL` 指定服务。`open --width 1080 --height 1920` 可设置显示尺寸；再次打开同一设备上的同一应用会复用会话并同步焦点。

坐标以会话的原始显示尺寸为准。XML 为带 `parentId` 的元素列表；元素 ID 只代表最近一次读取结果，页面变化后应重新读取。未指定元素的 `text` 写入当前焦点输入框；游戏、Canvas 或不提供无障碍节点的页面可通过截图坐标操作。网页每个应用底部的“页面与元素”按钮提供同样的截图、XML、分辨率、元素、按键和坐标操作。

浏览器关闭不会结束后端应用会话。没有读取或操作的应用会话在 15 分钟后自动释放；关闭窗口或 CLI `close` 会立即释放。服务器退出时清理本次创建的显示、临时 JAR、伴生关联和端口转发，不解锁或点亮手机主屏。

构建独立 CLI：`bun run build:cli`，输出 `bin/webadb`。GitHub Release 提供 Linux x64 / arm64 和 macOS x64 / arm64 客户端，它们连接同一个后端 API。

## 文件摄像头

在桌面或设置中打开“系统摄像头”，选择“图片”“视频”或“媒体链接”，手动开始推流。媒体链接接受 HTTP(S) 图片 / 视频直链和 HLS、RTSP、RTMP 视频流，不接受普通网页地址。输入链接时必须选择“图片直链”“视频直链”或“实时视频流”，按明确类型处理。图片持续发送静止画面，视频循环播放，暂停时保留当前帧。输出固定为 **960 × 1280（宽 × 高，竖屏 3:4）**：按长边等比缩放，居中补黑，不拉伸、不裁剪。没有音轨，原始文件不复制到手机存储。

同一设备的 WebADB 应用窗口共享前后虚拟摄像头，两者使用相同输入源；手机主屏应用保持原有摄像头行为。正式来源由后端 FFmpeg 解码并持有，关闭网页或 CLI、收起面板及关闭应用窗口后继续推流。其他客户端能看到共享来源、暂停状态和手机确认的帧数，可以切换、暂停或停止。后台服务必须持续运行；设备断开、停止推流或服务退出时释放本次资源。启停相机会重建虚拟设备中的应用显示，应用是否保留页面取决于其自身行为。

```bash
bun run cli camera start ./image.png
bun run cli camera start ./video.mp4
bun run cli camera start https://host/video.mp4 --kind video
bun run cli camera start rtsp://host/live --kind stream
bun run cli camera start https://host/live.m3u8 --kind stream
bun run cli camera status
bun run cli camera pause
bun run cli camera resume
bun run cli camera stop
```

`camera start` 成功后立即返回，服务后台继续供帧。多设备用 `--device` 选择；CLI 链接必须用 `--kind image|video|stream` 明确指定类型。本地文件先流式上传到运行后端的电脑，停止或切换后删除临时副本；原文件不会写入手机。视频流暂停时冻结送往手机的画面，恢复后读取最新帧。

“扫码验收”在电脑上的 Android Chrome 窗口打开内置 `camera-test.html`。开始推流后，在该页面打开摄像头并允许网站访问，使用真实 `getUserMedia()` 和 `BarcodeDetector` 核对画面与二维码。不会自动访问扫码链接。验收网页通过随机 ADB reverse 端口访问运行后端的电脑，要求 ADB server 与 WebADB 服务运行在同一台机器；远程容器需要自行保证该路径可达。

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

容器自动启动 ADB server，使用 Wi-Fi 设备，不支持 USB 直通。持久化目录保存 ADB 授权密钥与配对缓存。也可以用 `docker compose up --build`。镜像内含独立 `webadb` CLI，可通过 `docker exec CONTAINER /app/webadb devices` 调用。

发布流水线运行类型检查、回归测试和前端构建，然后生成 CLI、构建 Linux amd64 / arm64 镜像并发布 GitHub Release。字体和图标本地提供，增加图标后运行 `scripts/fetch-fonts.py`。PWA 离线只提供页面，设备操作仍需后端连接。

开源依赖与构建工具说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
