/**
 * Smoke test: Sponge schematic v3 NBT byte generation.
 * Verifies NbtWriter, palette, block-data encoding, and gzipped output.
 *
 * Run with: node scripts/check-schematic.cjs
 */

const { gzipSync } = require("fflate");

// ── Tag enum (mirrors const enum in schematic.ts) ──────────────────────────
const Tag = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11
};

// ── NbtWriter ──────────────────────────────────────────────────────────────
class NbtWriter {
  constructor() { this.bytes = []; }
  writeByte(v) { this.bytes.push(v & 0xff); }
  writeShort(v) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
  writeInt(v) { this.bytes.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff); }
  writeStringPayload(v) {
    const enc = new TextEncoder().encode(v);
    this.writeShort(enc.length);
    this.bytes.push(...enc);
  }
  writeNamed(type, name) { this.writeByte(type); this.writeStringPayload(name); }
  writeString(name, value) { this.writeNamed(Tag.String, name); this.writeStringPayload(value); }
  writeIntTag(name, v) { this.writeNamed(Tag.Int, name); this.writeInt(v); }
  writeShortTag(name, v) { this.writeNamed(Tag.Short, name); this.writeShort(v); }
  writeByteArray(name, values) { this.writeNamed(Tag.ByteArray, name); this.writeInt(values.length); this.bytes.push(...values); }
  writeIntArray(name, values) { this.writeNamed(Tag.IntArray, name); this.writeInt(values.length); for (const v of values) this.writeInt(v); }
  endCompound() { this.writeByte(Tag.End); }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

function writeVarInt(value, output) {
  let current = value >>> 0;
  do {
    let temp = current & 0x7f;
    current >>>= 7;
    if (current !== 0) temp |= 0x80;
    output.push(temp);
  } while (current !== 0);
}

// ── Simplified schematic export (mirrors exportSpongeSchematic) ─────────────
function exportSchematic(blocks, name) {
  name = name || "btecad-export";
  const palette = new Map();
  const normalized = blocks.map((block) => {
    const key = block.blockType.includes(":") ? block.blockType : `minecraft:${block.blockType}`;
    if (!palette.has(key)) palette.set(key, palette.size);
    return { ...block, blockType: key };
  });
  if (!palette.has("minecraft:air")) palette.set("minecraft:air", palette.size);

  const minX = Math.min(...normalized.map((b) => b.x));
  const minY = Math.min(...normalized.map((b) => b.y));
  const minZ = Math.min(...normalized.map((b) => b.z));
  const maxX = Math.max(...normalized.map((b) => b.x));
  const maxY = Math.max(...normalized.map((b) => b.y));
  const maxZ = Math.max(...normalized.map((b) => b.z));
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const length = Math.max(1, maxZ - minZ + 1);
  const air = palette.get("minecraft:air");
  const dense = new Array(width * height * length).fill(air);
  for (const block of normalized) {
    const x = block.x - minX, y = block.y - minY, z = block.z - minZ;
    dense[(y * length + z) * width + x] = palette.get(block.blockType);
  }
  const blockData = [];
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
    blob: gzipped,
    stats: { blocks: normalized.length, paletteSize: palette.size }
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) { failed++; console.error(`  FAIL: ${message}`); }
  else { passed++; console.log(`  PASS: ${message}`); }
}

// ── Test 1: Empty block list ────────────────────────────────────────────────
console.log("\n=== Schematic Export Tests ===");

const emptyResult = exportSchematic([], "empty");
assert(emptyResult.fileName === "empty.schem", "empty schematic has correct filename");
assert(emptyResult.stats.blocks === 0, "empty schematic reports 0 blocks");
assert(emptyResult.stats.paletteSize === 1, "empty schematic palette has 1 entry (air only)");
assert(emptyResult.blob instanceof Uint8Array, "empty schematic produces gzipped bytes");
assert(emptyResult.blob.length > 0, "empty schematic output is non-empty (NBT header)");

// ── Test 2: Single block ───────────────────────────────────────────────────
const singleResult = exportSchematic([{ x: 0, y: 0, z: 0, blockType: "grass_block" }], "single");
assert(singleResult.stats.blocks === 1, "single block schematic reports 1 block");
assert(singleResult.stats.paletteSize === 2, "single block palette has 2 entries (grass + air)");
assert(singleResult.fileName === "single.schem", "single block schematic filename correct");

// ── Test 3: Multiple block types ────────────────────────────────────────────
const multiBlocks = [
  { x: 0, y: 0, z: 0, blockType: "grass_block" },
  { x: 1, y: 0, z: 0, blockType: "gray_concrete" },
  { x: 0, y: 0, z: 1, blockType: "blue_concrete" },
];
const multiResult = exportSchematic(multiBlocks, "multi");
assert(multiResult.stats.blocks === 3, "multi-block schematic reports 3 blocks");
assert(multiResult.stats.paletteSize === 4, "multi-block palette has 4 entries (3 types + air)");

// ── Test 4: Already namespaced blocks ──────────────────────────────────────
const namedResult = exportSchematic([
  { x: 0, y: 0, z: 0, blockType: "minecraft:stone_bricks" }
], "named");
assert(namedResult.stats.paletteSize === 2, "already-namespaced block doesn't duplicate in palette");

// ── Test 5: VarInt encoding ─────────────────────────────────────────────────
console.log("\n=== VarInt Encoding Tests ===");

function testVarInt(value, expectedBytes) {
  const output = [];
  writeVarInt(value, output);
  const match = output.length === expectedBytes.length && output.every((v, i) => v === expectedBytes[i]);
  assert(match, `VarInt(${value}) → [${output.join(",")}] expected [${expectedBytes.join(",")}]`);
}

testVarInt(0, [0]);
testVarInt(1, [1]);
testVarInt(127, [127]);
testVarInt(128, [128, 1]);
testVarInt(255, [255, 1]);
testVarInt(256, [128, 2]);
testVarInt(16383, [255, 127]);
testVarInt(16384, [128, 128, 1]);

// ── Test 6: Gzip produces valid output ──────────────────────────────────────
console.log("\n=== Gzip Output Tests ===");

const gzResult = exportSchematic([
  { x: 0, y: 0, z: 0, blockType: "stone_bricks" },
  { x: 1, y: 0, z: 0, blockType: "stone_bricks" },
  { x: 0, y: 1, z: 0, blockType: "oak_planks" },
], "gzip-test");

// Check gzip magic bytes (0x1f, 0x8b)
assert(gzResult.blob[0] === 0x1f && gzResult.blob[1] === 0x8b, "output starts with gzip magic bytes 0x1f 0x8b");

// Decompress and verify it starts with NBT compound tag (Tag.Compound = 10)
const { gunzipSync } = require("fflate");
const decompressed = gunzipSync(gzResult.blob);
assert(decompressed[0] === Tag.Compound, "decompressed NBT starts with Compound tag (0x0A)");

// ── Test 7: Schematic dimensions ───────────────────────────────────────────
console.log("\n=== Dimension Calculation Tests ===");

const dimResult = exportSchematic([
  { x: 5, y: 2, z: 3, blockType: "grass_block" },
  { x: 7, y: 4, z: 6, blockType: "grass_block" },
], "dims");

// Decompress and read Width/Height/Length from NBT
const dimDecomp = gunzipSync(dimResult.blob);
// Width, Height, Length are stored as Short tags after compound+Version+DataVersion
// Let's parse the raw NBT to find them
function readNbtShort(data, offset) {
  return (data[offset] << 8) | data[offset + 1];
}

// Quick NBT scan: find "Width" tag (Tag.Short + "Width")
function findShortValue(data, tagName) {
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === Tag.Short) {
      const nameLen = (data[i + 1] << 8) | data[i + 2];
      const name = new TextDecoder().decode(data.slice(i + 3, i + 3 + nameLen));
      if (name === tagName) {
        return (data[i + 3 + nameLen] << 8) | data[i + 4 + nameLen];
      }
    }
  }
  return null;
}

const w = findShortValue(dimDecomp, "Width");
const h = findShortValue(dimDecomp, "Height");
const l = findShortValue(dimDecomp, "Length");
assert(w === 3, `Width = ${w}, expected 3 (x: 5→7)`);
assert(h === 3, `Height = ${h}, expected 3 (y: 2→4)`);
assert(l === 4, `Length = ${l}, expected 4 (z: 3→6)`);

// ── Test 8: Default name parameter ─────────────────────────────────────────
const defaultNameResult = exportSchematic([{ x: 0, y: 0, z: 0, blockType: "grass_block" }]);
assert(defaultNameResult.fileName === "btecad-export.schem", "default name is 'btecad-export'");

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All schematic tests passed.");
}
