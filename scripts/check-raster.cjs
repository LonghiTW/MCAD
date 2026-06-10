/**
 * Smoke test: Bresenham line rasterization, polygon scanline fill, and chunk assignment.
 * Run with: node scripts/check-raster.cjs
 */

// ── Bresenham line ──────────────────────────────────────────────────────────
function bresenhamLine(a, b) {
  let x0 = Math.floor(a.x);
  let z0 = Math.floor(a.z);
  const x1 = Math.floor(b.x);
  const z1 = Math.floor(b.z);
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  const points = [];
  while (true) {
    points.push({ x: x0, z: z0 });
    if (x0 === x1 && z0 === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
  return points;
}

// ── Scanline fill ───────────────────────────────────────────────────────────
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i++) {
    const xi = ring[i].x, zi = ring[i].z;
    const xj = ring[j].x, zj = ring[j].z;
    const intersects = zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, shell, holes) {
  holes = holes || [];
  if (!pointInRing(point, shell)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function scanlineFill(shell, holes) {
  holes = holes || [];
  if (shell.length < 3) return [];
  const minX = Math.floor(Math.min(...shell.map((p) => p.x)));
  const maxX = Math.ceil(Math.max(...shell.map((p) => p.x)));
  const minZ = Math.floor(Math.min(...shell.map((p) => p.z)));
  const maxZ = Math.ceil(Math.max(...shell.map((p) => p.z)));
  const filled = [];
  for (let z = minZ; z <= maxZ; z++) {
    const intersections = [];
    for (let i = 0, j = shell.length - 1; i < shell.length; j = i, i++) {
      const a = shell[i], b = shell[j];
      if (a.z === b.z) continue;
      if ((z >= a.z && z < b.z) || (z >= b.z && z < a.z)) {
        intersections.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const start = Math.ceil(intersections[i]);
      const end = Math.floor(intersections[i + 1] ?? intersections[i]);
      for (let x = start; x <= end; x++) {
        const point = { x: x + 0.5, z: z + 0.5 };
        if (pointInPolygon(point, shell, holes)) filled.push({ x, z });
      }
    }
  }
  return filled;
}

function rasterizeClosedRing(ring) {
  if (ring.length < 2) return [];
  const points = new Map();
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length];
    for (const point of bresenhamLine(ring[i], next)) points.set(`${point.x},${point.z}`, point);
  }
  return [...points.values()];
}

function rasterizePolygonOutline(shell, holes) {
  const points = new Map();
  for (const point of rasterizeClosedRing(shell)) points.set(`${point.x},${point.z}`, point);
  for (const hole of holes || []) {
    for (const point of rasterizeClosedRing(hole)) points.set(`${point.x},${point.z}`, point);
  }
  return [...points.values()];
}

function signedRingArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length];
    area += ring[i].x * next.z - next.x * ring[i].z;
  }
  return area / 2;
}

function cellCenterPoint(point) {
  return { x: Math.floor(point.x) + 0.5, z: Math.floor(point.z) + 0.5 };
}

function cellCenterRing(ring) {
  return ring.map(cellCenterPoint);
}

function signedSide(a, b, point) {
  return (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
}

function clipConvexByHalfPlane(poly, a, b) {
  if (poly.length < 3) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
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

function polyArea2(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.z - next.x * points[i].z;
  }
  return area;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.z - next.x * points[i].z;
  }
  return Math.abs(area) / 2;
}

const CELL_UNIT_SQUARE = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 1, z: 1 },
  { x: 0, z: 1 }
];

const TARGET_CENTERLINE_DISTANCE = 0.25;

function clippedTargetArea(x, z, a, b, targetIsPositiveSide) {
  const sq = CELL_UNIT_SQUARE.map((p) => ({ x: p.x + x, z: p.z + z }));
  const clipped = targetIsPositiveSide ? clipConvexByHalfPlane(sq, a, b) : clipConvexByHalfPlane(sq, b, a);
  return clipped.length >= 3 ? Math.abs(polyArea2(clipped)) / 2 : 0;
}

function signedTargetDistance(point, a, b, targetIsPositiveSide) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const sign = targetIsPositiveSide ? 1 : -1;
  return (signedSide(a, b, point) * sign) / length;
}

function offsetCandidates(normalX, normalZ) {
  const stepX = Math.sign(normalX);
  const stepZ = Math.sign(normalZ);
  const candidates = [{ x: 0, z: 0 }];
  if (stepX !== 0) candidates.push({ x: stepX, z: 0 });
  if (stepZ !== 0) candidates.push({ x: 0, z: stepZ });
  if (stepX !== 0 && stepZ !== 0) candidates.push({ x: stepX, z: stepZ });
  return candidates;
}

function chooseEdgeOffset(lineCells, a, b, targetIsPositiveSide, normalX, normalZ) {
  let best = { x: 0, z: 0 };
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const offset of offsetCandidates(normalX, normalZ)) {
    let areaScore = 0;
    let wrongSidePenalty = 0;
    let distancePenalty = 0;
    for (const cell of lineCells) {
      const x = cell.x + offset.x;
      const z = cell.z + offset.z;
      const targetArea = clippedTargetArea(x, z, a, b, targetIsPositiveSide);
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

function clippedCellArea(x, z, a, b, normalSign) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const normal = { x: -dz * normalSign, z: dx * normalSign };
  const signedDistance = (point) => (point.x - a.x) * normal.x + (point.z - a.z) * normal.z;
  const intersection = (from, to, fromDistance, toDistance) => {
    const t = fromDistance / (fromDistance - toDistance);
    return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
  };
  const square = [{ x, z }, { x: x + 1, z }, { x: x + 1, z: z + 1 }, { x, z: z + 1 }];
  const clipped = [];

  for (let i = 0; i < square.length; i++) {
    const current = square[i];
    const previous = square[(i - 1 + square.length) % square.length];
    const currentDistance = signedDistance(current);
    const previousDistance = signedDistance(previous);
    const currentInside = currentDistance >= -1e-9;
    const previousInside = previousDistance >= -1e-9;
    if (currentInside) {
      if (!previousInside) clipped.push(intersection(previous, current, previousDistance, currentDistance));
      clipped.push(current);
    } else if (previousInside) {
      clipped.push(intersection(previous, current, previousDistance, currentDistance));
    }
  }

  return polygonArea(clipped);
}

function connectPathCells(points) {
  const result = new Map();
  for (let i = 0; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous) {
      result.set(`${current.x},${current.z}`, current);
      continue;
    }
    for (const point of bresenhamLine(previous, current)) result.set(`${point.x},${point.z}`, point);
  }
  return [...result.values()];
}

function rasterizeEdgeSide(a, b, side, isCCW) {
  const targetIsPositiveSide = (side === "inside") === isCCW;
  const edgeDx = b.x - a.x;
  const edgeDz = b.z - a.z;
  const len = Math.hypot(edgeDx, edgeDz);
  if (len === 0) return [];

  const sign = targetIsPositiveSide ? 1 : -1;
  const normalX = (-edgeDz / len) * sign;
  const normalZ = (edgeDx / len) * sign;
  const lineCells = bresenhamLine(a, b);
  const offset = chooseEdgeOffset(lineCells, a, b, targetIsPositiveSide, normalX, normalZ);
  const placed = lineCells.map((cell) => ({ x: cell.x + offset.x, z: cell.z + offset.z }));

  return connectPathCells(placed);
}

function addConnectedEdge(cells, points, previousPoint) {
  if (points.length === 0) return previousPoint;
  if (previousPoint) {
    for (const point of bresenhamLine(previousPoint, points[0])) cells.set(`${point.x},${point.z}`, point);
  }
  for (const point of points) cells.set(`${point.x},${point.z}`, point);
  return points[points.length - 1];
}

function targetSideNormal(a, b, side, isCCW) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const targetIsPositiveSide = (side === "inside") === isCCW;
  const sign = targetIsPositiveSide ? 1 : -1;
  return { x: (-dz / length) * sign, z: (dx / length) * sign };
}

function addOutsideCornerCell(cells, ring, vertexIndex, isCCW) {
  const previous = ring[(vertexIndex - 1 + ring.length) % ring.length];
  const current = ring[vertexIndex];
  const next = ring[(vertexIndex + 1) % ring.length];
  const prevNormal = targetSideNormal(previous, current, "outside", isCCW);
  const nextNormal = targetSideNormal(current, next, "outside", isCCW);
  const cornerX = Math.sign(prevNormal.x + nextNormal.x);
  const cornerZ = Math.sign(prevNormal.z + nextNormal.z);
  if (cornerX === 0 && cornerZ === 0) return;
  const point = { x: Math.floor(current.x + cornerX * 0.51), z: Math.floor(current.z + cornerZ * 0.51) };
  cells.set(`${point.x},${point.z}`, point);
}

function filterRingSideCells(cells, ring, side) {
  const filtered = new Map();
  for (const point of cells.values()) {
    const center = { x: point.x + 0.5, z: point.z + 0.5 };
    const inside = pointInRing(center, ring);
    if ((side === "inside" && inside) || (side === "outside" && !inside)) filtered.set(`${point.x},${point.z}`, point);
  }
  return [...filtered.values()];
}

function rasterizeSplitSideRing(ring, side) {
  const cells = new Map();
  const centeredRing = cellCenterRing(ring);
  const isCCW = signedRingArea(centeredRing) > 0;
  let firstPoint;
  let previousPoint;
  for (let i = 0; i < centeredRing.length; i++) {
    const a = centeredRing[i];
    const b = centeredRing[(i + 1) % centeredRing.length];
    if (a.x === b.x && a.z === b.z) continue;
    const edgePoints = rasterizeEdgeSide(a, b, side, isCCW);
    if (!firstPoint && edgePoints.length > 0) firstPoint = edgePoints[0];
    previousPoint = addConnectedEdge(cells, edgePoints, previousPoint);
  }
  if (side === "outside") {
    for (let i = 0; i < centeredRing.length; i++) addOutsideCornerCell(cells, centeredRing, i, isCCW);
  }
  if (previousPoint && firstPoint) {
    for (const point of bresenhamLine(previousPoint, firstPoint)) cells.set(`${point.x},${point.z}`, point);
  }
  return filterRingSideCells(cells, centeredRing, side);
}

function rasterizeCircleOutline(center, radius) {
  const distanceToCellCenter = Math.hypot(center.x - (Math.floor(center.x) + 0.5), center.z - (Math.floor(center.z) + 0.5));
  const distanceToCorner = Math.hypot(center.x - Math.round(center.x), center.z - Math.round(center.z));
  if (distanceToCorner < distanceToCellCenter) return rasterizeCornerCenteredCircleOutline(center, radius);

  const cells = new Map();
  const cx = Math.floor(center.x);
  const cz = Math.floor(center.z);
  let x = Math.max(0, Math.round(radius));
  let z = 0;
  let err = 1 - x;
  const put = (dx, dz) => {
    const points = [
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
    if (err < 0) err += 2 * z + 1;
    else {
      x -= 1;
      err += 2 * (z - x) + 1;
    }
  }
  return [...cells.values()];
}

function rasterizeCornerCenteredCircleOutline(center, radius) {
  const cells = new Map();
  const cx = Math.round(center.x);
  const cz = Math.round(center.z);
  const r = Math.max(0, radius);
  const halfThickness = 0.5;
  const minX = Math.floor(cx - r - 1);
  const maxX = Math.ceil(cx + r);
  const minZ = Math.floor(cz - r - 1);
  const maxZ = Math.ceil(cz + r);
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const distance = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (Math.abs(distance - r) <= halfThickness) cells.set(`${x},${z}`, { x, z });
    }
  }
  return [...cells.values()];
}

// ── Chunk assignment ────────────────────────────────────────────────────────
const CHUNK_SIZE = 16;
function floorDiv(value, divisor) { return Math.floor(value / divisor); }
function chunkCoordsForBlock(x, z) {
  return { cx: floorDiv(x, CHUNK_SIZE), cz: floorDiv(z, CHUNK_SIZE) };
}
function chunkId(cx, cz) { return `${cx},${cz}`; }

// ── Tests ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) { failed++; console.error(`  FAIL: ${message}`); }
  else { passed++; console.log(`  PASS: ${message}`); }
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function pointsEqual(a, b) {
  return a.x === b.x && a.z === b.z;
}

function hasNeighbor(point, keys) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (keys.has(`${point.x + dx},${point.z + dz}`)) return true;
    }
  }
  return false;
}

function pointKey(point) {
  return `${point.x},${point.z}`;
}

// ── Test 1: Bresenham horizontal line ───────────────────────────────────────
console.log("\n=== Bresenham Line Tests ===");

const hLine = bresenhamLine({ x: 0, z: 0 }, { x: 4, z: 0 });
assert(hLine.length === 5, "horizontal line 0,0→4,0 has 5 points");
assert(
  arraysEqual(hLine.map((p) => `${p.x},${p.z}`), ["0,0", "1,0", "2,0", "3,0", "4,0"]),
  "horizontal line produces correct cells"
);

// ── Test 2: Bresenham vertical line ─────────────────────────────────────────
const vLine = bresenhamLine({ x: 0, z: 0 }, { x: 0, z: 3 });
assert(vLine.length === 4, "vertical line 0,0→0,3 has 4 points");
assert(
  arraysEqual(vLine.map((p) => `${p.x},${p.z}`), ["0,0", "0,1", "0,2", "0,3"]),
  "vertical line produces correct cells"
);

// ── Test 3: Bresenham diagonal line ─────────────────────────────────────────
const dLine = bresenhamLine({ x: 0, z: 0 }, { x: 3, z: 3 });
assert(dLine.length === 4, "diagonal line 0,0→3,3 has 4 points");
assert(pointsEqual(dLine[0], { x: 0, z: 0 }), "diagonal starts at 0,0");
assert(pointsEqual(dLine[dLine.length - 1], { x: 3, z: 3 }), "diagonal ends at 3,3");

// ── Test 4: Bresenham reverse direction ─────────────────────────────────────
const rLine = bresenhamLine({ x: 5, z: 5 }, { x: 2, z: 2 });
assert(rLine.length === 4, "reverse diagonal 5,5→2,2 has 4 points");
assert(pointsEqual(rLine[0], { x: 5, z: 5 }), "reverse starts at 5,5");
assert(pointsEqual(rLine[rLine.length - 1], { x: 2, z: 2 }), "reverse ends at 2,2");

// ── Test 5: Bresenham single point ──────────────────────────────────────────
const sLine = bresenhamLine({ x: 7, z: 3 }, { x: 7, z: 3 });
assert(sLine.length === 1, "single-point line has 1 point");
assert(pointsEqual(sLine[0], { x: 7, z: 3 }), "single point is at 7,3");

// ── Test 6: Bresenham long line ─────────────────────────────────────────────
const longLine = bresenhamLine({ x: 0, z: 0 }, { x: 100, z: 50 });
assert(longLine.length === 101, "long line 0,0→100,50 has 101 points (L1 norm + 1)");
assert(pointsEqual(longLine[0], { x: 0, z: 0 }), "long line starts at origin");
assert(pointsEqual(longLine[longLine.length - 1], { x: 100, z: 50 }), "long line ends at target");

// ── Test 6b: fractional vertices map to containing block cells ─────────────
const fractionalLine = bresenhamLine({ x: 1.8, z: 2.2 }, { x: 4.1, z: 2.9 });
assert(pointsEqual(fractionalLine[0], { x: 1, z: 2 }), "fractional line starts in containing cell 1,2");
assert(pointsEqual(fractionalLine[fractionalLine.length - 1], { x: 4, z: 2 }), "fractional line ends in containing cell 4,2");

// ── Test 7: Scanline fill – small triangle ──────────────────────────────────
console.log("\n=== Scanline Fill Tests ===");

const triShell = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 2, z: 3 }
];
const triFill = scanlineFill(triShell);
assert(triFill.length > 0, "triangle fill produces cells");
// A 4x3 bounding box has 12 cells max; triangle occupies roughly half
assert(triFill.length < 12, "triangle fill is less than bounding box");

// All filled points should be inside the bounding box
const allInBounds = triFill.every((p) => p.x >= 0 && p.x <= 4 && p.z >= 0 && p.z <= 3);
assert(allInBounds, "all triangle fill points are within bounding box");

// ── Test 8: Scanline fill – rectangle ───────────────────────────────────────
const rectShell = [
  { x: 0, z: 0 },
  { x: 3, z: 0 },
  { x: 3, z: 2 },
  { x: 0, z: 2 }
];
const rectFill = scanlineFill(rectShell);
assert(rectFill.length === 6, "3x2 rectangle fill has 6 cells (3 * 2)");

// ── Test 9: Scanline fill – degenerate (< 3 points) ────────────────────────
const lineFill = scanlineFill([{ x: 0, z: 0 }, { x: 5, z: 5 }]);
assert(lineFill.length === 0, "degenerate polygon (2 points) produces 0 cells");

// ── Test 10: Scanline fill – unit square ────────────────────────────────────
const unitFill = scanlineFill([
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 1, z: 1 },
  { x: 0, z: 1 }
]);
assert(unitFill.length === 1, "unit square fill has 1 cell");

// ── Test 11: Scanline fill – larger rectangle ───────────────────────────────
// Scanline fill + pointInPolygon boundary exclusion: the right/top edges
// are excluded (half-open), so a 10x10 shell yields (10-1) × (10-1) = 81 cells.
const bigRectFill = scanlineFill([
  { x: 0, z: 0 },
  { x: 9, z: 0 },
  { x: 9, z: 9 },
  { x: 0, z: 9 }
]);
assert(bigRectFill.length === 81, "10x10 shell fill yields 81 cells (boundary-excluded)");

// ── Test 12: Scanline fill with hole ────────────────────────────────────────
const outerShell = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 4 },
  { x: 0, z: 4 }
];
const innerHole = [
  { x: 1, z: 1 },
  { x: 3, z: 1 },
  { x: 3, z: 3 },
  { x: 1, z: 3 }
];
const fillWithHole = scanlineFill(outerShell, [innerHole]);
assert(fillWithHole.length === 12, "4x4 with 2x2 hole has 12 cells (16 - 4)");
// Verify no points inside the hole
const noHolePoints = fillWithHole.every((p) => !(p.x >= 1 && p.x <= 2 && p.z >= 1 && p.z <= 2));
assert(noHolePoints, "no filled cells fall inside the hole");

// ── Polygon outline rasterization tests ────────────────────────────────────
console.log("\n=== Polygon Outline Tests ===");

const outline = rasterizePolygonOutline([
  { x: 0, z: 0 },
  { x: 3, z: 0 },
  { x: 3, z: 3 },
  { x: 0, z: 3 }
]);
assert(outline.length === 12, "3x3 polygon outline has 12 boundary cells");
assert(!outline.some((p) => p.x === 1 && p.z === 1), "polygon outline excludes interior cell 1,1");

const outlineWithHole = rasterizePolygonOutline(outerShell, [innerHole]);
assert(outlineWithHole.length === 24, "4x4 polygon outline with 2x2 hole has outer + inner boundary cells");
assert(outlineWithHole.some((p) => p.x === 2 && p.z === 1), "polygon hole top edge is rasterized");

const circleLikeOutline = rasterizePolygonOutline([
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 4 },
  { x: 0, z: 4 }
]);
assert(!circleLikeOutline.some((p) => p.x === 2 && p.z === 2), "circle-style outline excludes interior cells");

// ── Split-side polygon line tests ───────────────────────────────────────────
console.log("\n=== Split-Side Polygon Line Tests ===");

const splitSquare = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 4 },
  { x: 0, z: 4 }
];
const insideSplitSquare = rasterizeSplitSideRing(splitSquare, "inside");
const centeredSplitSquare = cellCenterRing(splitSquare);
assert(insideSplitSquare.every((p) => pointInRing({ x: p.x + 0.5, z: p.z + 0.5 }, centeredSplitSquare)), "inside split keeps all cells on the polygon interior side");
assert(!insideSplitSquare.some((p) => p.x === 1 && p.z === -1), "inside split does not place top edge outside the polygon");

const outsideSplitSquare = rasterizeSplitSideRing(splitSquare, "outside");
const outsideSplitSquareKeys = new Set(outsideSplitSquare.map(pointKey));
assert(outsideSplitSquare.every((p) => !pointInRing({ x: p.x + 0.5, z: p.z + 0.5 }, centeredSplitSquare)), "outside split keeps all cells on the polygon exterior side");
assert(["-1,-1", "5,-1", "5,5", "-1,5"].every((key) => outsideSplitSquareKeys.has(key)), "outside split fills the four square corner gaps");
assert(!outsideSplitSquare.some((p) => p.x === 0 && p.z === 1), "outside split does not place top edge inside the polygon");

const centeredTopEdge = [cellCenterPoint(splitSquare[0]), cellCenterPoint(splitSquare[1])];
assert(clippedCellArea(0, 0, centeredTopEdge[0], centeredTopEdge[1], 1) === 0.5, "split-side clipping line is aligned to floor(vertex)+0.5 centerline");

const diagonalRing = [
  { x: 0, z: 0 },
  { x: 4, z: 2 },
  { x: 2, z: 5 },
  { x: -1, z: 3 }
];
const diagonalSplit = rasterizeSplitSideRing(diagonalRing, "outside");
const diagonalOriginal = new Set(bresenhamLine(diagonalRing[0], diagonalRing[1]).map((p) => `${p.x},${p.z}`));
const centeredDiagonalRing = cellCenterRing(diagonalRing);
const diagonalLineCells = bresenhamLine(centeredDiagonalRing[0], centeredDiagonalRing[1]);
const diagonalSplitKeys = new Set(diagonalSplit.map(pointKey));
const diagonalEdgeCells = rasterizeEdgeSide(centeredDiagonalRing[0], centeredDiagonalRing[1], "outside", signedRingArea(centeredDiagonalRing) > 0);
const diagonalEdgeKeys = new Set(diagonalEdgeCells.map(pointKey));
assert(diagonalLineCells.every((p) => diagonalEdgeCells.some((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.z - p.z) <= 1)), "split-side diagonal keeps every source segment cell represented nearby");
assert(diagonalEdgeCells.every((p) => hasNeighbor(p, diagonalEdgeKeys)), "split-side diagonal edge output has no isolated cells");
assert(diagonalSplit.every((p) => hasNeighbor(p, diagonalSplitKeys)), "split-side polygon output has no isolated cells");
assert(diagonalSplit.some((p) => !diagonalOriginal.has(`${p.x},${p.z}`)), "split-side diagonal output includes shifted cells beyond the original Bresenham line");

// ── Native circle outline rasterization tests ──────────────────────────────
console.log("\n=== Circle Outline Tests ===");

const circleOutline = rasterizeCircleOutline({ x: 10.5, z: -5.5 }, 4.4);
assert(circleOutline.some((p) => p.x === 14 && p.z === -6), "circle outline includes east cardinal cell");
assert(circleOutline.some((p) => p.x === 6 && p.z === -6), "circle outline includes west cardinal cell");
assert(circleOutline.some((p) => p.x === 10 && p.z === -2), "circle outline includes south cardinal cell");
assert(circleOutline.some((p) => p.x === 10 && p.z === -10), "circle outline includes north cardinal cell");
assert(!circleOutline.some((p) => p.x === 10 && p.z === -6), "circle outline excludes center cell");

const evenCircleOutline = rasterizeCircleOutline({ x: 10, z: -6 }, 4);
const evenMinX = Math.min(...evenCircleOutline.map((p) => p.x));
const evenMaxX = Math.max(...evenCircleOutline.map((p) => p.x));
const evenMinZ = Math.min(...evenCircleOutline.map((p) => p.z));
const evenMaxZ = Math.max(...evenCircleOutline.map((p) => p.z));
assert(evenMaxX - evenMinX + 1 === 8, "corner-centered circle has even X diameter");
assert(evenMaxZ - evenMinZ + 1 === 8, "corner-centered circle has even Z diameter");
assert(!evenCircleOutline.some((p) => p.x === 10 && p.z === -6), "corner-centered circle excludes corner center cell");

// ── Chunk assignment tests ──────────────────────────────────────────────────
console.log("\n=== Chunk Assignment Tests ===");

const c1 = chunkCoordsForBlock(0, 0);
assert(c1.cx === 0 && c1.cz === 0, "block (0,0) → chunk (0,0)");

const c2 = chunkCoordsForBlock(15, 15);
assert(c2.cx === 0 && c2.cz === 0, "block (15,15) → chunk (0,0)");

const c3 = chunkCoordsForBlock(16, 0);
assert(c3.cx === 1 && c3.cz === 0, "block (16,0) → chunk (1,0)");

const c4 = chunkCoordsForBlock(-1, -1);
assert(c4.cx === -1 && c4.cz === -1, "block (-1,-1) → chunk (-1,-1)");

const c5 = chunkCoordsForBlock(-16, -16);
assert(c5.cx === -1 && c5.cz === -1, "block (-16,-16) → chunk (-1,-1)");

const c6 = chunkCoordsForBlock(-17, -17);
assert(c6.cx === -2 && c6.cz === -2, "block (-17,-17) → chunk (-2,-2)");

const id1 = chunkId(5, -3);
assert(id1 === "5,-3", "chunkId(5,-3) === '5,-3'");

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All raster tests passed.");
}
