import { basename } from "node:path";
import { spawn } from "node:child_process";
import { CAMERA_HEIGHT, CAMERA_WIDTH } from "../shared/sessions";

export type CameraUrlKind = "image" | "video" | "stream";
export interface CameraUrlSource {
  name: string;
  kind: CameraUrlKind;
  start: (
    onFrame: (frame: Buffer) => Promise<void>,
    onError: (error: Error) => void,
  ) => void;
  pause: (paused: boolean) => void;
  close: () => Promise<void>;
}

export function mediaUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("请输入媒体链接");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("媒体链接格式无效");
  }
  if (
    !["http:", "https:", "rtsp:", "rtsps:", "rtmp:", "rtmps:"].includes(
      url.protocol,
    )
  )
    throw new Error("支持 HTTP、HTTPS、RTSP 和 RTMP 媒体链接");
  return url;
}

export class JpegFrames {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];
    while (this.buffer.length) {
      const start = this.buffer.indexOf(Buffer.from([255, 216]));
      if (start < 0) {
        this.buffer = this.buffer.subarray(-1);
        break;
      }
      if (start) this.buffer = this.buffer.subarray(start);
      const end = this.buffer.indexOf(Buffer.from([255, 217]), 2);
      if (end < 0) break;
      const frame = this.buffer.subarray(0, end + 2);
      if (frame.length > 2 * 1024 * 1024) throw new Error("解码画面超过 2 MB");
      frames.push(frame);
      this.buffer = this.buffer.subarray(end + 2);
    }
    if (this.buffer.length > 2 * 1024 * 1024)
      throw new Error("解码画面超过 2 MB");
    return frames;
  }
}

export async function openCameraUrl(
  value: unknown,
  requested: unknown,
): Promise<CameraUrlSource> {
  const url = mediaUrl(value);
  if (!["image", "video", "stream"].includes(String(requested)))
    throw new Error(
      "请指明链接类型：image（图片）、video（视频）或 stream（实时视频流）",
    );
  const display = new URL(url);
  display.username = "";
  display.password = "";
  display.search = "";
  display.hash = "";
  return openMedia(url.href, requested as CameraUrlKind, display.href);
}

export function openCameraFile(
  path: string,
  kind: "image" | "video",
  name = basename(path),
) {
  return openMedia(path, kind, name, true);
}

async function openMedia(
  input: string,
  kind: CameraUrlKind,
  name: string,
  local = false,
): Promise<CameraUrlSource> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-threads",
    "2",
    "-protocol_whitelist",
    `${local ? "file," : ""}http,https,tcp,tls,udp,rtp,rtsp,rtmp,rtmps,crypto`,
  ];
  if (/^rtsps?:/.test(input))
    args.push("-rtsp_transport", "tcp", "-timeout", "10000000");
  else args.push("-rw_timeout", "10000000");
  if (local)
    args.push(
      "-format_whitelist",
      "image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe,avif,gif,mov,mp4,matroska,webm,mpegts,avi,mpeg,mpegvideo",
    );
  if (kind === "video") args.push("-re", "-stream_loop", "-1");
  args.push(
    "-i",
    input,
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-filter_threads",
    "1",
    "-vf",
    `scale=${CAMERA_WIDTH}:${CAMERA_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CAMERA_WIDTH}:${CAMERA_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1${kind === "image" ? "" : ",fps=12"}`,
    "-c:v",
    "mjpeg",
    "-pix_fmt",
    "yuvj420p",
    "-q:v",
    "3",
    "-threads",
    "2",
  );
  if (kind === "image") args.push("-frames:v", "1");
  args.push("-f", "image2pipe", "pipe:1");
  const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stopped = false;
  let latest: Buffer | undefined;
  let held: Buffer | undefined;
  let consumer: ((frame: Buffer) => Promise<void>) | undefined;
  let failure: ((error: Error) => void) | undefined;
  let pumping = false;
  let paused = false;
  let terminalError: Error | undefined;
  let repeat: ReturnType<typeof setInterval> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let received = false;
  let readyResolve: () => void = () => undefined;
  let readyReject: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const exited = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
  const close = async () => {
    if (!stopped) {
      stopped = true;
      latest = undefined;
      clearInterval(repeat);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
      killTimer.unref();
    }
    await exited;
    clearTimeout(killTimer);
  };
  const fail = (error: Error) => {
    if (stopped || terminalError) return;
    terminalError = error;
    readyReject(error);
    failure?.(error);
    void close();
  };
  const pump = async () => {
    if (pumping || !consumer || stopped || paused) return;
    pumping = true;
    try {
      while (latest && !stopped && !paused) {
        const frame = latest;
        latest = undefined;
        await consumer(frame);
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      pumping = false;
    }
  };
  const parser = new JpegFrames();
  child.stdout.on("data", (chunk: Buffer) => {
    if (stopped) return;
    try {
      for (const frame of parser.push(chunk)) {
        latest = frame;
        held = frame;
        received = true;
        readyResolve();
      }
      void pump();
    } catch (error) {
      fail(error as Error);
    }
  });
  child.stderr.resume();
  child.once("error", (error) =>
    fail(
      new Error(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "后端未安装 FFmpeg，请先安装或配置 FFMPEG_PATH"
          : "无法启动媒体解码服务",
      ),
    ),
  );
  child.once("close", (code) => {
    if (stopped) return;
    if (received && kind === "image") {
      repeat = setInterval(() => {
        latest = held;
        void pump();
      }, 150);
      repeat.unref();
      return;
    }
    fail(
      new Error(
        received
          ? `媒体流已中断（FFmpeg ${code}），请检查链接后重新推流`
          : "无法读取媒体画面，请检查直链、访问权限和编码",
      ),
    );
  });
  const timeout = setTimeout(
    () => fail(new Error("15 秒内未收到画面，请检查媒体链接是否可达")),
    15000,
  );
  try {
    await ready;
  } catch (error) {
    await close();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return {
    name,
    kind,
    start: (onFrame, onError) => {
      if (stopped) {
        onError(terminalError || new Error("媒体源已停止"));
        return;
      }
      consumer = onFrame;
      failure = onError;
      void pump();
    },
    pause: (value) => {
      paused = value;
      if (!paused) void pump();
    },
    close,
  };
}
