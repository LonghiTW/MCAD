import type { BlockCell, ChunkData, ChunkID, Vec2 } from "./types";

export const CHUNK_SIZE = 16;

export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function chunkCoordsForBlock(x: number, z: number) {
  return {
    cx: floorDiv(x, CHUNK_SIZE),
    cz: floorDiv(z, CHUNK_SIZE)
  };
}

export function chunkId(cx: number, cz: number): ChunkID {
  return `${cx},${cz}`;
}

export function localBlockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function createChunk(cx: number, cz: number): ChunkData {
  return {
    id: chunkId(cx, cz),
    cx,
    cz,
    blocks: new Map(),
    dirty: false,
    updatedAt: Date.now()
  };
}

export function setBlock(chunks: Map<ChunkID, ChunkData>, block: BlockCell): ChunkData {
  const { cx, cz } = chunkCoordsForBlock(block.x, block.z);
  const id = chunkId(cx, cz);
  const chunk = chunks.get(id) ?? createChunk(cx, cz);
  chunk.blocks.set(localBlockKey(block.x, block.y, block.z), block);
  chunk.dirty = true;
  chunk.updatedAt = Date.now();
  chunks.set(id, chunk);
  return chunk;
}

export function clearSourceBlocks(chunks: Map<ChunkID, ChunkData>, sourceGeometryId: string) {
  for (const chunk of chunks.values()) {
    let touched = false;
    for (const [key, block] of chunk.blocks) {
      if (block.sourceGeometryId === sourceGeometryId) {
        chunk.blocks.delete(key);
        touched = true;
      }
    }
    if (touched) {
      chunk.dirty = true;
      chunk.updatedAt = Date.now();
    }
  }
}

export function visibleChunkRange(center: Vec2, zoom: number, width: number, height: number) {
  const blocksWide = width / zoom;
  const blocksHigh = height / zoom;
  const minX = Math.floor(center.x - blocksWide / 2) - CHUNK_SIZE;
  const maxX = Math.ceil(center.x + blocksWide / 2) + CHUNK_SIZE;
  const minZ = Math.floor(center.z - blocksHigh / 2) - CHUNK_SIZE;
  const maxZ = Math.ceil(center.z + blocksHigh / 2) + CHUNK_SIZE;

  return {
    minCx: floorDiv(minX, CHUNK_SIZE),
    maxCx: floorDiv(maxX, CHUNK_SIZE),
    minCz: floorDiv(minZ, CHUNK_SIZE),
    maxCz: floorDiv(maxZ, CHUNK_SIZE)
  };
}

export function chunkReadout(x: number, z: number) {
  const blockX = Math.floor(x);
  const blockZ = Math.floor(z);
  const { cx, cz } = chunkCoordsForBlock(blockX, blockZ);
  return {
    cx,
    cz,
    localX: ((blockX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    localZ: ((blockZ % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE
  };
}
