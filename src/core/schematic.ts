import { gzipSync } from "fflate";
import type { BlockCell } from "./types";

export type SchematicExport = {
  fileName: string;
  blob: Blob;
  stats: {
    blocks: number;
    paletteSize: number;
  };
};

const enum Tag {
  End = 0,
  Byte = 1,
  Short = 2,
  Int = 3,
  ByteArray = 7,
  String = 8,
  List = 9,
  Compound = 10,
  IntArray = 11
}

class NbtWriter {
  private bytes: number[] = [];

  writeByte(value: number) {
    this.bytes.push(value & 0xff);
  }

  writeShort(value: number) {
    this.bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  writeInt(value: number) {
    this.bytes.push((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  }

  writeStringPayload(value: string) {
    const encoded = new TextEncoder().encode(value);
    this.writeShort(encoded.length);
    this.bytes.push(...encoded);
  }

  writeNamed(type: Tag, name: string) {
    this.writeByte(type);
    this.writeStringPayload(name);
  }

  writeString(name: string, value: string) {
    this.writeNamed(Tag.String, name);
    this.writeStringPayload(value);
  }

  writeIntTag(name: string, value: number) {
    this.writeNamed(Tag.Int, name);
    this.writeInt(value);
  }

  writeShortTag(name: string, value: number) {
    this.writeNamed(Tag.Short, name);
    this.writeShort(value);
  }

  writeByteArray(name: string, values: Uint8Array) {
    this.writeNamed(Tag.ByteArray, name);
    this.writeInt(values.length);
    this.bytes.push(...values);
  }

  writeIntArray(name: string, values: number[]) {
    this.writeNamed(Tag.IntArray, name);
    this.writeInt(values.length);
    for (const value of values) this.writeInt(value);
  }

  endCompound() {
    this.writeByte(Tag.End);
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }
}

function writeVarInt(value: number, output: number[]) {
  let current = value >>> 0;
  do {
    let temp = current & 0x7f;
    current >>>= 7;
    if (current !== 0) temp |= 0x80;
    output.push(temp);
  } while (current !== 0);
}

export function exportSpongeSchematic(blocks: BlockCell[], name = "btecad-export"): SchematicExport {
  const palette = new Map<string, number>();
  const normalized = blocks.map((block) => {
    const key = block.blockType.includes(":") ? block.blockType : `minecraft:${block.blockType}`;
    if (!palette.has(key)) palette.set(key, palette.size);
    return { ...block, blockType: key };
  });

  if (!palette.has("minecraft:air")) palette.set("minecraft:air", palette.size);

  const minX = normalized.length ? Math.min(...normalized.map((block) => block.x)) : 0;
  const minY = normalized.length ? Math.min(...normalized.map((block) => block.y)) : 0;
  const minZ = normalized.length ? Math.min(...normalized.map((block) => block.z)) : 0;
  const maxX = normalized.length ? Math.max(...normalized.map((block) => block.x)) : 0;
  const maxY = normalized.length ? Math.max(...normalized.map((block) => block.y)) : 0;
  const maxZ = normalized.length ? Math.max(...normalized.map((block) => block.z)) : 0;
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const length = Math.max(1, maxZ - minZ + 1);
  const air = palette.get("minecraft:air")!;
  const dense = new Array(width * height * length).fill(air);

  for (const block of normalized) {
    const x = block.x - minX;
    const y = block.y - minY;
    const z = block.z - minZ;
    dense[(y * length + z) * width + x] = palette.get(block.blockType)!;
  }

  const blockData: number[] = [];
  for (const value of dense) writeVarInt(value, blockData);

  const writer = new NbtWriter();
  writer.writeNamed(Tag.Compound, "Schematic");
  writer.writeIntTag("Version", 3);
  writer.writeIntTag("DataVersion", 3953);
  writer.writeShortTag("Width", width);
  writer.writeShortTag("Height", height);
  writer.writeShortTag("Length", length);
  writer.writeIntArray("Offset", [minX, minY, minZ]);

  writer.writeNamed(Tag.Compound, "Metadata");
  writer.writeString("Name", name);
  writer.writeString("CreatedBy", "BTECAD");
  writer.writeIntTag("Date", Math.floor(Date.now() / 1000));
  writer.endCompound();

  writer.writeNamed(Tag.Compound, "Blocks");
  writer.writeNamed(Tag.Compound, "Palette");
  for (const [blockType, index] of palette) writer.writeIntTag(blockType, index);
  writer.endCompound();
  writer.writeByteArray("Data", new Uint8Array(blockData));
  writer.endCompound();
  writer.endCompound();

  const gzipped = gzipSync(writer.toUint8Array());
  return {
    fileName: `${name}.schem`,
    blob: new Blob([gzipped], { type: "application/octet-stream" }),
    stats: {
      blocks: normalized.length,
      paletteSize: palette.size
    }
  };
}
