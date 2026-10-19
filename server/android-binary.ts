export interface Chunk {
  start: number;
  headerSize: number;
  size: number;
  type: number;
}
export class AndroidBinary {
  protected pool?: Chunk;
  private readonly strings = new Map<number, string>();
  constructor(protected readonly data: Buffer) {}
  protected chunk(start: number, end: number): Chunk {
    if (start + 8 > end) throw new Error("Truncated Android resource chunk");
    const type = this.data.readUInt16LE(start);
    const headerSize = this.data.readUInt16LE(start + 2);
    const size = this.data.readUInt32LE(start + 4);
    if (headerSize < 8 || size < headerSize || start + size > end)
      throw new Error("Invalid Android resource chunk size");
    return { start, type, headerSize, size };
  }

  protected *children(parent: Chunk) {
    const end = parent.start + parent.size;
    let start = parent.start + parent.headerSize;
    while (start < end) {
      const child = this.chunk(start, end);
      yield child;
      start += child.size;
    }
  }

  protected string(index: number) {
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
