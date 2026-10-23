import { expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  APP_CACHE_TTL,
  readAppMetadata,
  writeAppMetadata,
  readFavorites,
  writeFavorites,
} from "../server/app-cache";

test("disk metadata lasts seven days and expired or damaged entries are misses", async () => {
  const folder = await mkdtemp(join(tmpdir(), "webadb-cache-test-"));
  const previous = process.env.WEBADB_DATA_DIR;
  process.env.WEBADB_DATA_DIR = folder;
  try {
    const key = "device:com.example.app:zh-CN";
    expect(await readAppMetadata(key)).toBeNull();
    const value = {
      name: "应用",
      icon: { data: Buffer.from([1, 2, 3]), contentType: "image/png" },
    };
    const before = Date.now();
    const expires = await writeAppMetadata(key, value);
    expect(expires - before).toBeGreaterThanOrEqual(APP_CACHE_TTL);
    expect(expires - before).toBeLessThan(APP_CACHE_TTL + 1000);
    expect((await readAppMetadata(key))?.value).toEqual(value);
    expect(
      await readAppMetadata("other-device:com.example.app:zh-CN"),
    ).toBeNull();
    const path = join(
      folder,
      "metadata",
      (await readdir(join(folder, "metadata")))[0]!,
    );
    const saved = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({ ...saved, expiresAt: Date.now() - 1 }),
    );
    expect(await readAppMetadata(key)).toBeNull();
    await writeFile(path, "broken JSON");
    expect(await readAppMetadata(key)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.WEBADB_DATA_DIR;
    else process.env.WEBADB_DATA_DIR = previous;
    await rm(folder, { recursive: true, force: true });
  }
});

test("favorites are permanent, isolated by device and preserve an empty list", async () => {
  const folder = await mkdtemp(join(tmpdir(), "webadb-favorites-test-"));
  const previous = process.env.WEBADB_DATA_DIR;
  process.env.WEBADB_DATA_DIR = folder;
  try {
    expect(await readFavorites("phone")).toBeNull();
    await writeFavorites("phone", ["com.example.app", "999:com.example.app"]);
    const path = join(
      folder,
      "favorites",
      (await readdir(join(folder, "favorites")))[0]!,
    );
    await utimes(path, new Date(0), new Date(0));
    expect(await readFavorites("phone")).toEqual([
      "com.example.app",
      "999:com.example.app",
    ]);
    expect(await readFavorites("other-phone")).toBeNull();
    await writeFavorites("phone", []);
    expect(await readFavorites("phone")).toEqual([]);
    expect(
      (await readdir(join(folder, "favorites"))).every((name) =>
        name.endsWith(".json"),
      ),
    ).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.WEBADB_DATA_DIR;
    else process.env.WEBADB_DATA_DIR = previous;
    await rm(folder, { recursive: true, force: true });
  }
});
