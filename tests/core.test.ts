import { describe, expect, test } from "bun:test";
import {
  formatError,
  getToastTone,
  normalizeDevicePath,
  getParentDevicePath,
  joinDevicePath,
} from "../src/utils";
import { parseLauncherApps } from "../shared/apps";
import { parseDeviceAddress } from "../shared/address";

describe("Android paths", () => {
  test("root stays root, including repeated slashes", () => {
    expect(normalizeDevicePath("/")).toBe("/");
    expect(normalizeDevicePath("///")).toBe("/");
    expect(getParentDevicePath("/")).toBe("/");
    expect(getParentDevicePath("/sdcard")).toBe("/");
    expect(joinDevicePath("/", "sdcard")).toBe("/sdcard");
  });
  test("normalizes relative segments without changing spaces inside names", () => {
    expect(normalizeDevicePath("/sdcard/DCIM/../My photos/./")).toBe(
      "/sdcard/My photos",
    );
    expect(normalizeDevicePath("../../")).toBe("/");
    expect(normalizeDevicePath("")).toBe("/sdcard");
  });
});

describe("device addresses", () => {
  test("accepts IPv4, IPv6 and hostnames with explicit ports", () => {
    expect(parseDeviceAddress(" 192.168.1.2:37123 ")?.host).toBe("192.168.1.2");
    expect(parseDeviceAddress("[2001:db8::1]:5555")?.host).toBe(
      "[2001:db8::1]",
    );
    expect(parseDeviceAddress("android.local:65535")?.port).toBe(65535);
  });
  test("rejects missing and invalid ports and command fragments", () => {
    for (const value of [
      "192.168.1.2",
      "host:0",
      "host:65536",
      "host:-1",
      "a:5555;id",
      "https://a:5555",
      "a b:5555",
      "a:",
    ])
      expect(parseDeviceAddress(value)).toBeNull();
  });
});

describe("read-only application discovery", () => {
  test("deduplicates launcher aliases and preserves launchable components", () => {
    const apps = parseLauncherApps(
      "3 activities found:\r\n  priority=0\r\n  com.example.app/.Main\r\n  com.example.app/.Alias\r\n  org.example.tool/org.example.tool.Main$Inner\r\n",
      "package:com.example.app\r\n",
    );
    expect(apps).toHaveLength(2);
    expect(apps[0]).toMatchObject({
      component: "com.example.app/.Main",
      packageName: "com.example.app",
      system: true,
    });
    expect(apps[1].system).toBe(false);
  });
  test("never parses error output as an app", () => {
    expect(
      parseLauncherApps("Error: no activities found\nnot/a.component\n", ""),
    ).toEqual([]);
  });
});

describe("device error messages", () => {
  test("access denials are readable error messages", () => {
    expect(formatError(new Error("open failed: Permission denied"))).toContain(
      "设备拒绝访问",
    );
    expect(getToastTone(formatError(new Error("Permission denied")))).toBe(
      "error",
    );
  });
});
