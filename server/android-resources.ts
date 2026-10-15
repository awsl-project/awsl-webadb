interface Chunk {
  start: number;
  headerSize: number;
  size: number;
  type: number;
}
interface ResourceValue {
  value: string;
  locale?: { language?: string; country?: string };
}

// Android ResourceTypes.h: supports sparse/16-bit offsets and compact entries.
export class AndroidResources {
  private readonly types: {
    chunk: Chunk;
    packageId: number;
    typeOffset: number;
  }[] = [];
  private pool?: Chunk;
  private readonly strings = new Map<number, string>();

  constructor(private readonly data: Buffer) {
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
      const language = this.data
        .subarray(chunk.start + 28, chunk.start + 30)
        .toString("ascii")
        .replaceAll("\0", "");
      const country = this.data
        .subarray(chunk.start + 30, chunk.start + 32)
        .toString("ascii")
        .replaceAll("\0", "");
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

  private chunk(start: number, end: number): Chunk {
    if (start + 8 > end) throw new Error("Truncated Android resource chunk");
    const type = this.data.readUInt16LE(start);
    const headerSize = this.data.readUInt16LE(start + 2);
    const size = this.data.readUInt32LE(start + 4);
    if (headerSize < 8 || size < headerSize || start + size > end)
      throw new Error("Invalid Android resource chunk size");
    return { start, type, headerSize, size };
  }

  private *children(parent: Chunk) {
    const end = parent.start + parent.size;
    let start = parent.start + parent.headerSize;
    while (start < end) {
      const child = this.chunk(start, end);
      yield child;
      start += child.size;
    }
  }

  private string(index: number) {
    const cached = this.strings.get(index);
    if (cached !== undefined) return cached;
    const pool = this.pool;
    if (
      !pool ||
      pool.headerSize < 28 ||
      index >= this.data.readUInt32LE(pool.start + 8)
    )
      return "";
    const end = pool.start + pool.size;
    const offsetAt = pool.start + pool.headerSize + index * 4;
    if (offsetAt + 4 > end) return "";
    let cursor =
      pool.start +
      this.data.readUInt32LE(pool.start + 20) +
      this.data.readUInt32LE(offsetAt);
    const utf8 = Boolean(this.data.readUInt32LE(pool.start + 16) & 0x100);
    const length = () => {
      const width = utf8 ? 1 : 2;
      if (cursor + width > end) throw new Error("Truncated Android string");
      let value = utf8 ? this.data[cursor] : this.data.readUInt16LE(cursor);
      cursor += width;
      const mask = utf8 ? 0x80 : 0x8000;
      if (value & mask) {
        if (cursor + width > end)
          throw new Error("Truncated Android string length");
        value =
          (value & (mask - 1)) * (utf8 ? 256 : 65536) +
          (utf8 ? this.data[cursor] : this.data.readUInt16LE(cursor));
        cursor += width;
      }
      return value;
    };
    let size = length();
    size = utf8 ? length() : size * 2;
    if (cursor < pool.start || cursor + size > end)
      throw new Error("Invalid Android string size");
    const value = this.data.toString(
      utf8 ? "utf8" : "utf16le",
      cursor,
      cursor + size,
    );
    this.strings.set(index, value);
    return value;
  }
}
