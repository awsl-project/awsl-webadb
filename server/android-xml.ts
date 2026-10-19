import { AndroidBinary } from "./android-binary";

interface XmlNode {
  tag: string;
  attributes: Record<string, string | number | boolean | null>;
  children: Record<string, XmlNode[]>;
}

export class AndroidXml extends AndroidBinary {
  readonly root: XmlNode = {
    tag: "xml",
    attributes: Object.create(null),
    children: Object.create(null),
  };
  constructor(data: Buffer) {
    super(data);
    const root = this.chunk(0, data.length);
    if (root.type !== 3) throw new Error("Invalid Android XML");
    const stack = [this.root];
    for (const chunk of this.children(root)) {
      if (chunk.type === 1) {
        this.pool = chunk;
        continue;
      }
      if (chunk.type === 0x103) {
        if (stack.length === 1) throw new Error("Invalid Android XML nesting");
        stack.pop();
        continue;
      }
      if (chunk.type !== 0x102) continue;
      if (
        !this.pool ||
        chunk.headerSize < 16 ||
        chunk.size < chunk.headerSize + 20
      )
        throw new Error("Invalid Android XML element");
      const at = chunk.start + chunk.headerSize;
      const node: XmlNode = {
        tag: this.string(data.readUInt32LE(at + 4)),
        attributes: Object.create(null),
        children: Object.create(null),
      };
      const start = data.readUInt16LE(at + 8);
      const size = data.readUInt16LE(at + 10);
      const count = data.readUInt16LE(at + 12);
      if (
        !node.tag ||
        start < 20 ||
        size < 20 ||
        at + start + count * size > chunk.start + chunk.size
      )
        throw new Error("Invalid Android XML attributes");
      for (let index = 0; index < count; index++) {
        const attr = at + start + index * size;
        const name = this.string(data.readUInt32LE(attr + 4));
        const type = data[attr + 15];
        const value = data.readUInt32LE(attr + 16);
        node.attributes[name] =
          type === 3
            ? this.string(value)
            : type === 0x12
              ? value !== 0
              : type === 1 || (type >= 0x10 && type <= 0x1f)
                ? value
                : null;
      }
      const parent = stack[stack.length - 1];
      (parent.children[node.tag] ??= []).push(node);
      stack.push(node);
    }
    if (stack.length !== 1) throw new Error("Truncated Android XML element");
  }
}

export function readManifest(data: Buffer) {
  const app = new AndroidXml(data).root.children.manifest?.[0]?.children
    .application?.[0];
  if (!app) throw new Error("Android manifest has no application");
  const label = app.attributes.label;
  const icon = app.attributes.icon;
  return {
    applicationLabel:
      typeof label === "number" || typeof label === "string" ? label : 0,
    applicationIcon: typeof icon === "number" ? icon : 0,
  };
}
