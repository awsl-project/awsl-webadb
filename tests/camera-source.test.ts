import { expect, test } from "bun:test";
import { JpegFrames, mediaUrl } from "../server/camera-source";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openCameraFile,
  openCameraUrl,
  type CameraUrlSource,
} from "../server/camera-source";
import { CAMERA_FORMATS, cameraFormat } from "../shared/camera-formats";

test("media sources accept network protocols and reject local or executable inputs", () => {
  for (const value of [
    "https://host/video.mp4",
    "http://192.168.1.2/live.m3u8",
    "rtsp://camera/live",
    "rtmp://host/live/key",
  ])
    expect(mediaUrl(value).href).toBe(value);
  for (const value of [
    "file:///etc/passwd",
    "concat:http://a|file:/etc/passwd",
    "data:image/png,abc",
    "-i secret",
    "not a URL",
  ])
    expect(() => mediaUrl(value)).toThrow();
});

test("MJPEG parser preserves frames across split markers, chunks and concatenated images", () => {
  const parser = new JpegFrames();
  expect(parser.push(Buffer.from([0, 255]))).toEqual([]);
  expect(parser.push(Buffer.from([216, 1, 2, 255]))).toEqual([]);
  const frames = parser.push(Buffer.from([217, 255, 216, 3, 255, 217, 255]));
  expect(frames.map((frame) => [...frame])).toEqual([
    [255, 216, 1, 2, 255, 217],
    [255, 216, 3, 255, 217],
  ]);
  expect(
    parser.push(Buffer.from([216, 4, 255, 217])).map((frame) => [...frame]),
  ).toEqual([[255, 216, 4, 255, 217]]);
  expect(() =>
    new JpegFrames().push(
      Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(2 * 1024 * 1024)]),
    ),
  ).toThrow("2 MB");
});

test("URL sources require an explicit supported media type", async () => {
  for (const kind of [undefined, "auto", "html"])
    await expect(openCameraUrl("https://host/media", kind)).rejects.toThrow(
      "链接类型",
    );
});

const ffmpeg =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const mediaTest = ffmpeg ? test : test.skip;
const fixture = new URL("./fixtures/camera-red.png", import.meta.url).pathname;
async function collect(source: CameraUrlSource, count: number) {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("后台来源没有持续供帧")),
        5000,
      );
      let received = 0;
      source.start(async (frame) => {
        if (++received === count) resolve(frame);
      }, reject);
    });
  } finally {
    clearTimeout(timeout!);
    await source.close();
  }
}
mediaTest(
  "background still image repeats after decoder exit and keeps portrait padding",
  async () => {
    const frame = await collect(
      await openCameraFile(fixture, "image", "red.png", "3:4"),
      3,
    );
    const decoded = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "mjpeg",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { input: frame, maxBuffer: 5 * 1024 * 1024 },
    );
    expect(decoded.status).toBe(0);
    expect(decoded.stdout.length).toBe(960 * 1280 * 3);
    const at = (x: number, y: number) => [
      ...decoded.stdout.subarray((y * 960 + x) * 3, (y * 960 + x) * 3 + 3),
    ];
    expect(at(480, 100).every((value) => value < 20)).toBe(true);
    expect(at(480, 640)[0]).toBeGreaterThan(230);
    expect(at(480, 640)[1]).toBeLessThan(30);
  },
);
mediaTest("each output ratio is encoded into the actual frames", async () => {
  for (const format of CAMERA_FORMATS) {
    const source = await openCameraFile(
      fixture,
      "image",
      "red.png",
      format.value,
    );
    const dimensions = { width: source.width, height: source.height };
    const frame = await collect(source, 1);
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height,sample_aspect_ratio",
        "-of",
        "json",
        "pipe:0",
      ],
      { input: frame },
    );
    expect(probe.status).toBe(0);
    const actual = JSON.parse(probe.stdout.toString()).streams[0];
    expect(actual.width).toBe(dimensions.width);
    expect(actual.height).toBe(dimensions.height);
    expect(actual.sample_aspect_ratio).toBe("1:1");
    if (format.value === "original") {
      expect(dimensions).toEqual({ width: 16, height: 8 });
      expect(Math.max(actual.width, actual.height)).toBeLessThanOrEqual(1280);
    } else {
      expect(dimensions).toEqual({
        width: format.width,
        height: format.height,
      });
    }
  }
});

test("unknown camera ratios are rejected before opening media", async () => {
  expect(cameraFormat().value).toBe("original");
  expect(() => cameraFormat("2:5")).toThrow("比例");
  await expect(
    openCameraFile(fixture, "image", "red.png", "bad"),
  ).rejects.toThrow("比例");
});

mediaTest(
  "original ratio bounds large video and normalizes non-square pixels",
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "webadb-camera-aspect-"));
    try {
      const file = join(folder, "wide.mp4");
      const generated = spawnSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-i",
        fixture,
        "-vf",
        "scale=1920:1080,setsar=2",
        "-t",
        "0.2",
        "-r",
        "12",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        file,
      ]);
      expect(generated.status).toBe(0);
      const source = await openCameraFile(file, "video");
      expect({ width: source.width, height: source.height }).toEqual({
        width: 1280,
        height: 360,
      });
      expect((await collect(source, 1)).length).toBeGreaterThan(100);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
mediaTest(
  "explicit URL image type works without an extension or browser CORS",
  async () => {
    const data = await readFile(fixture);
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "image/png");
      res.end(data);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as { port: number };
      const source = await openCameraUrl(
        `http://127.0.0.1:${address.port}/image?id=1`,
        "image",
      );
      expect(source.kind).toBe("image");
      expect((await collect(source, 2)).subarray(0, 2)).toEqual(
        Buffer.from([255, 216]),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
mediaTest("backend video loops beyond the original duration", async () => {
  const folder = await mkdtemp(join(tmpdir(), "webadb-camera-test-"));
  try {
    const file = join(folder, "video.mp4");
    const generated = spawnSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-i",
      fixture,
      "-t",
      "0.3",
      "-r",
      "12",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      file,
    ]);
    expect(generated.status).toBe(0);
    expect(
      (await collect(await openCameraFile(file, "video"), 16)).length,
    ).toBeGreaterThan(100);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
