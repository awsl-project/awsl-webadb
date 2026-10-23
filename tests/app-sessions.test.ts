import { expect, test } from "bun:test";
import express from "express";
import { installAppSessions } from "../server/app-sessions";
import type { AdbServerClient } from "@yume-chan/adb";
import type { CameraUrlSource } from "../server/camera-source";

async function fixture() {
  let failures = 0,
    displayId = 0,
    closeDelay = 0;
  const closed: string[] = [];
  const commands: string[][] = [];
  const requests: { type: string; displayId?: number }[] = [];
  const touches: { id: string; action: number; displayId: number }[] = [];
  const sources: (CameraUrlSource & { closed: boolean })[] = [];
  const client = {
    getDevices: async () =>
      [1n, 2n].map((transportId) => ({
        transportId,
        serial: `DEMO-${transportId}`,
        state: "device",
      })),
    createAdb: async ({ transportId }: { transportId: bigint }) => ({
      id: String(transportId),
      close: async () => {},
      subprocess: {
        noneProtocol: {
          spawn: (args: string[]) => ({
            wait: () => ({
              toString: async () => {
                commands.push(args.map((arg) => arg.replace(/^'|'$/g, "")));
                return args.join(" ").includes("resolve-activity")
                  ? "com.example.app/.Main"
                  : "";
              },
            }),
          }),
        },
      },
    }),
  };
  const dependencies = {
    createFileCamera: async (adb: { id: string }) => {
      if (failures > 0) {
        failures--;
        throw new Error("simulated helper failure");
      }
      let disconnect!: () => void,
        frames = 0;
      return {
        disconnected: new Promise<void>((resolve) => {
          disconnect = resolve;
        }),
        close: async () => {
          await Bun.sleep(closeDelay);
          closed.push(adb.id);
          disconnect();
        },
        createDisplay: async () => ++displayId,
        releaseDisplay: async () => {},
        request: async (command: { type: string; displayId?: number }) => {
          requests.push(command);
          return {
            jpeg: "/9j/2Q==",
            xml: `<hierarchy display="${command.displayId}"/>`,
            elements: [],
          };
        },
        sendFrame: async () => ++frames,
        touch: async (displayId: number, action: number) => {
          touches.push({ id: adb.id, action, displayId });
        },
      };
    },
    openCameraUrl: async (url: string, _kind: string, aspect: string) => {
      let timer: ReturnType<typeof setInterval>,
        paused = false,
        pending = false;
      const source = {
        aspect,
        width: aspect === "16:9" ? 1280 : 960,
        height: aspect === "16:9" ? 720 : 1280,
        name: url,
        kind: "video",
        closed: false,
        start: (consume: (bytes: Buffer) => Promise<void>) => {
          timer = setInterval(() => {
            if (paused || pending) return;
            pending = true;
            void consume(Buffer.from([255, 216, 255, 217])).finally(() => {
              pending = false;
            });
          }, 15);
        },
        close: async () => {
          source.closed = true;
          clearInterval(timer);
        },
        pause: (value: boolean) => {
          paused = value;
        },
      } as CameraUrlSource & { closed: boolean };
      sources.push(source);
      return source;
    },
    openCameraFile: async () => {
      throw new Error("unused");
    },
  };
  const app = express();
  const dispose = installAppSessions(
    app,
    client as unknown as AdbServerClient,
    "public/camera/webadb-camera.jar",
    3000,
    dependencies as unknown as NonNullable<
      Parameters<typeof installAppSessions>[4]
    >,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = "GET", body?: object) =>
    fetch(url + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const state = async () => (await request("/api/app-state")).json();
  const camera = (name: string, aspect = "3:4") =>
    request("/api/system-camera/url", "POST", {
      transportId: "1",
      url: name,
      kind: "video",
      aspect,
    });
  const open = async (id: string) =>
    (
      await request("/api/app-sessions", "POST", {
        transportId: id,
        packageName: "com.example.app",
      })
    ).json();
  const cleanup = async () => {
    await dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return {
    request,
    state,
    camera,
    open,
    sources,
    touches,
    closed,
    commands,
    requests,
    url,
    dispose,
    cleanup,
    fail: (count: number) => {
      failures = count;
    },
    closeDelay: (ms: number) => {
      closeDelay = ms;
    },
  };
}

test("camera replacement failure restores the old live source and pause control", async () => {
  const f = await fixture();
  try {
    expect((await f.camera("A")).ok).toBe(true);
    await Bun.sleep(70);
    f.fail(1);
    expect((await f.camera("B", "16:9")).status).toBe(400);
    expect(f.sources[0].closed).toBe(false);
    expect(f.sources[1].closed).toBe(true);
    const before = (await f.state()).cameras[0];
    await Bun.sleep(70);
    const after = (await f.state()).cameras[0];
    expect(after).toMatchObject({
      enabled: true,
      sourceName: "A",
      width: 960,
      height: 1280,
    });
    expect(after.lastFrameAt).toBeGreaterThan(before.lastFrameAt);
    expect(
      (
        await f.request("/api/system-camera/pause", "POST", {
          transportId: "1",
          paused: true,
        })
      ).ok,
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("failed stop restores the active source when an open app requires helper recreation", async () => {
  const f = await fixture();
  try {
    await f.open("1");
    await f.camera("A");
    f.fail(1);
    expect(
      (await f.request("/api/system-camera?transportId=1", "DELETE")).status,
    ).toBe(400);
    expect(f.sources[0].closed).toBe(false);
    const before = (await f.state()).cameras[0].lastFrameAt;
    await Bun.sleep(70);
    expect((await f.state()).cameras[0].lastFrameAt).toBeGreaterThan(before);
  } finally {
    await f.cleanup();
  }
});

test("failed replacement and rollback disable camera and clean both sources", async () => {
  const f = await fixture();
  try {
    await f.camera("A");
    f.fail(2);
    expect((await f.camera("B", "16:9")).status).toBe(400);
    expect((await f.state()).cameras[0].enabled).toBe(false);
    expect(f.sources.every((source) => source.closed)).toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("swipe yields to live frames, screenshots and another device without interleaving gestures", async () => {
  const f = await fixture();
  try {
    const one = await f.open("1"),
      two = await f.open("2");
    await f.camera("A");
    // Camera startup rebuilds the app display; fetch its current ID/state.
    const swipe = f.request(`/api/app-sessions/${one.id}/action`, "POST", {
      type: "swipe",
      x: 10,
      y: 10,
      endX: 100,
      endY: 100,
      duration: 1000,
    });
    while (!f.touches.some((item) => item.id === "1" && item.action === 0))
      await Bun.sleep(5);
    const before = (await f.state()).cameras[0].lastFrameAt;
    const queuedTap = f.request(`/api/app-sessions/${one.id}/action`, "POST", {
      type: "tap",
      x: 20,
      y: 20,
    });
    const started = Date.now();
    expect(
      (
        await f.request(`/api/app-sessions/${two.id}/action`, "POST", {
          type: "tap",
          x: 20,
          y: 20,
        })
      ).ok,
    ).toBe(true);
    expect((await f.request(`/api/app-sessions/${one.id}/screenshot`)).ok).toBe(
      true,
    );
    expect(Date.now() - started).toBeLessThan(500);
    await Bun.sleep(100);
    expect((await f.state()).cameras[0].lastFrameAt).toBeGreaterThan(before);
    expect((await swipe).ok).toBe(true);
    expect((await queuedTap).ok).toBe(true);
    expect(
      f.touches.filter((item) => item.id === "1").map((item) => item.action),
    ).toEqual([0, ...Array(12).fill(2), 1, 0, 1]);
  } finally {
    await f.cleanup();
  }
});

test("shutdown cleans slow devices in parallel and rejects new work", async () => {
  const f = await fixture();
  try {
    await Promise.all([f.open("1"), f.open("2")]);
    f.closeDelay(4000);
    const start = Date.now();
    const disposing = f.dispose();
    expect(
      (
        await f.request("/api/app-sessions", "POST", {
          transportId: "1",
          packageName: "com.example.app",
        })
      ).status,
    ).toBe(503);
    await disposing;
    expect(f.closed.sort()).toEqual(["1", "2"]);
    expect(Date.now() - start).toBeLessThan(6000);
  } finally {
    await f.cleanup();
  }
}, 8000);

test("same package on two users opens independent sessions and controls only its own display", async () => {
  const f = await fixture();
  const cli = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, "cli/index.ts", ...args, "--url", f.url],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, err).toBe(0);
    return JSON.parse(out);
  };
  try {
    const main = await cli(
      "open",
      "com.example.app",
      "--device",
      "1",
      "--user",
      "0",
    );
    const clone = await cli(
      "open",
      "com.example.app",
      "--device",
      "1",
      "--user",
      "999",
    );
    expect(main.userId).toBe(0);
    expect(clone.userId).toBe(999);
    expect(clone.id).not.toBe(main.id);
    expect(clone.displayId).not.toBe(main.displayId);
    expect(
      (await cli("open", "com.example.app", "--device", "1", "--user", "999"))
        .id,
    ).toBe(clone.id);
    expect(
      (await cli("sessions")).map((item: { userId: number }) => item.userId),
    ).toEqual([0, 999]);
    await cli("tap", clone.id, "20", "30");
    expect(f.touches.every((item) => item.displayId === clone.displayId)).toBe(
      true,
    );
    await cli("elements", clone.id);
    expect(f.requests.at(-1)).toMatchObject({
      type: "elements",
      displayId: clone.displayId,
    });
    const xml = await f.request(
      `/api/app-sessions/${main.id}/elements?format=xml`,
    );
    expect(await xml.text()).toContain(`display="${main.displayId}"`);
    const launches = f.commands.filter(
      (args) => args[0] === "am" && args[1] === "start",
    );
    expect(launches.map((args) => args[args.indexOf("--user") + 1])).toEqual([
      "0",
      "999",
      "999",
    ]);
    expect(
      f.commands
        .filter((args) => args.includes("resolve-activity"))
        .every((args) => args.includes("--user")),
    ).toBe(true);
    await cli("close", clone.id);
    expect(
      (await f.state()).sessions.map((item: { id: string }) => item.id),
    ).toEqual([main.id]);
    for (const userId of [-1, "999;id", 21475, null]) {
      const response = await f.request("/api/app-sessions", "POST", {
        transportId: "1",
        packageName: "com.example.app",
        userId,
      });
      expect(response.status).toBe(400);
    }
  } finally {
    await f.cleanup();
  }
});
