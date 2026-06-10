/**
 * TileProjection abstraction layer.
 *
 * Decouples tile coordinate systems from Web Mercator so that WMTS
 * and other non-Web-Mercator tile grids can be supported in the future.
 *
 *   瓦片(x,y,z) → [TileProjection] → 地理(lon,lat) → [BTE Projection] → MC(x,z)
 */

import type { LatLon } from "./types";

export interface TileProjection {
  /**
   * Tile coordinates (supports fractional values for subdivision) → geographic lat/lon.
   */
  toGeoCoord(tileX: number, tileY: number, zoom: number): LatLon;

  /**
   * Geographic lat/lon → tile coordinates (fractional, for mesh subdivision
   * and range calculation).
   */
  toTileCoord(lat: number, lon: number, zoom: number): { tileX: number; tileY: number };

  /**
   * Fill placeholders in a tile URL template.
   * Handles {x}, {y}, {z}, {u} (Bing quadkey), {random:...}, and Yandex Y-flip.
   */
  tileUrl(template: string, x: number, y: number, z: number, sourceId?: string): string;
}

// ── Web Mercator / XYZ Slippy Map ───────────────────────────────────────────

/**
 * Standard Web Mercator tile projection matching the existing behavior
 * in `tiles.ts`. This is the default for all OSM-style XYZ sources.
 */
export class WebMercatorTileProjection implements TileProjection {
  toGeoCoord(tileX: number, tileY: number, zoom: number): LatLon {
    const n = 2 ** zoom;
    return {
      lon: (tileX / n) * 360 - 180,
      lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI
    };
  }

  toTileCoord(lat: number, lon: number, zoom: number): { tileX: number; tileY: number } {
    const latRad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
    const n = 2 ** zoom;
    return {
      tileX: Math.floor(((lon + 180) / 360) * n),
      tileY: Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
      )
    };
  }

  tileUrl(template: string, x: number, y: number, z: number, sourceId?: string): string {
    // Yandex TMS Y-flip
    const isYandex = Boolean(sourceId?.includes("yandex") || /yandex/.test(template));
    const yForUrl = isYandex ? 2 ** z - 1 - y : y;

    let url = template
      .replace(/{x}/g, String(x))
      .replace(/{y}/g, String(yForUrl))
      .replace(/{z}/g, String(z));

    if (url.includes("{u}")) {
      url = url.replace(/{u}/g, toQuadKey(x, y, z));
    }

    url = url.replace(/{random:([^}]+)}/g, (_, options: string) => {
      const choices = options.split(",");
      const index = Math.abs(x + y) % choices.length;
      return choices[index];
    });

    return url;
  }
}

// ── Bing Maps QuadKey helper ────────────────────────────────────────────────

function toQuadKey(x: number, y: number, z: number): string {
  let quadKey = "";
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit++;
    if ((y & mask) !== 0) digit += 2;
    quadKey += digit.toString();
  }
  return quadKey;
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _webMercator: WebMercatorTileProjection | null = null;

export function getWebMercatorProjection(): WebMercatorTileProjection {
  if (!_webMercator) _webMercator = new WebMercatorTileProjection();
  return _webMercator;
}

/**
 * Get a TileProjection by name.
 * Currently only "web-mercator" is implemented; WMTS is reserved for Phase 4.
 */
export function getProjection(name: string): TileProjection {
  if (name === "web-mercator") return getWebMercatorProjection();
  // Fallback: always return web mercator until WMTS is implemented
  return getWebMercatorProjection();
}
