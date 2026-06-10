/**
 * Spatial index for MCAD geometries using RBush (R-tree).
 *
 * Provides O(log n) bounding-box queries for:
 * - Hit-testing (find geometry near a point)
 * - Viewport culling (find geometries visible on screen)
 * - Selection rectangle queries
 *
 * RBush uses minX/minY/maxX/maxY — we map MCAD x → X, z → Y.
 */

import RBush from "rbush";
import type { Geometry } from "./types";

/** Bounding box entry stored in the spatial index. */
export interface GeometryBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Reference to the original geometry object (kept in sync by the store). */
  geometryId: string;
}

/** Expand a bounding box by a tolerance margin. */
function expandBBox(bbox: GeometryBBox, margin: number): GeometryBBox {
  return {
    minX: bbox.minX - margin,
    minY: bbox.minY - margin,
    maxX: bbox.maxX + margin,
    maxY: bbox.maxY + margin,
    geometryId: bbox.geometryId
  };
}

/** Compute the bounding box for a single geometry. */
export function computeGeometryBBox(geometry: Geometry): GeometryBBox {
  if (geometry.type === "circle") {
    const r = geometry.radius;
    return {
      minX: geometry.center.x - r,
      minY: geometry.center.z - r,
      maxX: geometry.center.x + r,
      maxY: geometry.center.z + r,
      geometryId: geometry.id
    };
  }

  // polyline or polygon
  const verts = geometry.vertices;
  if (verts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, geometryId: geometry.id };
  }

  let minX = verts[0].x;
  let minY = verts[0].z;
  let maxX = minX;
  let maxY = minY;

  for (let i = 1; i < verts.length; i++) {
    if (verts[i].x < minX) minX = verts[i].x;
    if (verts[i].x > maxX) maxX = verts[i].x;
    if (verts[i].z < minY) minY = verts[i].z;
    if (verts[i].z > maxY) maxY = verts[i].z;
  }

  // Include holes in the bounding box
  if (geometry.holes) {
    for (const hole of geometry.holes) {
      for (const v of hole) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.z < minY) minY = v.z;
        if (v.z > maxY) maxY = v.z;
      }
    }
  }

  // Expand by width for polylines
  const halfWidth = Math.max(0, Math.floor(((geometry.properties.width ?? 1) - 1) / 2));
  if (halfWidth > 0) {
    minX -= halfWidth;
    minY -= halfWidth;
    maxX += halfWidth;
    maxY += halfWidth;
  }

  return { minX, minY, maxX, maxY, geometryId: geometry.id };
}

/**
 * Spatial index backed by an R-tree.
 * Call `rebuild()` when the geometry set changes,
 * or use `update()` for incremental changes.
 */
export class GeometrySpatialIndex {
  private tree: RBush<GeometryBBox>;
  private _size = 0;

  constructor() {
    this.tree = new RBush<GeometryBBox>(9);
  }

  /** Full rebuild from all geometries. */
  rebuild(geometries: Geometry[]): void {
    const boxes = geometries.map(computeGeometryBBox);
    this.tree.clear();
    this.tree.load(boxes);
    this._size = boxes.length;
  }

  /** Incremental update: remove old entry, insert new one. Size stays the same. */
  update(geometry: Geometry): void {
    // Remove old bounding box by geometryId (no-op if not found)
    this.tree.remove(
      { minX: 0, minY: 0, maxX: 0, maxY: 0, geometryId: geometry.id },
      (a, b) => a.geometryId === b.geometryId
    );
    // Insert updated bounding box
    this.tree.insert(computeGeometryBBox(geometry));
  }

  /** Remove a geometry by id. */
  remove(geometryId: string): void {
    this.tree.remove(
      { minX: 0, minY: 0, maxX: 0, maxY: 0, geometryId },
      (a, b) => a.geometryId === b.geometryId
    );
    this._size = Math.max(0, this._size - 1);
  }

  /** Query: find all geometry ids whose bounding boxes intersect the given rect. */
  queryRect(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const results = this.tree.search({ minX, minY, maxX, maxY });
    return results.map((r) => r.geometryId);
  }

  /** Query: find all geometry ids within a tolerance of a point. */
  queryPoint(x: number, z: number, tolerance: number): string[] {
    return this.tree.search({
      minX: x - tolerance,
      minY: z - tolerance,
      maxX: x + tolerance,
      maxY: z + tolerance
    }).map((r) => r.geometryId);
  }

  /** Query: find all geometry ids visible in the viewport (with margin). */
  queryViewport(
    viewportCenterX: number,
    viewportCenterZ: number,
    viewportWidth: number,
    viewportHeight: number,
    zoom: number,
    marginBlocks = 64
  ): string[] {
    const halfW = viewportWidth / zoom / 2 + marginBlocks;
    const halfH = viewportHeight / zoom / 2 + marginBlocks;
    return this.queryRect(
      viewportCenterX - halfW,
      viewportCenterZ - halfH,
      viewportCenterX + halfW,
      viewportCenterZ + halfH
    );
  }

  /** Clear the index. */
  clear(): void {
    this.tree.clear();
    this._size = 0;
  }

  /** Number of entries. */
  get size(): number {
    return this._size;
  }
}

/** Singleton spatial index — shared across the application. */
export const geometrySpatialIndex = new GeometrySpatialIndex();
