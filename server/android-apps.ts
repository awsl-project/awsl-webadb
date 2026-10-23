import type { AdbConnection } from "../src/types";
import {
  parseAndroidUsers,
  parseLauncherApps,
  parseUserId,
} from "../shared/apps";

export async function readAndroidUsers(adb: AdbConnection) {
  const run = (args: string[]) =>
    adb.subprocess.noneProtocol.spawn(args).wait().toString();
  const [output, current] = await Promise.all([
    run(["pm", "list", "users"]),
    run(["am", "get-current-user"]),
  ]);
  return parseAndroidUsers(output, parseUserId(current.trim()));
}

export async function readAndroidApps(
  adb: AdbConnection,
  selectedUser?: number,
) {
  const users = await readAndroidUsers(adb);
  if (
    selectedUser !== undefined &&
    !users.some((user) => user.id === selectedUser)
  )
    throw new Error("Android 用户不存在或不可访问");
  const run = (args: string[]) =>
    adb.subprocess.noneProtocol.spawn(args).wait().toString();
  const profiles =
    selectedUser === undefined
      ? users
      : users.filter((user) => user.id === selectedUser);
  const warnings: string[] = [];
  const groups = await Promise.all(
    profiles.map(async (user) => {
      try {
        const [output, system] = await Promise.all([
          run([
            "cmd",
            "package",
            "query-activities",
            "--brief",
            "--user",
            String(user.id),
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
          ]),
          run(["pm", "list", "packages", "--user", String(user.id), "-s"]),
        ]);
        const apps = parseLauncherApps(output, system);
        const failure = [output, system].find((value) =>
          /Error:|Exception|Permission Denial|Permission denied/i.test(value),
        );
        if (failure) throw new Error(failure.trim().slice(0, 160));
        if (
          !apps.length &&
          !/No activities found|0 activities found/i.test(output)
        )
          throw new Error(output.trim().slice(0, 160) || "设备未返回应用");
        return apps.map((app) => ({ ...app, userId: user.id }));
      } catch (error) {
        const message = `用户 ${user.id}：${error instanceof Error ? error.message : String(error)}`;
        if (selectedUser !== undefined) throw new Error(message);
        warnings.push(message);
        return [];
      }
    }),
  );
  return { users, apps: groups.flat(), warnings };
}
