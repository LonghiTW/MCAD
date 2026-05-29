import type { BlockCell, Geometry, Vec2 } from "./types";

function stampCell(
  cells: Map<string, BlockCell>,
  x: number,
  z: number,
  y: number,
  blockType: string,
  sourceGeometryId: string,
  width: number
) {
  const radius = Math.max(0, Math.floor((width - 1) / 2));
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const bx = x + dx;
      const bz = z + dz;
      cells.set(`${bx},${y},${bz}`, { x: bx, y, z: bz, blockType, sourceGeometryId });
    }
  }
}

export function bresenhamLine(a: Vec2, b: Vec2): Vec2[] {
  let x0 = Math.round(a.x);
  let z0 = Math.round(a.z);
  const x1 = Math.round(b.x);
  const z1 = Math.round(b.z);
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  const points: Vec2[] = [];

  while (true) {
    points.push({ x: x0, z: z0 });
    if (x0 === x1 && z0 === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      z0 += sz;
    }
  }

  return points;
}

function pointInRing(point: Vec2, ring: Vec2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const intersects = zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Vec2, shell: Vec2[], holes: Vec2[][] = []) {
  if (!pointInRing(point, shell)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

export function scanlineFill(shell: Vec2[], holes: Vec2[][] = []): Vec2[] {
  if (shell.length < 3) return [];
  const minX = Math.floor(Math.min(...shell.map((p) => p.x)));
  const maxX = Math.ceil(Math.max(...shell.map((p) => p.x)));
  const minZ = Math.floor(Math.min(...shell.map((p) => p.z)));
  const maxZ = Math.ceil(Math.max(...shell.map((p) => p.z)));
  const filled: Vec2[] = [];

  for (let z = minZ; z <= maxZ; z += 1) {
    const intersections: number[] = [];
    for (let i = 0, j = shell.length - 1; i < shell.length; j = i, i += 1) {
      const a = shell[i];
      const b = shell[j];
      if (a.z === b.z) continue;
      if ((z >= a.z && z < b.z) || (z >= b.z && z < a.z)) {
        intersections.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const start = Math.ceil(intersections[i]);
      const end = Math.floor(intersections[i + 1] ?? intersections[i]);
      for (let x = start; x <= end; x += 1) {
        const point = { x: x + 0.5, z: z + 0.5 };
        if (pointInPolygon(point, shell, holes)) filled.push({ x, z });
      }
    }
  }

  return filled;
}

export function rasterizeGeometry(geometry: Geometry): BlockCell[] {
  const cells = new Map<string, BlockCell>();
  const blockType = geometry.properties.blockType;
  const width = Math.max(1, Math.round(geometry.properties.width ?? 1));
  const height = Math.max(1, Math.round(geometry.properties.height ?? 1));

  if (geometry.type === "polyline") {
    for (let i = 0; i < geometry.vertices.length - 1; i += 1) {
      for (const point of bresenhamLine(geometry.vertices[i], geometry.vertices[i + 1])) {
        stampCell(cells, point.x, point.z, 0, blockType, geometry.id, width);
      }
    }
  }

  if (geometry.type === "polygon") {
    for (const point of scanlineFill(geometry.vertices, geometry.holes)) {
      for (let y = 0; y < height; y += 1) {
        cells.set(`${point.x},${y},${point.z}`, {
          x: point.x,
          y,
          z: point.z,
          blockType,
          sourceGeometryId: geometry.id
        });
      }
    }
  }

  return [...cells.values()];
}
