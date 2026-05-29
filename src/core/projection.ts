import { BTE_PROJECTION } from "bte-projection";
import type { LatLon, Vec2 } from "./types";

export async function loadBteProjection() {
  return BTE_PROJECTION;
}

export function latLonToMinecraft(input: LatLon): Vec2 {
  const projected = BTE_PROJECTION.fromGeo(input);
  return { x: projected.x, z: projected.y };
}

export function minecraftToLatLon(input: Vec2): LatLon {
  return BTE_PROJECTION.toGeo({ x: input.x, y: input.z });
}

export function tryMinecraftToLatLon(input: Vec2): LatLon | null {
  try {
    return minecraftToLatLon(input);
  } catch {
    return null;
  }
}

export function bteWorldBounds() {
  const bounds = BTE_PROJECTION.bounds();
  return {
    minX: bounds.minX,
    minZ: bounds.minY,
    maxX: bounds.maxX,
    maxZ: bounds.maxY
  };
}

export function bteWorldCenter(): Vec2 {
  const bounds = bteWorldBounds();
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2
  };
}

let sampledBoundsCache: ReturnType<typeof bteWorldBounds> | null = null;

export function sampledBteWorldBounds() {
  if (sampledBoundsCache) return sampledBoundsCache;

  const points: Vec2[] = [];
  for (let lat = -85; lat <= 85; lat += 2.5) {
    for (let lon = -180; lon <= 180; lon += 2.5) {
      try {
        points.push(latLonToMinecraft({ lat, lon }));
      } catch {
        // Some exact edge samples may be outside the projection.
      }
    }
  }

  sampledBoundsCache = {
    minX: Math.min(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxZ: Math.max(...points.map((point) => point.z))
  };
  return sampledBoundsCache;
}

export function sampledBteWorldCenter(): Vec2 {
  const bounds = sampledBteWorldBounds();
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2
  };
}

export function defaultBteViewportCenter(): Vec2 {
  const bounds = sampledBteWorldBounds();
  const height = bounds.maxZ - bounds.minZ;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2
  };
}
