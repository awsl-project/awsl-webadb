# WebADB Desk

**[简体中文](README.md) · [English](README.en.md)**

[CLI 操作 App](#cli-操作-app) · [CLI 后台推流](#cli-后台推流) · [安装](#安装与启动) · [功能](#功能)

在浏览器和命令行中打开、查看并操作 Android 应用，也可以把图片、视频和视频流送进应用的虚拟摄像头。**一个 `awsl-webadb` 二进制，同时提供服务端、网页和 CLI 客户端。无需 root。**

![WebADB 桌面主页，16:9](docs/images/desktop.webp)

*截图使用隔离的 Demo Phone、通用应用和示例素材，不包含个人手机信息。界面截图展示现有 UI，CLI 图片为演示 API 的实际返回片段；真机测试范围见[验证记录](docs/verification.md)。*

## CLI 操作 App

**无需打开网页。** CLI 与网页使用同一个后端会话：CLI 打开的应用出现在网页，网页中的操作、焦点、最小化和关闭也同步到 CLI。

```bash
awsl-webadb devices
awsl-webadb open com.android.chrome --device 1
awsl-webadb sessions

# 把 SESSION 替换成 open 返回的 id
awsl-webadb screenshot SESSION --output app.jpg
awsl-webadb xml SESSION --output app.xml
awsl-webadb elements SESSION

# 根据文字、资源 ID、无障碍描述或最近读取的元素 ID 操作
awsl-webadb click SESSION --text "确定"
awsl-webadb click SESSION --resource-id com.example:id/button
awsl-webadb click SESSION --description "搜索"
awsl-webadb click SESSION --node e12
awsl-webadb text SESSION "hello" --resource-id com.example:id/input

# 不提供元素树的页面也可通过截图坐标操作
awsl-webadb tap SESSION 100 200
awsl-webadb swipe SESSION 100 800 100 200 --duration 300
awsl-webadb key SESSION BACK
awsl-webadb close SESSION
```

`--device` 是 `devices` 返回的 transport ID，仅有一台设备时可省略。`open --width 1080 --height 1920` 设置显示尺寸，重复打开同一应用会复用会话。通过 `--url http://127.0.0.1:3000` 或 `WEBADB_URL` 指定服务端；控制命令返回 JSON，方便脚本使用；`xml` 未指定输出文件时直接输出 XML。

截图使用应用原始分辨率，坐标也以原始显示尺寸为准。XML / JSON 来自 Android 无障碍树，包含父子关系；页面变化后应重新读取元素 ID。未指定元素的 `text` 写入当前焦点输入框。网页“页面与元素”面板提供同样的能力。

## CLI 后台推流

将文件或媒体直链作为虚拟摄像头输入，供 **WebADB 独立应用窗口内的应用**读取。

```bash
# 图片持续供帧；本地视频循环播放
awsl-webadb camera start ./image.png
awsl-webadb camera start ./video.mp4 --aspect original
awsl-webadb camera start ./video.mp4 --aspect 9:16

# 链接必须明确类型：image、video 或 stream
awsl-webadb camera start https://media.example.com/image.png --kind image
awsl-webadb camera start https://media.example.com/video.mp4 --kind video
awsl-webadb camera start rtsp://camera.example.com/live --kind stream
awsl-webadb camera start https://media.example.com/live.m3u8 --kind stream

awsl-webadb camera status
awsl-webadb camera pause
awsl-webadb camera resume
awsl-webadb camera stop
```

以上域名仅作示例，请换成自己的媒体地址。支持 HTTP(S) 图片 / 视频直链以及 HLS、RTSP、RTMP 视频流，**普通网页 URL 不能作为媒体来源**。多设备用 `--device` 选择。

`camera start` 成功后立即退出，**后端持续推流，关闭 CLI、网页或应用窗口都不会停止**。其他客户端可查看状态并切换、暂停、恢复或停止；服务端必须保持运行。图片重复送帧，视频循环播放；实时流暂停时冻结画面，恢复后读取最新帧。本地文件流式上传到后端电脑，停止或切换后删除临时副本，原文件不写入手机。

## 安装与启动

提供四种方式：**独立二进制、Homebrew、Docker、源码运行**。

### 1. 独立二进制

从 [GitHub Releases](https://github.com/awsl-project/awsl-webadb/releases/latest) 下载对应文件，并用同页 `SHA256SUMS` 校验。

| 系统 | 架构 | 文件 |
| --- | --- | --- |
| Linux | x64 | `awsl-webadb-linux-amd64` |
| Linux | arm64 | `awsl-webadb-linux-arm64` |
| macOS | Intel | `awsl-webadb-macos-amd64` |
| macOS | Apple Silicon | `awsl-webadb-macos-arm64` |

以 macOS Apple Silicon 为例，在下载目录执行：

```bash
chmod +x awsl-webadb-macos-arm64
mv awsl-webadb-macos-arm64 awsl-webadb
# 可选：移入 PATH
mkdir -p ~/.local/bin
mv awsl-webadb ~/.local/bin/
export PATH="$HOME/.local/bin:$PATH"
adb start-server
awsl-webadb serve
```

打开 **http://127.0.0.1:3000**。服务端须持续运行，另开终端使用 CLI。程序已内置网页、字体、scrcpy server 和手机 helper，不需要 Bun、Node.js 或 `node_modules`。

运行服务端的电脑需要 [Android Platform Tools / ADB](https://developer.android.com/tools/releases/platform-tools)，手机须开启并授权 USB 调试。Wi-Fi 配对和连接也由服务端 ADB 管理。虚拟摄像头还需要 [FFmpeg](https://ffmpeg.org/download.html)，可用 `--ffmpeg PATH` 指定。macOS 可通过 `brew install --cask android-platform-tools` 和 `brew install ffmpeg` 安装依赖；Linux 使用发行版包管理器安装 `adb`、`ffmpeg`。

### 2. Homebrew（本仓库即 Tap）

```bash
brew tap awsl-project/webadb https://github.com/awsl-project/awsl-webadb.git
brew install awsl-project/webadb/awsl-webadb
# macOS；Linux 请通过发行版安装 adb
brew install --cask android-platform-tools
adb start-server
awsl-webadb serve
# 或交给 Homebrew 后台管理：
# brew services start awsl-project/webadb/awsl-webadb
```

Formula 按系统和架构下载 Release 二进制，自动安装 FFmpeg；ADB 单独安装。升级使用 `brew update` 和 `brew upgrade awsl-project/webadb/awsl-webadb`。Tap 与源码同仓库，不需要额外的跨仓库 token；发布后自动更新 `Formula/awsl-webadb.rb`。[Homebrew 支持显式指定 Tap 的 Git URL](https://docs.brew.sh/Taps.html)。

### 3. Docker

```bash
docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -p 127.0.0.1:5037:5037 \
  -v awsl-webadb-data:/var/lib/awsl-webadb \
  ghcr.io/awsl-project/awsl-webadb:latest
```

镜像支持 Linux amd64 / arm64，内置 ADB 和 FFmpeg，使用 Wi-Fi 设备，**不支持 USB 直通**。网页仍为 http://127.0.0.1:3000。数据卷保存 ADB 授权、配对、收藏与缓存。可从主机使用 CLI，或运行 `docker exec CONTAINER /app/awsl-webadb devices`。

### 4. 源码运行

需要 Bun 1.4.3 或更新版本，以及 ADB；摄像头推流需要 FFmpeg。

```bash
git clone https://github.com/awsl-project/awsl-webadb.git
cd awsl-webadb
bun install
adb start-server
bun run dev
```

开发网页为 http://127.0.0.1:5173，后端为 http://127.0.0.1:3000。源码 CLI 使用 `bun run cli …`。生产构建、独立二进制构建及配置见[开发文档](docs/development.md)。


## 功能

| 能力 | 说明 |
| --- | --- |
| 网页桌面 | 电脑多窗口、手机触控与全屏应用；One Half 明暗主题、跟随系统、PWA 安装与更新提示 |
| 设备连接 | USB / Wi-Fi、调试授权状态、无线配对与连接、多设备切换；通过后端 ADB server 连接 |
| 状态与控制 | 设备信息、电量与充电状态；导航、音量、媒体、电源 / 唤醒 / 休眠、通知栏、快捷设置和设备 PNG 截图；默认即可控制，无只读模式切换 |
| 应用窗口 | 收藏与全部应用、独立显示、横竖屏、分辨率调整、触摸 / 拖动 / 滚轮 / 键盘输入 |
| 页面读取 | 单应用 JPEG 截图、XML / JSON 无障碍元素、元素选择与点击、截图坐标操作；网页与 CLI 共用会话 |
| 原屏镜像 | 基于 scrcpy 4.1；独立应用窗口与原屏镜像分别使用对应显示 |
| 文件管理 | 目录导航、搜索、排序、上传、下载和进度；覆盖确认，支持的浏览器可流式保存大文件 |
| 虚拟摄像头 | 图片、循环视频、媒体链接三种来源；明确链接类型，后台推流与跨客户端状态同步 |
| 画面比例 | 原始、3:4、4:3、9:16、16:9、1:1；预览与 Android 虚拟相机使用相同输出尺寸 |
| 声音 | 手动播放手机音频输出；**尚无麦克风推流，不采集电脑麦克风** |
| 服务端存储 | 名称与图标缓存 7 天；收藏按设备永久保存，不设有效期 |
| 单程序部署 | 一个二进制作为服务端或客户端；Linux / macOS 各两种架构，另有双架构容器 |

## 更多截图

<details>
<summary>展开手机、虚拟摄像头与 CLI 截图</summary>

<table>
<tr><th>手机主页</th><th>图片 → 虚拟摄像头</th></tr>
<tr><td align="center"><img src="docs/images/mobile.webp" alt="手机竖屏布局" width="230"></td><td><img src="docs/images/camera-image.webp" alt="图片后台推流，原始比例" width="640"></td></tr>
<tr><th>循环视频 → 虚拟摄像头</th><th>媒体链接 → 虚拟摄像头</th></tr>
<tr><td><img src="docs/images/camera-video.webp" alt="循环视频推流，3:4 输出" width="640"></td><td><img src="docs/images/camera-link.webp" alt="明确选择实时视频流，16:9 输出" width="640"></td></tr>
<tr><th>CLI 操作 App</th><th>CLI 后台推流</th></tr>
<tr><td><img src="docs/images/cli-app.webp" alt="CLI 打开应用、读取 XML、点击元素的演示输出" width="640"></td><td><img src="docs/images/cli-camera.webp" alt="CLI 启动、查看和暂停后台推流的演示输出" width="640"></td></tr>
</table>

</details>

## 摄像头兼容性与生命周期

虚拟摄像头需要 **Android 16 VirtualCamera API**，独立窗口需要 ROM 实现 VirtualDevice 等系统接口并允许 ADB shell 使用。**不使用 root，也不会全局替换手机主屏应用的摄像头。** WebADB 虚拟设备中的应用共享前后虚拟摄像头，同一来源供帧；手机主屏可以保持黑屏。应用自身仍可能限制多屏、截图或音频捕获。

打开应用、选择文件不会自动启动相机，必须手动开始推流。系统相机隐私开关、ROM 隐身模式和应用权限仍生效，服务不会自动修改。推流没有音轨。

| 输出比例 | 输出尺寸 |
| --- | --- |
| `original`（默认） | 跟随来源，最长边不超过 1280，不放大小图；尺寸取偶数，最多一个像素取整差异 |
| `3:4` | 960 × 1280 |
| `4:3` | 1280 × 960 |
| `9:16` | 720 × 1280 |
| `16:9` | 1280 × 720 |
| `1:1` | 1280 × 1280 |

固定比例等比缩放、居中补黑，不裁剪、不拉伸。`--aspect` 或网页比例选择在下一次开始 / 切换时生效。尺寸变化会重建虚拟摄像头和应用显示，应用可能需要重新打开相机；实时流来源尺寸变化需重新开始推流。

浏览器关闭不结束后端应用会话；应用会话无读取或操作 15 分钟后释放，关闭窗口或 `close` 立即释放。后台推流独立运行，停止推流、设备断开或服务退出时释放相应资源。服务退出也会清理本次创建的显示、临时 JAR、伴生关联及端口转发。

## 配置与文档

服务端默认仅监听本机。`serve` 支持 `--host`、`--port`、`--adb-host`、`--adb-port`、`--ffmpeg`、`--static-dir` 和 `--data-dir`，也兼容对应环境变量。默认数据目录为 `~/.local/share/awsl-webadb`：`metadata/` 缓存可删除，`favorites/` 是永久收藏。

可信局域网访问需显式设置 `--host 0.0.0.0`；远程访问请使用带身份验证的 HTTPS 代理，并通过 `ALLOWED_ORIGINS` 配置允许的完整来源。PWA 离线仅提供页面，设备操作需要后端在线。

- [开发、构建、配置和 Homebrew 集成](docs/development.md)
- [真机与媒体验证记录](docs/verification.md)
- [第三方依赖说明](THIRD_PARTY_NOTICES.md)
- `awsl-webadb --help` / `awsl-webadb --version`
