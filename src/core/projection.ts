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
  // Instead of using the sampled bounds center (which may be outside the projection),
  // find a good starting location by sampling known geographic regions and picking a valid one.
  
  // Try major cities in BTE coverage area (Europe, North America, etc.)
  // Format: {lon, lat, label}
  const testLocations = [
    { lon: 0, lat: 0, label: "Prime Meridian" },      // Equator/Prime Meridian
    { lon: 10, lat: 50, label: "Europe Center" },     // Central Europe
    { lon: -100, lat: 40, label: "USA Midwest" },     // USA Midwest
    { lon: 139, lat: 35, label: "Japan" },            // Japan
    { lon: -50, lat: -20, label: "South America" },   // South America
  ];

  for (const loc of testLocations) {
    try {
      const mc = latLonToMinecraft({ lon: loc.lon, lat: loc.lat });
      if (Number.isFinite(mc.x) && Number.isFinite(mc.z)) {
        console.log(`[defaultBteViewportCenter] Found valid location: ${loc.label} (${loc.lon}, ${loc.lat}) => Minecraft (${mc.x.toFixed(0)}, ${mc.z.toFixed(0)})`);
        return mc;
      }
    } catch {
      // This location not in BTE projection, try next
    }
  }

  // Fallback: if no locations work, use the Minecraft bounds center
  // (this shouldn't happen if BTE projection is working)
  const bounds = bteWorldBounds();
  console.warn(`[defaultBteViewportCenter] No test locations valid, falling back to bounds center`);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2
  };
}
