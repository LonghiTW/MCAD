/**
 * Geometry construction utilities.
 * - Three-point circle computation.
 */

import type { Vec2 } from "./types";

/** Number of sides for the circle polygon approximation. */
const CIRCLE_SEGMENTS = 32;

/**
 * Compute the unique circle passing through three non-collinear points.
 * Returns null if the points are (nearly) collinear.
 */
export function circumcircle(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2
): { center: Vec2; radius: number } | null {
  const ax = p1.x;
  const az = p1.z;
  const bx = p2.x;
  const bz = p2.z;
  const cx = p3.x;
  const cz = p3.z;

  const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));

  // Points are (nearly) collinear
  if (Math.abs(d) < 1e-10) return null;

  const ux =
    ((ax * ax + az * az) * (bz - cz) +
      (bx * bx + bz * bz) * (cz - az) +
      (cx * cx + cz * cz) * (az - bz)) /
    d;
  const uz =
    ((ax * ax + az * az) * (cx - bx) +
      (bx * bx + bz * bz) * (ax - cx) +
      (cx * cx + cz * cz) * (bx - ax)) /
    d;

  const dx = ax - ux;
  const dz = az - uz;
  const radius = Math.sqrt(dx * dx + dz * dz);

  return { center: { x: ux, z: uz }, radius };
}

/**
 * Generate a polygon approximation of a circle.
 * Returns an array of Vec2 vertices forming a closed polygon.
 */
export function circleToPolygon(
  center: Vec2,
  radius: number,
  segments = CIRCLE_SEGMENTS
): Vec2[] {
  const vertices: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    vertices.push({
      x: center.x + radius * Math.cos(angle),
      z: center.z + radius * Math.sin(angle)
    });
  }
  return vertices;
}
