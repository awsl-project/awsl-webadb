import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MirrorDisplay } from "../src/components/MirrorView";
import { useFiles } from "../src/hooks/useFiles";
import type { AdbConnection } from "../src/types";
import { createOriginGuard } from "../server/request-origin";
import { normalizeLocale } from "../shared/locale";

test("origin guard rejects forged matching Host/Origin and absent-origin DNS rebinding", () => {
  const guard = createOriginGuard(
    "127.0.0.1",
    3000,
    new Set(["http://localhost:5173", "https://adb.example.com"]),
  );
  expect(
    guard({
      host: "attacker.example:3000",
      origin: "http://attacker.example:3000",
    }),
  ).toBe(false);
  expect(guard({ host: "attacker.example:3000" })).toBe(false);
  expect(
    guard({ host: "127.0.0.1:3000", origin: "http://attacker.example" }),
  ).toBe(false);
  expect(
    guard({ host: "127.0.0.1:3000", origin: "http://localhost:5173" }),
  ).toBe(true);
  expect(
    guard({ host: "localhost:3000", origin: "http://localhost:3000" }, true),
  ).toBe(true);
  expect(guard({ host: "[::1]:3000" })).toBe(true);
  expect(guard({ host: "127.0.0.1:3000" })).toBe(true);
  expect(guard({ host: "127.0.0.1:3000" }, true)).toBe(false);
  expect(
    guard({ host: "adb.example.com", origin: "https://adb.example.com" }, true),
  ).toBe(true);
  expect(
    guard({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000/" }),
  ).toBe(false);
  expect(guard({ host: "127.0.0.1:3000", origin: "null" })).toBe(false);
});

test("numeric regions and scripts are accepted and canonicalized", () => {
  expect(normalizeLocale("es-419")).toBe("es-419");
  expect(normalizeLocale("en-001")).toBe("en-001");
  expect(normalizeLocale("zh-hant-tw")).toBe("zh-Hant-TW");
  for (const value of ["", "en_US", "../es", "a".repeat(101)])
    expect(normalizeLocale(value)).toBeUndefined();
});

test("running app screenshot failure displays an alert and retry", () => {
  const html = renderToStaticMarkup(
    <MirrorDisplay
      canvasRef={{ current: null }}
      activeMirrorViewport={{ width: 960, height: 1280 }}
      mirrorRunning={true}
      mirrorPending=""
      message="画面读取失败"
      emptyLabel="画面读取失败"
      connectedMessage="应用已连接"
      onRetry={() => {}}
      onPointerDown={() => {}}
      onPointerMove={() => {}}
      onPointerUp={() => {}}
    />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("画面读取失败");
  expect(html).toContain("重试");
  const connected = renderToStaticMarkup(
    <MirrorDisplay
      canvasRef={{ current: null }}
      activeMirrorViewport={{ width: 960, height: 1280 }}
      mirrorRunning={true}
      mirrorPending=""
      message="应用已连接"
      connectedMessage="应用已连接"
      onPointerDown={() => {}}
      onPointerMove={() => {}}
      onPointerUp={() => {}}
    />,
  );
  expect(connected).not.toContain('role="alert"');
});

test("upload checks current remote entries before confirming overwrite, and cancels without writing", async () => {
  const originalWindow = globalThis.window;
  let confirms = 0,
    reads = 0,
    writes = 0;
  const messages: string[] = [];
  globalThis.window = {
    confirm: () => {
      confirms++;
      return false;
    },
  } as unknown as Window & typeof globalThis;
  try {
    const adb = {
      sync: {
        readdir: async () => {
          reads++;
          return [{ name: "report.txt" }];
        },
        write: async () => {
          writes++;
        },
      },
    } as unknown as AdbConnection;
    let files!: ReturnType<typeof useFiles>;
    function Harness() {
      files = useFiles(
        "1",
        (fn) => fn(adb),
        (msg) => messages.push(msg),
      );
      return null;
    }
    renderToStaticMarkup(<Harness />);
    // The hook's cached file list is empty; the remote file appeared after it was loaded.
    await files.uploadFiles([new File(["new content"], "report.txt")]);
    expect(reads).toBe(1);
    expect(confirms).toBe(1);
    expect(writes).toBe(0);
    expect(messages).toEqual([]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("upload never writes when remote conflict checking fails", async () => {
  let writes = 0;
  const messages: string[] = [];
  const adb = {
    sync: {
      readdir: async () => {
        throw new Error("Permission denied");
      },
      write: async () => {
        writes++;
      },
    },
  } as unknown as AdbConnection;
  let files!: ReturnType<typeof useFiles>;
  function Harness() {
    files = useFiles(
      "1",
      (fn) => fn(adb),
      (msg) => messages.push(msg),
    );
    return null;
  }
  renderToStaticMarkup(<Harness />);
  await files.uploadFiles([new File(["new"], "report.txt")]);
  expect(writes).toBe(0);
  expect(messages[0]).toContain("上传失败");
});

test("stopping a clone explicitly targets its Android user", async () => {
  const { useApps } = await import("../src/hooks/useApps");
  const commands: string[][] = [];
  const adb = {
    subprocess: {
      noneProtocol: {
        spawn: (args: string[]) => ({
          wait: async () => {
            commands.push(args);
          },
        }),
      },
    },
  } as unknown as AdbConnection;
  let apps!: ReturnType<typeof useApps>;
  function Harness() {
    apps = useApps(
      "1",
      (fn) => fn(adb),
      () => {},
    );
    return null;
  }
  renderToStaticMarkup(<Harness />);
  await apps.stopApp({
    packageName: "com.tencent.mm",
    userId: 999,
    name: "微信",
    icon: "apps",
    hue: 0,
    system: false,
  });
  expect(commands).toEqual([
    ["am", "force-stop", "--user", "999", "com.tencent.mm"],
  ]);
});

test("app list exposes distinct clone labels, running state and favorites", async () => {
  const { AppsView } = await import("../src/components/AppsView");
  const apps = [0, 999].map((userId) => ({
    userId,
    packageName: "com.tencent.mm",
    name: "微信",
    icon: "apps",
    hue: 0,
    system: false,
  }));
  const html = renderToStaticMarkup(
    <AppsView
      apps={apps}
      error=""
      pending=""
      hasDevice
      runningPackages={new Set(["999:com.tencent.mm"])}
      desktopPackages={new Set(["999:com.tencent.mm"])}
      onRefresh={() => {}}
      onLaunch={() => {}}
      onConnect={() => {}}
      onToggleDesktop={() => {}}
    />,
  );
  expect(html).toContain('aria-label="打开微信"');
  expect(html).toContain('aria-label="打开微信 · 用户 999"');
  expect(html).toContain('aria-label="固定到桌面微信"');
  expect(html).toContain('aria-label="从桌面移除微信 · 用户 999"');
  expect(html.match(/运行中/g)).toHaveLength(1);
});
