# 开发与维护

返回[中文介绍](../README.md) · [English overview](../README.en.md)

## 源码运行

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

可配置 `PORT`、`HOST`、`ADB_SERVER_HOST`、`ADB_SERVER_PORT`、`STATIC_DIR` 与 `ALLOWED_ORIGINS`。默认仅监听本机；需要可信局域网访问时显式设置 `HOST=0.0.0.0`。局域网使用本机 IP 或主机名访问；自定义域名和生产反向代理请配置允许的完整来源，例如 `ALLOWED_ORIGINS=https://webadb.example.com`；多个来源用逗号分隔。本服务提供完整 ADB 控制能力，远程访问应使用具备身份验证的 HTTPS 代理。

## 构建独立程序

```bash
bun run build:binary
node scripts/smoke-binary.mjs bin/awsl-webadb
```

输出 `bin/awsl-webadb`，`build:cli` 为兼容别名。冒烟检查从空目录核对服务、客户端、参数、来源限制及内置资源。Release 提供 Linux / macOS 的 x64 / arm64 二进制和 `SHA256SUMS`。

## 配置与数据

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3000` |
| `ADB_SERVER_HOST` / `ADB_SERVER_PORT` | `127.0.0.1` / `5037` |
| `FFMPEG_PATH` | FFmpeg 可执行文件路径；默认从 PATH 查找 |
| `STATIC_DIR` | 覆盖内置网页资源目录 |
| `WEBADB_DATA_DIR` | 默认 `~/.local/share/awsl-webadb` |
| `ALLOWED_ORIGINS` | 允许的完整网页来源，多个以逗号分隔 |
| `WEBADB_URL` | CLI 服务地址，默认 `http://127.0.0.1:3000` |

名称和图标按设备、Android 用户、包名、语言缓存 7 天，命中时直接使用；首页按需读取图标，全部应用按需加载其他名称和图标。收藏按设备永久保存，首次使用会迁移浏览器旧收藏；其他浏览器在打开或重新聚焦时读取服务端收藏。`metadata/` 可删除，`favorites/` 不设有效期。可通过 `serve --data-dir PATH` 覆盖目录。

## 验证与限制

内部联调页面 `camera-test.html` 用于在 Android Chrome 中检查相机画面，产品界面不提供该测试入口。开始推流后，在该页面打开摄像头并允许网站访问，使用真实 `getUserMedia()` 和 `BarcodeDetector` 核对画面与二维码。不会自动访问扫码链接。验收网页通过随机 ADB reverse 端口访问运行后端的电脑，要求 ADB server 与 WebADB 服务运行在同一台机器；远程容器需要自行保证该路径可达。

需要 Android 16 的 VirtualCamera API，具体兼容性依 ROM 而定。小米隐身模式、系统相机隐私开关或 Chrome 权限可能阻止相机读取；服务不会修改这些系统隐私设置，也不会全局授予 Chrome 相机权限。扫码验收仅在本次虚拟设备上下文授权，并在结束时撤销。本机已完成 960 × 1280 视频扫码与实时时钟画面验收；详细验证范围见 [验证记录](verification.md)。

手机主屏可保持黑屏。应用预览最多约 8 FPS、宽度 720 像素；保存的截图使用应用原始分辨率。虚拟相机声明 30 FPS，后台视频按最高 12 FPS 处理，实际送帧速率受媒体和 ADB 通道影响。`camera-clock.html` 是额外的浏览器画布验收工具，显示当前时间和二维码，用于观察画面变化；该工具依赖页面保持打开，不属于正式后台媒体来源。

重建手机 helper（Java 21）：

```bash
bash scripts/fetch-camera-tools.sh .release/camera-tools
CAMERA_JAVA_HOME=/path/to/jdk-21 \
CAMERA_ANDROID_JAR="$PWD/.release/camera-tools/android-all.jar" \
CAMERA_R8_JAR="$PWD/.release/camera-tools/r8.jar" \
bash scripts/build-camera.sh
```

也可指定已有工具：

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

主分支 push 和 PR 自动运行类型检查、回归测试、依赖审计、Android helper 编译、独立程序构建与冒烟测试。helper 工具版本和 SHA-256 校验固定在 `scripts/fetch-camera-tools.sh`。发布流水线执行同样的检查，然后生成 CLI、构建 Linux amd64 / arm64 镜像并发布 GitHub Release。字体本地提供，更新字体使用 `scripts/fetch-fonts.py`；界面图标直接引用 Lucide SVG。PWA 离线只提供页面，设备操作仍需后端连接。

开源依赖与构建工具说明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 界面开发

通用控件使用 shadcn/ui（Radix），布局使用 Tailwind CSS 4，图标统一使用 Lucide SVG。配置见 `components.json`，组件源码位于 `src/components/ui`；新增组件可运行 `bunx shadcn@latest add <组件名>`。主题色通过 `src/styles/ui.css` 映射 One Half 变量。原有窗口与设备画面样式放在 `legacy` CSS 层，组件样式和工具类在其后，避免反复覆盖。

应用中心、连接、设置、控制、摄像头及元素面板按需加载。新增界面优先组合现有组件，不新增测试入口或复制按钮、弹层和焦点管理逻辑。

PWA 与页头共用 `public/pwa-icon.svg`。修改后运行 `bun run icons:generate`，统一输出普通图标、192 / 512 / 1024 自适应图标、Apple 120 / 152 / 167 / 180 图标、16 / 32 / 48 PNG 与 ICO，以及 Safari 固定标签单色图标；`bun run icons:check` 验证生成资源未过期。自适应与 Apple 图标使用不透明方形底色，标志完整保留在自适应安全区内。

## Homebrew 发布集成

本仓库同时作为源码仓库和 Homebrew Tap，Formula 位于 `Formula/awsl-webadb.rb`。仓库名无需改成 `homebrew-*`：首次添加 Tap 时显式提供 Git URL，参见 [Homebrew Taps 文档](https://docs.brew.sh/Taps.html)。

```bash
brew tap awsl-project/webadb https://github.com/awsl-project/awsl-webadb.git
brew install awsl-project/webadb/awsl-webadb
# macOS 安装 ADB；Linux 使用发行版包管理器安装 adb
brew install --cask android-platform-tools
adb start-server
brew services start awsl-project/webadb/awsl-webadb
awsl-webadb devices
```

Formula 选择 Linux / macOS 的 x64 / arm64 二进制，依赖 FFmpeg，并提供 `brew services` 定义；ADB 单独安装。运行服务前应先启动 ADB server。

发布流程先构建并发布四份二进制、`SHA256SUMS` 和 `awsl-webadb.rb`，再调用 **Update Homebrew Formula** workflow。它从已发布 Release 读取校验和，生成 Formula，校验 Ruby 语法并提交到本仓库默认分支。只需内置 `GITHUB_TOKEN` 的 `contents: write` 权限，**不需要 `HOMEBREW_TAP_TOKEN` 或另一个 Tap 仓库**。若默认分支保护禁止 Actions 直接推送，需要按仓库保护规则允许更新或改走 PR。

也可手动运行该 workflow，传入已发布的 `vX.Y.Z`；版本必须匹配默认分支 `package.json`，避免旧发布覆盖当前 Formula。没有变更时不创建提交。发布工作流由 tag 触发，机器人更新 Formula 的普通提交不会重复发版。

本地生成与核对：

```bash
node scripts/homebrew-formula.mjs vX.Y.Z /path/to/SHA256SUMS > Formula/awsl-webadb.rb
ruby -c Formula/awsl-webadb.rb
```

同组织 maxx 的桌面程序采用 Cask；本项目是命令行服务，使用 Formula。[Formula 服务定义](https://docs.brew.sh/Formula-Cookbook#service-files)。

## Android 用户与应用分身

`GET /api/users?transportId=1` 返回用户 ID 与当前用户标记；`GET /api/apps?transportId=1` 读取所有可访问用户，支持 `userId=999` 筛选，受限用户的读取错误放在 `warnings`。未读取到用户列表时直接报错。

应用和会话包含数值 `userId`。`POST /api/app-sessions` 接收 `userId`，默认 `0`；启动、解析入口与结束应用均明确指定用户。会话按设备、用户和包名复用，截图、元素和输入沿用会话自己的显示 ID；SSE 同步完整用户身份。

`app-metadata`、`app-icon` 同样接受 `userId`；缓存按用户隔离。收藏中的主用户仍保存裸包名，其他用户保存 `用户ID:包名`，兼容旧收藏且互不覆盖。资料锁定、工作策略或 ROM 对跨用户虚拟显示的限制由系统决定，不自动解除；内部 Chrome 相机验收入口仅针对主用户。
