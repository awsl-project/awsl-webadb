import { AndroidBinary, type Chunk } from "./android-binary";
interface ResourceValue {
  value: string;
  locale?: { language?: string; country?: string };
}

// Android ResourceTypes.h: supports sparse/16-bit offsets and compact entries.
export class AndroidResources extends AndroidBinary {
  private readonly types: {
    chunk: Chunk;
    packageId: number;
    typeOffset: number;
  }[] = [];

  constructor(data: Buffer) {
    super(data);
    const root = this.chunk(0, data.length);
    if (root.type !== 2) throw new Error("Invalid Android resource table");
    for (const chunk of this.children(root)) {
      if (chunk.type === 1) this.pool = chunk;
      if (chunk.type !== 0x200 || chunk.headerSize < 284) continue;
      const packageId = data.readUInt32LE(chunk.start + 8);
      const typeOffset =
        chunk.headerSize >= 288 ? data.readUInt32LE(chunk.start + 284) : 0;
      for (const type of this.children(chunk)) {
        if (type.type === 0x201 && type.headerSize >= 32)
          this.types.push({ chunk: type, packageId, typeOffset });
      }
    }
  }

  resolve(id: number, visited = new Set<number>()): ResourceValue[] {
    if (!Number.isInteger(id) || visited.has(id) || visited.size >= 8)
      return [];
    const seen = new Set(visited).add(id);
    const packageId = (id >>> 24) & 0xff;
    const typeId = (id >>> 16) & 0xff;
    const entryId = id & 0xffff;
    const result: ResourceValue[] = [];
    for (const { chunk, packageId: owner, typeOffset } of this.types) {
      if (
        owner !== packageId ||
        this.data[chunk.start + 8] + typeOffset !== typeId
      )
        continue;
      const flags = this.data[chunk.start + 9];
      const count = this.data.readUInt32LE(chunk.start + 12);
      const entriesStart = this.data.readUInt32LE(chunk.start + 16);
      const offsetsStart = chunk.start + chunk.headerSize;
      if (entriesStart < chunk.headerSize || entriesStart > chunk.size)
        continue;
      let offset = -1;
      if (flags & 1) {
        if (count > (entriesStart - chunk.headerSize) / 4) continue;
        for (let index = 0; index < count; index++) {
          const at = offsetsStart + index * 4;
          if (this.data.readUInt16LE(at) === entryId) {
            offset = this.data.readUInt16LE(at + 2) * 4;
            break;
          }
        }
      } else {
        const width = flags & 2 ? 2 : 4;
        if (
          entryId >= count ||
          count > (entriesStart - chunk.headerSize) / width
        )
          continue;
        const at = offsetsStart + entryId * width;
        const raw =
          width === 2 ? this.data.readUInt16LE(at) : this.data.readUInt32LE(at);
        if (raw === (width === 2 ? 0xffff : 0xffffffff)) continue;
        offset = width === 2 ? raw * 4 : raw;
      }
      const entry = chunk.start + entriesStart + offset;
      const end = chunk.start + chunk.size;
      if (offset < 0 || entry + 8 > end) continue;
      const entryFlags = this.data.readUInt16LE(entry + 2);
      if (entryFlags & 1) continue;
      const compact = Boolean(entryFlags & 8);
      const valueAt = compact ? entry : entry + this.data.readUInt16LE(entry);
      if (valueAt < entry || valueAt + 8 > end) continue;
      const type = compact ? entryFlags >>> 8 : this.data[valueAt + 3];
      const value = this.data.readUInt32LE(valueAt + 4);
      const language = unpackLocale(this.data, chunk.start + 28, 97);
      const country = unpackLocale(this.data, chunk.start + 30, 48);
      const locale = language || country ? { language, country } : undefined;
      if (type === 3) result.push({ value: this.string(value), locale });
      if (type === 1)
        result.push(
          ...this.resolve(value, seen).map((item) => ({
            ...item,
            locale: locale ?? item.locale,
          })),
        );
    }
    return result;
  }
}

function unpackLocale(data: Buffer, at: number, base: number) {
  const first = data[at],
    second = data[at + 1];
  if (!(first & 0x80))
    return data.toString("ascii", at, at + 2).replaceAll("\0", "");
  return String.fromCharCode(
    base + (second & 31),
    base + ((second & 224) >> 5) + ((first & 3) << 3),
    base + ((first & 124) >> 2),
  );
}
