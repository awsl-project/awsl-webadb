# Third Party Notices

本项目参考并使用以下开源项目的公开能力：

## Tango ADB / ya-webadb

- 项目地址: https://github.com/yume-chan/ya-webadb
- 版权: Copyright (c) 2020-2026 Simon Chan
- 许可证: MIT

本项目通过公开 npm 包 `@yume-chan/adb`、`@yume-chan/adb-server-node-tcp`、`@yume-chan/adb-scrcpy`、`@yume-chan/scrcpy` 与 `@yume-chan/scrcpy-decoder-webcodecs` 使用其能力，没有直接复制参考仓库的非必要代码与品牌资产。

MIT License 摘要如下：

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
```

完整许可证可见参考仓库 `LICENSE` 文件。

## scrcpy server binary

- 来源: Genymobile/scrcpy
- 分发方式: 通过 `@yume-chan/fetch-scrcpy-server` 下载 `scrcpy server 4.1`
- 许可证: Apache License 2.0

项目运行时使用公开发行的 `scrcpy server` 二进制，许可证文本随 `@yume-chan/fetch-scrcpy-server` 包中的 `scrcpy.LICENSE` 提供。

## 本地字体与图标

- IBM Plex Sans / IBM Plex Mono：IBM，SIL Open Font License 1.1；许可证位于 `public/fonts/LICENSE-ibm-plex.txt`。
- Android 资源表和二进制 XML 读取实现依据 [AOSP ResourceTypes.h](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/androidfw/include/androidfw/ResourceTypes.h) 的格式定义，支持稀疏索引、16 位偏移与 compact 条目。

测试使用 node-apk 的多命名空间 Android manifest 样本，MIT 许可证见 `tests/fixtures/LICENSE.node-apk`；来源见 `tests/fixtures/README.md`。

## Android 摄像头 helper 构建工具

`android/camera` 为本项目实现，运行时调用 Android VirtualDevice / VirtualCamera 系统 API。构建需要 Android 16 API stubs（或 Robolectric android-all）及 R8 / D8；这些工具和 Android framework 代码不包含在生成的 helper JAR 中。R8 来源于 Google，采用 BSD 3-Clause 许可证；Android framework API 来自 AOSP，采用 Apache-2.0 许可证。

## 界面组件

- shadcn/ui：Copyright (c) 2023 shadcn，MIT；通过官方 CLI 生成并按项目主题调整组件源码，许可证位于 `public/licenses/shadcn-ui.txt`。
- Radix UI：Copyright (c) 2022 WorkOS，MIT，许可证位于 `public/licenses/radix-ui.txt`。
- Lucide：Lucide Icons and Contributors，ISC；包含的 Feather 来源图标另遵循 MIT，完整声明位于 `public/licenses/lucide.txt`。
- Tailwind CSS、class-variance-authority、clsx、tailwind-merge 与 tw-animate-css：通过公开 npm 包使用，许可证随各包提供。
- resvg-js：MPL-2.0；仅用于开发时将本项目 SVG 标志生成各平台 PNG 图标，不包含在运行时程序中。

## FFmpeg

后端调用独立的 FFmpeg 可执行文件进行媒体解码、等比缩放及 JPEG 编码。容器使用 Debian 官方仓库的 FFmpeg 软件包；本机安装的版本由运行环境提供。FFmpeg 的许可证依构建配置为 LGPL 或 GPL，容器内可通过 `ffmpeg -L` 查看对应声明；软件包版权与源代码获取信息见 `/usr/share/doc/ffmpeg/copyright` 和 Debian 对应版本的源包。项目未将 FFmpeg 静态链接进 CLI 或后端二进制。详见 [FFmpeg Legal](https://ffmpeg.org/legal.html) 与 [Debian FFmpeg source](https://sources.debian.org/src/ffmpeg/)。
