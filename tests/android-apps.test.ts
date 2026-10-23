import { expect, test } from "bun:test";
import {
  appKey,
  parseAppKey,
  parseAndroidUsers,
  parseUserId,
} from "../shared/apps";
import { readAndroidApps } from "../server/android-apps";
import type { AdbConnection } from "../src/types";

function device(blockClone = false) {
  const commands: string[][] = [];
  const adb = {
    subprocess: {
      noneProtocol: {
        spawn: (args: string[]) => ({
          wait: () => ({
            toString: async () => {
              commands.push(args);
              if (args.join(" ") === "pm list users")
                return "Users:\nUserInfo{0:Owner:13} running\nUserInfo{999:XSpace:800010} running";
              if (args.join(" ") === "am get-current-user") return "0";
              if (args.includes("999") && blockClone)
                return "Error: User is locked";
              if (args.includes("query-activities"))
                return "com.tencent.mm/.ui.LauncherUI\ncom.tencent.mm/.Alias\n";
              return "package:com.android.settings\n";
            },
          }),
        }),
      },
    },
  } as unknown as AdbConnection;
  return { adb, commands };
}

test("application identity preserves old owner favorites and distinguishes clone users", () => {
  expect(appKey({ packageName: "com.tencent.mm", userId: 0 })).toBe(
    "com.tencent.mm",
  );
  expect(appKey({ packageName: "com.tencent.mm", userId: 999 })).toBe(
    "999:com.tencent.mm",
  );
  expect(parseAppKey("com.tencent.mm")).toEqual({
    packageName: "com.tencent.mm",
    userId: 0,
  });
  expect(parseAppKey("999:com.tencent.mm")).toEqual({
    packageName: "com.tencent.mm",
    userId: 999,
  });
  for (const invalid of [
    "-1:com.tencent.mm",
    "999:com.tencent.mm:0",
    "1;id:com.tencent.mm",
    "21475:com.tencent.mm",
  ])
    expect(parseAppKey(invalid)).toBeUndefined();
  for (const invalid of [true, "", -1, 1.5, "1;id", 21475])
    expect(() => parseUserId(invalid)).toThrow();
  expect(() => parseAndroidUsers("Permission denied", 0)).toThrow();
});

test("read-only discovery lists both copies without deduplicating across users", async () => {
  const { adb, commands } = device();
  const result = await readAndroidApps(adb);
  expect(result.users).toEqual([
    { id: 0, current: true },
    { id: 999, current: false },
  ]);
  expect(result.apps.map(appKey)).toEqual([
    "com.tencent.mm",
    "999:com.tencent.mm",
  ]);
  expect(result.warnings).toEqual([]);
  expect(
    commands
      .filter((args) => args.includes("query-activities"))
      .map((args) => args[args.indexOf("--user") + 1]),
  ).toEqual(["0", "999"]);
  const clone = await readAndroidApps(adb, 999);
  expect(clone.apps).toHaveLength(1);
  expect(clone.apps[0].userId).toBe(999);
  expect(readAndroidApps(adb, 10)).rejects.toThrow("用户不存在");
});

test("locked or restricted profiles surface a warning without hiding the owner apps", async () => {
  const { adb } = device(true);
  const result = await readAndroidApps(adb);
  expect(result.apps.map(appKey)).toEqual(["com.tencent.mm"]);
  expect(result.warnings[0]).toContain("用户 999");
  expect(readAndroidApps(adb, 999)).rejects.toThrow("用户 999");
});
