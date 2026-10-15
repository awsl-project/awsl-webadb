#!/usr/bin/env bun
import { writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { version } from "../package.json";

const args = process.argv.slice(2);
const options = new Map<string, string>();
const positional: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index]!;
  if (!arg.startsWith("--")) {
    positional.push(arg);
    continue;
  }
  if (arg === "--help" || arg === "--version") {
    options.set(arg.slice(2), "true");
    continue;
  }
  if (!args[index + 1] || args[index + 1]!.startsWith("--")) {
    console.error(`${arg} 缺少参数`);
    process.exit(1);
  }
  options.set(arg.slice(2), args[++index]!);
}
const [command, id, ...values] = positional;
const usage = `awsl-webadb ${version} — 同一个程序作为服务端或客户端

awsl-webadb serve [--host 127.0.0.1] [--port 3000]
  [--adb-host 127.0.0.1] [--adb-port 5037]
  [--static-dir PATH] [--ffmpeg PATH]
服务端提供网页、API 和后台推流；客户端不需要打开浏览器。

awsl-webadb devices
awsl-webadb open com.miui.calculator [--device 1] [--width 1080 --height 1920]
awsl-webadb sessions
awsl-webadb screenshot SESSION --output app.jpg
awsl-webadb xml SESSION [--output app.xml]
awsl-webadb elements SESSION
awsl-webadb tap SESSION X Y
awsl-webadb click SESSION --text "打开摄像头"
awsl-webadb click SESSION --resource-id com.example:id/button
awsl-webadb click SESSION --node e12
awsl-webadb swipe SESSION X Y END_X END_Y [--duration 300]
awsl-webadb text SESSION "输入内容" [--resource-id com.example:id/input]
awsl-webadb key SESSION BACK|HOME|ENTER|KEYCODE
awsl-webadb close SESSION

awsl-webadb camera start ./image.png [--device 1]
awsl-webadb camera start ./video.mp4 [--device 1]
awsl-webadb camera start https://host/live.m3u8 --kind image|video|stream
awsl-webadb camera status [--device 1]
awsl-webadb camera pause|resume|stop [--device 1]
推流由后端后台运行，CLI 退出与关闭网页不会停止。

--url http://127.0.0.1:3000 指定服务（或 WEBADB_URL）
截图坐标使用 open 返回的显示尺寸；元素 ID 以最新读取结果为准。
XML/JSON 来自 Android 无障碍树，游戏和 Canvas 页面可使用截图坐标。
会话闲置 15 分钟自动释放；不会点击或解锁手机主屏。`;
const url = (
  options.get("url") ??
  process.env.WEBADB_URL ??
  "http://127.0.0.1:3000"
).replace(/\/$/, "");
async function request(path: string, method = "GET", body?: object) {
  const response = await fetch(`${url}/api/app-sessions${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(error.message || `服务返回 ${response.status}`);
  }
  return response;
}
const numeric = (value: string | undefined, label: string) => {
  if (!value || !/^-?\d+$/.test(value)) throw new Error(`${label} 需要整数`);
  return Number(value);
};
const selector = () => {
  const result: Record<string, string> = {};
  for (const [flag, key] of [
    ["text", "text"],
    ["resource-id", "resourceId"],
    ["description", "description"],
    ["node", "nodeId"],
  ]) {
    if (options.has(flag!)) result[key!] = options.get(flag!)!;
  }
  return result;
};
async function main() {
  if (options.has("version")) {
    console.log(version);
    return;
  }
  if (!command || options.has("help") || command === "help") {
    console.log(usage);
    process.exit(0);
  }
  if (command === "serve") {
    if (id) throw new Error("serve 不接受位置参数，请使用 --host、--port 等选项");
    const variables: Record<string, string> = {
      host: "HOST",
      port: "PORT",
      "adb-host": "ADB_SERVER_HOST",
      "adb-port": "ADB_SERVER_PORT",
      "static-dir": "STATIC_DIR",
      ffmpeg: "FFMPEG_PATH",
    };
    for (const [key, value] of options) {
      const variable = variables[key];
      if (!variable) throw new Error(`serve 不支持 --${key}`);
      if (key === "port" || key === "adb-port") {
        const port = numeric(value, key);
        if (port < 1 || port > 65535) throw new Error(`${key} 应在 1–65535 范围内`);
      }
      process.env[variable] =
        key === "static-dir" || key === "ffmpeg" ? resolve(value) : value;
    }
    process.env.NODE_ENV ??= "production";
    await import("../server/index");
    return;
  }
  if (command === "devices") {
    console.log(
      JSON.stringify(await (await request("/devices")).json(), null, 2),
    );
    process.exit(0);
  }
  if (command === "sessions") {
    console.log(JSON.stringify(await (await request("")).json(), null, 2));
    process.exit(0);
  }
  if (command === "open") {
    if (!id) throw new Error("open 需要应用包名");
    const body = {
      packageName: id,
      transportId: options.get("device"),
      width: options.has("width")
        ? numeric(options.get("width"), "width")
        : undefined,
      height: options.has("height")
        ? numeric(options.get("height"), "height")
        : undefined,
    };
    console.log(
      JSON.stringify(await (await request("", "POST", body)).json(), null, 2),
    );
    process.exit(0);
  }
  if (command === "camera") {
    const query = options.has("device")
      ? `?transportId=${encodeURIComponent(options.get("device")!)}`
      : "";
    const operation = id || "status";
    const read = async (response: Response) => {
      if (!response.ok)
        throw new Error(
          ((await response.json().catch(() => ({}))) as { message?: string })
            .message || `服务返回 ${response.status}`,
        );
      return response.json();
    };
    let result: unknown;
    if (operation === "start") {
      const input = values[0];
      if (!input)
        throw new Error("camera start 需要图片、视频文件路径或媒体链接");
      const kind = options.get("kind") || "auto";
      if (!["auto", "image", "video", "stream"].includes(kind))
        throw new Error("kind 应为 auto、image、video 或 stream");
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
        if (kind === "auto")
          throw new Error("媒体链接必须用 --kind image|video|stream 指明类型");
        result = await read(
          await fetch(`${url}/api/system-camera/url${query}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: input, kind }),
            signal: AbortSignal.timeout(30_000),
          }),
        );
      } else {
        const path = resolve(input);
        const info = await stat(path);
        if (!info.isFile()) throw new Error("需要本地图片或视频文件");
        const fileKind =
          kind === "auto"
            ? /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i.test(path)
              ? "image"
              : "video"
            : kind;
        if (fileKind !== "image" && fileKind !== "video")
          throw new Error("本地文件类型应为 image 或 video");
        const params = new URLSearchParams({
          kind: fileKind,
          name: path.split(/[\\/]/).at(-1)!,
        });
        if (options.has("device"))
          params.set("transportId", options.get("device")!);
        const stream = createReadStream(path);
        try {
          result = await read(
            await fetch(`${url}/api/system-camera/file?${params}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(info.size),
              },
              body: stream as unknown as BodyInit,
              duplex: "half",
              signal: AbortSignal.timeout(120_000),
            } as RequestInit & { duplex: "half" }),
          );
        } finally {
          stream.destroy();
        }
      }
      console.log(
        JSON.stringify({ background: true, camera: result }, null, 2),
      );
    } else {
      if (!["status", "pause", "resume", "stop"].includes(operation))
        throw new Error("camera 支持 start、status、pause、resume、stop");
      const pause = operation === "pause" || operation === "resume";
      result = await read(
        await fetch(
          `${url}/api/system-camera${pause ? "/pause" : ""}${query}`,
          {
            method: pause ? "POST" : operation === "stop" ? "DELETE" : "GET",
            headers: { "Content-Type": "application/json" },
            body: pause
              ? JSON.stringify({ paused: operation === "pause" })
              : undefined,
            signal: AbortSignal.timeout(30_000),
          },
        ),
      );
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  }
  if (!id || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error("请指定 open 返回的会话 ID");
  const path = `/${id}`;
  if (command === "screenshot" || command === "xml") {
    const response = await request(
      path +
        (command === "screenshot" ? "/screenshot" : "/elements?format=xml"),
    );
    const output = options.get("output");
    if (!output && command === "screenshot")
      throw new Error("截图需要 --output app.jpg");
    if (output) {
      await writeFile(output, new Uint8Array(await response.arrayBuffer()));
      console.log(JSON.stringify({ path: resolve(output) }));
    } else process.stdout.write(await response.text());
    process.exit(0);
  }
  if (command === "elements") {
    console.log(
      JSON.stringify(
        (
          (await (await request(path + "/elements")).json()) as {
            elements: unknown[];
          }
        ).elements,
        null,
        2,
      ),
    );
    process.exit(0);
  }
  if (command === "close") {
    console.log(await (await request(path, "DELETE")).text());
    process.exit(0);
  }
  let action: object;
  if (command === "tap")
    action = {
      type: "tap",
      x: numeric(values[0], "X"),
      y: numeric(values[1], "Y"),
    };
  else if (command === "swipe")
    action = {
      type: "swipe",
      x: numeric(values[0], "X"),
      y: numeric(values[1], "Y"),
      endX: numeric(values[2], "END_X"),
      endY: numeric(values[3], "END_Y"),
      duration: options.has("duration")
        ? numeric(options.get("duration"), "duration")
        : 300,
    };
  else if (command === "click")
    action = { type: "clickElement", ...selector() };
  else if (command === "text") {
    if (values[0] === undefined) throw new Error("text 需要输入内容");
    action = { type: "setText", value: values[0], ...selector() };
  } else if (command === "key") {
    const keys: Record<string, number> = {
      BACK: 4,
      HOME: 3,
      ENTER: 66,
      TAB: 61,
      ESC: 111,
      DELETE: 67,
      RECENTS: 187,
    };
    action = {
      type: "key",
      keyCode:
        keys[values[0]?.toUpperCase() ?? ""] ?? numeric(values[0], "KEYCODE"),
    };
  } else throw new Error(`未知命令：${command}\n${usage}`);
  console.log(await (await request(path + "/action", "POST", action)).text());
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
