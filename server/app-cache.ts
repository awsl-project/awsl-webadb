import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export interface AppMetadata {
  name?: string;
  icon?: { data: Buffer; contentType: string };
}

export function appDataDirectory() {
  return (
    process.env.WEBADB_DATA_DIR ||
    join(homedir(), ".local", "share", "awsl-webadb")
  );
}

function statePath(kind: "metadata" | "favorites", key: string) {
  return join(
    appDataDirectory(),
    kind,
    `${createHash("sha256").update(key).digest("hex")}.json`,
  );
}

async function readState(kind: "metadata" | "favorites", key: string) {
  try {
    return JSON.parse(await readFile(statePath(kind, key), "utf8"));
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return null;
    throw error;
  }
}

async function writeState(
  kind: "metadata" | "favorites",
  key: string,
  value: unknown,
) {
  const path = statePath(kind, key);
  await mkdir(join(appDataDirectory(), kind), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readAppMetadata(key: string) {
  const value = await readState("metadata", key);
  if (
    !value ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now()
  )
    return null;
  return {
    expiresAt: value.expiresAt as number,
    value: {
      name: typeof value.name === "string" ? value.name : undefined,
      icon:
        value.icon?.data && typeof value.icon.contentType === "string"
          ? {
              data: Buffer.from(value.icon.data, "base64"),
              contentType: value.icon.contentType,
            }
          : undefined,
    } satisfies AppMetadata,
  };
}

export async function writeAppMetadata(key: string, value: AppMetadata) {
  const expiresAt = Date.now() + APP_CACHE_TTL;
  await writeState("metadata", key, {
    expiresAt,
    name: value.name,
    icon: value.icon && {
      data: value.icon.data.toString("base64"),
      contentType: value.icon.contentType,
    },
  });
  return expiresAt;
}

export async function readFavorites(device: string): Promise<string[] | null> {
  const value = await readState("favorites", device);
  return Array.isArray(value) ? value : null;
}

export function writeFavorites(device: string, packages: string[]) {
  return writeState("favorites", device, packages);
}
