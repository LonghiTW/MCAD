import type { BlockCell, CircleGeometry, Geometry, PathGeometry, Vec2 } from "./types";

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
  let x0 = Math.floor(a.x);
  let z0 = Math.floor(a.z);
  const x1 = Math.floor(b.x);
  const z1 = Math.floor(b.z);
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

function rasterizeClosedRing(ring: Vec2[]): Vec2[] {
  if (ring.length < 2) return [];
  const points = new Map<string, Vec2>();
  for (let i = 0; i < ring.length; i += 1) {
    const next = ring[(i + 1) % ring.length];
    for (const point of bresenhamLine(ring[i], next)) {
      points.set(`${point.x},${point.z}`, point);
    }
  }
  return [...points.values()];
}

const CLOSED_SHAPE_LINE_OFFSET = 0.5;
const TARGET_CENTERLINE_DISTANCE = 0.25;

function signedRingArea(ring: Vec2[]) {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const next = ring[(i + 1) % ring.length];
    area += ring[i].x * next.z - next.x * ring[i].z;
  }
  return area / 2;
}

function cellCenterPoint(point: Vec2): Vec2 {
  return { x: Math.floor(point.x) + 0.5, z: Math.floor(point.z) + 0.5 };
}

function cellCenterRing(ring: Vec2[]): Vec2[] {
  return ring.map(cellCenterPoint);
}

// ── Per-edge cell-clipping polygon outline ─────────────────────────────────
// For each polygon edge, Bresenham-rasterize it, then classify every cell
// the line passes through by clipping its 1×1 square against the edge line.
// This guarantees every edge segment is handled independently with no
// miter/接角 artifacts.

/** Signed side of point P relative to directed line A→B (positive = left). */
function signedSide(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
}

/**
 * Clip a convex polygon by the half-plane on the positive (left) side
 * of directed line A→B.  Sutherland-Hodgman single-edge clip.
 */
function clipConvexByHalfPlane(poly: Vec2[], a: Vec2, b: Vec2): Vec2[] {
  if (poly.length < 3) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    const cs = signedSide(a, b, curr);
    const ns = signedSide(a, b, next);

    if (cs >= 0) out.push(curr);

    if ((cs >= 0) !== (ns >= 0)) {
      const denom = cs - ns;
      if (Math.abs(denom) > 1e-12) {
        const t = cs / denom;
        out.push({ x: curr.x + t * (next.x - curr.x), z: curr.z + t * (next.z - curr.z) });
      }
    }
  }
  return out;
}

/** Doubled signed area of a polygon (positive = CCW). */
function polyArea2(verts: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < verts.length; i += 1) {
    const next = verts[(i + 1) % verts.length];
    area += verts[i].x * next.z - next.x * verts[i].z;
  }
  return area;
}

function clippedCellArea(x: number, z: number, a: Vec2, b: Vec2, targetIsPositiveSide: boolean): number {
  const sq = CELL_UNIT_SQUARE.map((p) => ({ x: p.x + x, z: p.z + z }));
  const clipped = targetIsPositiveSide ? clipConvexByHalfPlane(sq, a, b) : clipConvexByHalfPlane(sq, b, a);
  return clipped.length >= 3 ? Math.abs(polyArea2(clipped)) / 2 : 0;
}

function signedTargetDistance(point: Vec2, a: Vec2, b: Vec2, targetIsPositiveSide: boolean): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const sign = targetIsPositiveSide ? 1 : -1;
  return (signedSide(a, b, point) * sign) / length;
}

function offsetCandidates(normalX: number, normalZ: number): Vec2[] {
  const stepX = Math.sign(normalX);
  const stepZ = Math.sign(normalZ);
  const candidates: Vec2[] = [{ x: 0, z: 0 }];
  if (stepX !== 0) candidates.push({ x: stepX, z: 0 });
  if (stepZ !== 0) candidates.push({ x: 0, z: stepZ });
  if (stepX !== 0 && stepZ !== 0) candidates.push({ x: stepX, z: stepZ });
  return candidates;
}

function chooseEdgeOffset(lineCells: Vec2[], a: Vec2, b: Vec2, targetIsPositiveSide: boolean, normalX: number, normalZ: number): Vec2 {
  let best = { x: 0, z: 0 };
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const offset of offsetCandidates(normalX, normalZ)) {
    let areaScore = 0;
    let wrongSidePenalty = 0;
    let distancePenalty = 0;

    for (const cell of lineCells) {
      const x = cell.x + offset.x;
      const z = cell.z + offset.z;
      const targetArea = clippedCellArea(x, z, a, b, targetIsPositiveSide);
      const otherArea = 1 - targetArea;
      const centerDistance = signedTargetDistance({ x: x + 0.5, z: z + 0.5 }, a, b, targetIsPositiveSide);

      areaScore += targetArea - otherArea;
      distancePenalty += Math.abs(centerDistance - TARGET_CENTERLINE_DISTANCE);
      if (centerDistance < -1e-9) wrongSidePenalty += Math.abs(centerDistance) + 1;
    }

    const shiftPenalty = Math.hypot(offset.x, offset.z) * 0.1;
    const score = areaScore * 2 - wrongSidePenalty * 100 - distancePenalty * 6 - shiftPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  }

  return best;
}

const CELL_UNIT_SQUARE: Vec2[] = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 1, z: 1 },
  { x: 0, z: 1 }
];

/**
 * Rasterize a single polygon edge and emit one block per Bresenham cell
 * on the requested side of the edge line.
 *
 * For each traversed cell:
 * - clip the cell's 1×1 square into target-side and other-side polygons
 * - if target area > other area → place block at current cell
 * - otherwise → nudge one cell towards the target-side normal
 * - ties (exactly 50/50) count as NOT on target side
 *
 * @param isCCW  true if the parent ring is counter-clockwise
 */
function rasterizeEdgeSide(
  a: Vec2, b: Vec2,
  targetSide: "inside" | "outside",
  isCCW: boolean
): Vec2[] {
  // For CCW ring: left of A→B = interior.  For CW: right = interior.
  const targetIsPositiveSide = (targetSide === "inside") === isCCW;

  const edgeDx = b.x - a.x;
  const edgeDz = b.z - a.z;
  const len = Math.hypot(edgeDx, edgeDz);
  if (len === 0) return [];

  // Unit normal pointing towards the target side
  const sign = targetIsPositiveSide ? 1 : -1;
  const normalX = (-edgeDz / len) * sign;
  const normalZ = (edgeDx / len) * sign;
  const lineCells = bresenhamLine(a, b);
  const offset = chooseEdgeOffset(lineCells, a, b, targetIsPositiveSide, normalX, normalZ);
  const placed = lineCells.map((cell) => ({ x: cell.x + offset.x, z: cell.z + offset.z }));

  return connectPathCells(placed);
}

function connectPathCells(points: Vec2[]): Vec2[] {
  const result = new Map<string, Vec2>();
  for (let i = 0; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous) {
      addCell(result, current.x, current.z);
      continue;
    }
    for (const point of bresenhamLine(previous, current)) addCell(result, point.x, point.z);
  }
  return [...result.values()];
}

function addConnectedEdge(cells: Map<string, Vec2>, points: Vec2[], previousPoint?: Vec2): Vec2 | undefined {
  if (points.length === 0) return previousPoint;
  if (previousPoint) {
    for (const point of bresenhamLine(previousPoint, points[0])) addCell(cells, point.x, point.z);
  }
  for (const point of points) addCell(cells, point.x, point.z);
  return points[points.length - 1];
}

function targetSideNormal(a: Vec2, b: Vec2, targetSide: "inside" | "outside", isCCW: boolean): Vec2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const targetIsPositiveSide = (targetSide === "inside") === isCCW;
  const sign = targetIsPositiveSide ? 1 : -1;
  return { x: (-dz / length) * sign, z: (dx / length) * sign };
}

function addOutsideCornerCell(cells: Map<string, Vec2>, ring: Vec2[], vertexIndex: number, isCCW: boolean) {
  const previous = ring[(vertexIndex - 1 + ring.length) % ring.length];
  const current = ring[vertexIndex];
  const next = ring[(vertexIndex + 1) % ring.length];
  const prevNormal = targetSideNormal(previous, current, "outside", isCCW);
  const nextNormal = targetSideNormal(current, next, "outside", isCCW);
  const cornerX = Math.sign(prevNormal.x + nextNormal.x);
  const cornerZ = Math.sign(prevNormal.z + nextNormal.z);
  if (cornerX === 0 && cornerZ === 0) return;
  addCell(cells, Math.floor(current.x + cornerX * 0.51), Math.floor(current.z + cornerZ * 0.51));
}

function filterRingSideCells(cells: Map<string, Vec2>, ring: Vec2[], targetSide: "inside" | "outside"): Vec2[] {
  const filtered = new Map<string, Vec2>();
  for (const point of cells.values()) {
    const center = { x: point.x + 0.5, z: point.z + 0.5 };
    const inside = pointInRing(center, ring);
    if ((targetSide === "inside" && inside) || (targetSide === "outside" && !inside)) addCell(filtered, point.x, point.z);
  }
  return [...filtered.values()];
}

function rasterizeSideRing(ring: Vec2[], targetSide: "inside" | "outside"): Vec2[] {
  const result = new Map<string, Vec2>();
  const isCCW = signedRingArea(ring) > 0;
  let firstPoint: Vec2 | undefined;
  let previousPoint: Vec2 | undefined;

  for (let i = 0; i < ring.length; i += 1) {
    const next = ring[(i + 1) % ring.length];
    const edgePoints = rasterizeEdgeSide(ring[i], next, targetSide, isCCW);
    if (!firstPoint && edgePoints.length > 0) firstPoint = edgePoints[0];
    previousPoint = addConnectedEdge(result, edgePoints, previousPoint);
  }

  if (targetSide === "outside") {
    for (let i = 0; i < ring.length; i += 1) addOutsideCornerCell(result, ring, i, isCCW);
  }

  if (previousPoint && firstPoint) {
    for (const point of bresenhamLine(previousPoint, firstPoint)) addCell(result, point.x, point.z);
  }

  return filterRingSideCells(result, ring, targetSide);
}

function addCell(cells: Map<string, Vec2>, x: number, z: number) {
  cells.set(`${x},${z}`, { x, z });
}

function closedShapeMode(geometry: Geometry) {
  return {
    boundaryMode: geometry.properties.boundaryMode ?? "center",
    solid: geometry.properties.solid ?? false,
    thickness: Math.max(1, Math.round(geometry.properties.closedShapeThickness ?? 1))
  };
}

function rasterizePolygonByMode(geometry: PathGeometry & { type: "polygon" }): Vec2[] {
  const { boundaryMode, solid, thickness } = closedShapeMode(geometry);
  if (boundaryMode === "center" && !solid) return rasterizeClosedRing(geometry.vertices);

  if (!solid && boundaryMode !== "center") {
    const result = new Map<string, Vec2>();
    const targetSide: "inside" | "outside" = boundaryMode === "outer" ? "inside" : "outside";
    const ring = cellCenterRing(geometry.vertices);
    for (const point of rasterizeSideRing(ring, targetSide)) addCell(result, point.x, point.z);
    for (const hole of geometry.holes ?? []) {
      const centeredHole = cellCenterRing(hole);
      const holeTargetSide: "inside" | "outside" = targetSide === "inside" ? "outside" : "inside";
      for (const point of rasterizeSideRing(centeredHole, holeTargetSide)) addCell(result, point.x, point.z);
    }
    return [...result.values()];
  }

  const result = new Map<string, Vec2>();
  const outline = rasterizeClosedRing(geometry.vertices);
  const holes = geometry.holes ?? [];
  for (const hole of holes) {
    for (const point of rasterizeClosedRing(hole)) addCell(result, point.x, point.z);
  }

  const minX = Math.floor(Math.min(...geometry.vertices.map((p) => p.x))) - thickness - 2;
  const maxX = Math.ceil(Math.max(...geometry.vertices.map((p) => p.x))) + thickness + 2;
  const minZ = Math.floor(Math.min(...geometry.vertices.map((p) => p.z))) - thickness - 2;
  const maxZ = Math.ceil(Math.max(...geometry.vertices.map((p) => p.z))) + thickness + 2;

  const distanceToOutline = (x: number, z: number) => {
    const point = { x: x + 0.5, z: z + 0.5 };
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < geometry.vertices.length; i += 1) {
      const next = geometry.vertices[(i + 1) % geometry.vertices.length];
      const dx = next.x - geometry.vertices[i].x;
      const dz = next.z - geometry.vertices[i].z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((point.x - geometry.vertices[i].x) * dx + (point.z - geometry.vertices[i].z) * dz) / len2));
      best = Math.min(best, Math.hypot(point.x - (geometry.vertices[i].x + t * dx), point.z - (geometry.vertices[i].z + t * dz)));
    }
    return best;
  };

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const center = { x: x + 0.5, z: z + 0.5 };
      const inside = pointInPolygon(center, geometry.vertices, holes);
      const near = distanceToOutline(x, z) <= thickness;
      if (boundaryMode === "center" && solid && inside) addCell(result, x, z);
      if (boundaryMode === "outer" && (solid ? inside : inside && near)) addCell(result, x, z);
      if (boundaryMode === "inner" && (solid ? !inside && near : !inside && near)) addCell(result, x, z);
    }
  }

  if (boundaryMode === "center" || !solid) {
    for (const point of outline) addCell(result, point.x, point.z);
  }
  return [...result.values()];
}

export function rasterizeCircleOutline(center: Vec2, radius: number): Vec2[] {
  const distanceToCellCenter = Math.hypot(center.x - (Math.floor(center.x) + 0.5), center.z - (Math.floor(center.z) + 0.5));
  const distanceToCorner = Math.hypot(center.x - Math.round(center.x), center.z - Math.round(center.z));
  if (distanceToCorner < distanceToCellCenter) return rasterizeCornerCenteredCircleOutline(center, radius);

  const cells = new Map<string, Vec2>();
  const cx = Math.floor(center.x);
  const cz = Math.floor(center.z);
  let x = Math.max(0, Math.round(radius));
  let z = 0;
  let err = 1 - x;

  const put = (dx: number, dz: number) => {
    const points: Vec2[] = [
      { x: cx + dx, z: cz + dz },
      { x: cx + dz, z: cz + dx },
      { x: cx - dz, z: cz + dx },
      { x: cx - dx, z: cz + dz },
      { x: cx - dx, z: cz - dz },
      { x: cx - dz, z: cz - dx },
      { x: cx + dz, z: cz - dx },
      { x: cx + dx, z: cz - dz }
    ];
    for (const point of points) cells.set(`${point.x},${point.z}`, point);
  };

  while (x >= z) {
    put(x, z);
    z += 1;
    if (err < 0) {
      err += 2 * z + 1;
    } else {
      x -= 1;
      err += 2 * (z - x) + 1;
    }
  }

  return [...cells.values()];
}

function rasterizeCornerCenteredCircleOutline(center: Vec2, radius: number): Vec2[] {
  const cells = new Map<string, Vec2>();
  const cx = Math.round(center.x);
  const cz = Math.round(center.z);
  const r = Math.max(0, radius);
  const halfThickness = 0.5;
  const minX = Math.floor(cx - r - 1);
  const maxX = Math.ceil(cx + r);
  const minZ = Math.floor(cz - r - 1);
  const maxZ = Math.ceil(cz + r);

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const cellCenterX = x + 0.5;
      const cellCenterZ = z + 0.5;
      const distance = Math.hypot(cellCenterX - cx, cellCenterZ - cz);
      if (Math.abs(distance - r) <= halfThickness) cells.set(`${x},${z}`, { x, z });
    }
  }

  return [...cells.values()];
}

function rasterizeCircleByMode(geometry: CircleGeometry): Vec2[] {
  const { boundaryMode, solid, thickness } = closedShapeMode(geometry);
  if (boundaryMode === "center" && !solid) return rasterizeCircleOutline(geometry.center, geometry.radius);

  if (!solid && boundaryMode !== "center") {
    const offset = boundaryMode === "outer" ? -CLOSED_SHAPE_LINE_OFFSET : CLOSED_SHAPE_LINE_OFFSET;
    return rasterizeCircleOutline(geometry.center, Math.max(0, geometry.radius + offset));
  }

  const cells = new Map<string, Vec2>();
  const radius = Math.max(0, geometry.radius);
  const minX = Math.floor(geometry.center.x - radius - thickness - 2);
  const maxX = Math.ceil(geometry.center.x + radius + thickness + 2);
  const minZ = Math.floor(geometry.center.z - radius - thickness - 2);
  const maxZ = Math.ceil(geometry.center.z + radius + thickness + 2);

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const distance = Math.hypot(x + 0.5 - geometry.center.x, z + 0.5 - geometry.center.z);
      const inside = distance <= radius;
      const near = Math.abs(distance - radius) <= thickness;
      if (boundaryMode === "center" && solid && inside) addCell(cells, x, z);
      if (boundaryMode === "outer" && (solid ? inside : inside && near)) addCell(cells, x, z);
      if (boundaryMode === "inner" && (solid ? !inside && near : !inside && near)) addCell(cells, x, z);
    }
  }

  if (boundaryMode === "center" || !solid) {
    for (const point of rasterizeCircleOutline(geometry.center, geometry.radius)) addCell(cells, point.x, point.z);
  }

  return [...cells.values()];
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

/**
 * Rasterize a geometry into BlockCells.
 * @param geometry The geometry to rasterize.
 * @param layerOffsetY Optional vertical offset from the geometry's parent GeometryLayer.
 */
export function rasterizeGeometry(geometry: Geometry, layerOffsetY = 0): BlockCell[] {
  const cells = new Map<string, BlockCell>();
  const blockType = geometry.properties.blockType;
  const width = Math.max(1, Math.round(geometry.properties.width ?? 1));
  const baseY = Math.round(geometry.properties.baseY ?? 0) + layerOffsetY;

  if (geometry.type === "polyline") {
    // lineStackHeight: extrude the polyline upward as a wall
    const stackHeight = Math.max(1, Math.round(geometry.properties.lineStackHeight ?? 1));
    for (let i = 0; i < geometry.vertices.length - 1; i += 1) {
      for (const point of bresenhamLine(geometry.vertices[i], geometry.vertices[i + 1])) {
        for (let y = baseY; y < baseY + stackHeight; y += 1) {
          stampCell(cells, point.x, point.z, y, blockType, geometry.id, width);
        }
      }
    }
  }

  if (geometry.type === "circle") {
    for (const point of rasterizeCircleByMode(geometry)) {
      cells.set(`${point.x},${baseY},${point.z}`, {
        x: point.x,
        y: baseY,
        z: point.z,
        blockType,
        sourceGeometryId: geometry.id
      });
    }
  }

  if (geometry.type === "polygon") {
    for (const point of rasterizePolygonByMode(geometry as PathGeometry & { type: "polygon" })) {
      cells.set(`${point.x},${baseY},${point.z}`, {
        x: point.x,
        y: baseY,
        z: point.z,
        blockType,
        sourceGeometryId: geometry.id
      });
    }
  }

  return [...cells.values()];
}
