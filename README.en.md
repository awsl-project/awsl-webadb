# WebADB Desk

**[English](README.en.md) · [简体中文](README.md)**

[CLI app control](#control-apps-from-the-cli) · [CLI streaming](#stream-to-the-camera-from-the-cli) · [Install](#install-and-run) · [Features](#features)

Control Android apps from your browser or CLI, and feed images, videos or live streams into their virtual cameras. **One binary serves as both server and client. No root required.**

![WebADB desktop home](docs/images/desktop.webp)

<details>
<summary>More screenshots: mobile, virtual camera, CLI</summary>

<table>
<tr><th>Mobile home</th><th>Image → virtual camera</th></tr>
<tr><td align="center"><img src="docs/images/mobile.webp" alt="Mobile portrait layout" width="230"></td><td><img src="docs/images/camera-image.webp" alt="Background image streaming with the original aspect ratio" width="640"></td></tr>
<tr><th>Looping video → virtual camera</th><th>Media URL → virtual camera</th></tr>
<tr><td><img src="docs/images/camera-video.webp" alt="Looping video with 3:4 output" width="640"></td><td><img src="docs/images/camera-link.webp" alt="Explicit live-stream type with 16:9 output" width="640"></td></tr>
<tr><th>CLI app control</th><th>CLI background streaming</th></tr>
<tr><td><img src="docs/images/cli-app.webp" alt="Demo CLI output: open an app, read XML and click an element" width="640"></td><td><img src="docs/images/cli-camera.webp" alt="Demo CLI output: start, inspect and pause background streaming" width="640"></td></tr>
</table>

</details>

## Control apps from the CLI

The CLI works without a browser. App sessions, actions, focus, minimize and close state stay synchronized with the web interface.

```bash
awsl-webadb devices
awsl-webadb open com.android.chrome --device 1
awsl-webadb sessions

# Replace SESSION with the id returned by open
awsl-webadb screenshot SESSION --output app.jpg
awsl-webadb xml SESSION --output app.xml
awsl-webadb elements SESSION

# Select by text, resource ID, accessibility description or latest node ID
awsl-webadb click SESSION --text "OK"
awsl-webadb click SESSION --resource-id com.example:id/button
awsl-webadb click SESSION --description "Search"
awsl-webadb click SESSION --node e12
awsl-webadb text SESSION "hello" --resource-id com.example:id/input

# Screenshot coordinates work on pages without accessibility elements
awsl-webadb tap SESSION 100 200
awsl-webadb swipe SESSION 100 800 100 200 --duration 300
awsl-webadb key SESSION BACK
awsl-webadb close SESSION
```

`SESSION` is the ID returned by `open`. `--device` takes a device transport ID and is optional for a single device. Set display dimensions with `open --width 1080 --height 1920`; reopening an app for the same Android user reuses its session.

Set the server with Cloned apps are distinguished by Android user. The web interface lists each copy separately, with independent windows, running state and favorites. Select a user with `--user` (default `0`):

```bash
awsl-webadb users
awsl-webadb apps --user 999
awsl-webadb open com.tencent.mm --user 0
awsl-webadb open com.tencent.mm --user 999
```

Each `open` returns a separate `SESSION`; use that ID for screenshots, elements and actions. Use IDs reported by `users`. Locked or policy-restricted profiles report errors; the service does not unlock them or change their permissions.

`--url` or `WEBADB_URL`; the default is `http://127.0.0.1:3000`. Control commands return JSON; `xml` emits XML directly without `--output`.

Screenshots and coordinates use the app's original resolution. XML / JSON comes from the accessibility tree; read node IDs again after the page changes. Without a selector, `text` writes to the focused input. The web page and element inspector offers the same controls.

## Stream to the camera from the CLI

Use a file or direct media URL as the virtual-camera source for **apps running in WebADB's independent app windows**.

```bash
# Images repeat continuously; local videos loop
awsl-webadb camera start ./image.png
awsl-webadb camera start ./video.mp4 --aspect original
awsl-webadb camera start ./video.mp4 --aspect 9:16

# URLs require an explicit type: image, video or stream
awsl-webadb camera start https://media.example.com/image.png --kind image
awsl-webadb camera start https://media.example.com/video.mp4 --kind video
awsl-webadb camera start rtsp://camera.example.com/live --kind stream
awsl-webadb camera start https://media.example.com/live.m3u8 --kind stream

awsl-webadb camera status
awsl-webadb camera pause
awsl-webadb camera resume
awsl-webadb camera stop
```

Supports direct HTTP(S) images / videos and HLS, RTSP and RTMP streams, **not ordinary webpage URLs**. URLs require `--kind image|video|stream`; select a device with `--device`.

`camera start` returns while the server keeps streaming. **Closing the CLI, browser or app window does not stop streaming.** Web and CLI clients can inspect, switch, pause or stop the source.

Images repeat and videos loop. Pausing a live stream freezes the frame; resuming reads the latest frames. Local files are uploaded only to the backend and removed on stop or replacement, without being saved to phone storage.

## Install and run

### 1. Standalone binary

Download the matching asset from [GitHub Releases](https://github.com/awsl-project/awsl-webadb/releases/latest) and verify it against the accompanying `SHA256SUMS`.

| System | Architecture | Asset |
| --- | --- | --- |
| Linux | x64 | `awsl-webadb-linux-amd64` |
| Linux | arm64 | `awsl-webadb-linux-arm64` |
| macOS | Intel | `awsl-webadb-macos-amd64` |
| macOS | Apple Silicon | `awsl-webadb-macos-arm64` |

For example, on macOS Apple Silicon, run from your download directory:

```bash
chmod +x awsl-webadb-macos-arm64
mkdir -p ~/.local/bin
mv awsl-webadb-macos-arm64 ~/.local/bin/awsl-webadb
export PATH="$HOME/.local/bin:$PATH"
adb start-server
awsl-webadb serve
```

Open **http://127.0.0.1:3000** and use another terminal for CLI commands. The web interface and Android service components are embedded; Bun and Node.js are not required.

The server needs [ADB](https://developer.android.com/tools/releases/platform-tools), with USB debugging enabled and authorized on the phone. Camera streaming also requires [FFmpeg](https://ffmpeg.org/download.html); set its path with `--ffmpeg PATH`. On macOS, use `brew install --cask android-platform-tools` and `brew install ffmpeg`; on Linux, use your distribution package manager.

### 2. Homebrew

```bash
brew tap awsl-project/webadb https://github.com/awsl-project/awsl-webadb.git
brew install awsl-project/webadb/awsl-webadb
# macOS; on Linux, install adb through your distribution
brew install --cask android-platform-tools
adb start-server
awsl-webadb serve
# Or let Homebrew run the service in the background:
# brew services start awsl-project/webadb/awsl-webadb
```

FFmpeg is installed automatically; install ADB separately. Upgrade with `brew update && brew upgrade awsl-project/webadb/awsl-webadb`.

### 3. Docker

```bash
docker run --rm \
  -p 127.0.0.1:3000:3000 \
  -p 127.0.0.1:5037:5037 \
  -v awsl-webadb-data:/var/lib/awsl-webadb \
  ghcr.io/awsl-project/awsl-webadb:latest
```

Supports Linux amd64 / arm64 with ADB and FFmpeg included. **Wi-Fi devices only; USB passthrough is unsupported.** The volume stores authorization, pairing, favorites and cache. Run the CLI in the container with `docker exec CONTAINER /app/awsl-webadb devices`.

### 4. Run from source

Requires Bun 1.4.3 or later and ADB; camera streaming requires FFmpeg.

```bash
git clone https://github.com/awsl-project/awsl-webadb.git
cd awsl-webadb
bun install
adb start-server
bun run dev
```

The development UI runs at http://127.0.0.1:5173 and the backend at http://127.0.0.1:3000. Use `bun run cli …` for CLI commands. See the [development guide](docs/development.md) for builds and configuration.

## Features

| Capability | Details |
| --- | --- |
| Web desktop | Multiple windows on desktop, touch and full-screen apps on mobile; One Half light / dark themes, system theme, PWA installation and update prompts |
| Connections | USB / Wi-Fi, debugging authorization state, wireless pairing and connection, device switching; all through the backend ADB server |
| Status and control | Device details, battery and charging status; navigation, volume, media, power / wake / sleep, notifications, quick settings and device PNG screenshots |
| App windows | Android users / cloned apps, independent favorites and running state, app catalog, independent displays, orientation and resolution changes, touch / drag / wheel / keyboard input |
| Page inspection | Per-app JPEG screenshots, XML / JSON accessibility elements, element selection and clicks, coordinate input; shared web / CLI sessions |
| Screen mirroring | View and control the phone's main screen with scrcpy 4.1 |
| File management | Directory navigation, search, sorting, upload / download progress and overwrite confirmation; streaming downloads in supported browsers |
| Virtual camera | Images, looping videos and media URLs; explicit URL types, background streaming and state shared across clients |
| Aspect ratios | Original, 3:4, 4:3, 9:16, 16:9 and 1:1; preview and Android virtual camera share output dimensions |
| Audio | Play phone audio output; microphone streaming is unsupported |
| Server storage | App names and icons cached for 7 days; per-device favorites persist without expiration |
| Deployment | One binary as server or client; two architectures each for Linux / macOS, plus a dual-architecture container |

## Camera and sessions

Virtual-camera input requires the **Android 16 VirtualCamera API**. Independent windows require ROM support for VirtualDevice with ADB shell access. Camera input applies only to WebADB app windows, leaving the main-screen camera unchanged. Front and rear cameras share one source, and the phone screen can stay off. Apps may restrict multiple displays, screenshots or audio capture.

Start streaming manually. Streams have no audio track; system privacy switches and app camera permissions remain in effect.

| Aspect ratio | Output dimensions |
| --- | --- |
| `original` (default) | Preserves source ratio, longest edge ≤ 1280, no upscaling; even dimensions |
| `3:4` | 960 × 1280 |
| `4:3` | 1280 × 960 |
| `9:16` | 720 × 1280 |
| `16:9` | 1280 × 720 |
| `1:1` | 1280 × 1280 |

Fixed ratios fit the source proportionally with centered black padding, without cropping or stretching. `--aspect` or the web ratio selection applies on the next start / switch. Dimension changes recreate the virtual camera and app displays; apps may need to reopen the camera. Restart streaming if a live source changes dimensions.

App sessions expire after 15 minutes without reads or actions; closing a window or using `close` releases them immediately. Camera streaming runs independently until stopped, the device disconnects or the server exits.

## Configuration and documentation

The server listens locally by default. `serve` accepts `--host`, `--port`, `--adb-host`, `--adb-port`, `--ffmpeg`, `--static-dir` and `--data-dir`, plus corresponding environment variables. The default data directory is `~/.local/share/awsl-webadb`: `metadata/` is disposable cache; `favorites/` stores permanent favorites.

For trusted LAN access, explicitly set `--host 0.0.0.0`. For remote access, use an authenticated HTTPS proxy and configure allowed full origins through `ALLOWED_ORIGINS`. The PWA's offline shell only serves the interface; device operations need the backend online.

- [Development, builds, configuration and Homebrew integration](docs/development.md) (Chinese)
- [Physical-device and media verification log](docs/verification.md) (Chinese)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- `awsl-webadb --help` / `awsl-webadb --version`
