/**
 * MCAD Geometry → GeoJSON / KML export.
 *
 * MCAD coordinates are Minecraft X/Z (meters).
 * We convert back to WGS-84 lat/lon via the BTE projection, then produce
 * standard GeoJSON or KML output.
 */

import type { Geometry } from "./types";
import { tryMinecraftToLatLon } from "./projection";

function circleToExportVertices(center: { x: number; z: number }, radius: number, segments = 64) {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
  });
}

// ── GeoJSON Export ──────────────────────────────────────────────────────────

/** Convert an MCAD Vec2 (Minecraft X/Z) to GeoJSON [lon, lat] position. */
function mcToGeoPosition(x: number, z: number): [number, number] | null {
  const ll = tryMinecraftToLatLon({ x, z });
  if (!ll) return null;
  return [ll.lon, ll.lat];
}

/** Convert an MCAD Polyline to a GeoJSON LineString Feature. */
function geometryToGeoJsonFeature(geometry: Geometry): object | null {
  if (geometry.type === "polyline") {
    const coords = geometry.vertices
      .map((v) => mcToGeoPosition(v.x, v.z))
      .filter((p): p is [number, number] => p !== null);
    if (coords.length < 2) return null;
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        blockType: geometry.properties.blockType,
        width: geometry.properties.width,
        baseY: geometry.properties.baseY,
        lineStackHeight: geometry.properties.lineStackHeight,
        priority: geometry.properties.priority,
        mcadType: "polyline"
      }
    };
  }

  if (geometry.type === "polygon") {
    const shell = geometry.vertices
      .map((v) => mcToGeoPosition(v.x, v.z))
      .filter((p): p is [number, number] => p !== null);
    if (shell.length < 3) return null;
    // GeoJSON polygons require closing the ring
    if (shell[0][0] !== shell[shell.length - 1][0] || shell[0][1] !== shell[shell.length - 1][1]) {
      shell.push([...shell[0]]);
    }
    const rings: [number, number][][] = [shell];
    if (geometry.holes) {
      for (const hole of geometry.holes) {
        const holeRing = hole
          .map((v) => mcToGeoPosition(v.x, v.z))
          .filter((p): p is [number, number] => p !== null);
        if (holeRing.length >= 3) {
          if (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1]) {
            holeRing.push([...holeRing[0]]);
          }
          rings.push(holeRing);
        }
      }
    }
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: rings },
      properties: {
        blockType: geometry.properties.blockType,
        height: geometry.properties.height,
        baseY: geometry.properties.baseY,
        priority: geometry.properties.priority,
        mcadType: "polygon"
      }
    };
  }

  if (geometry.type === "circle") {
    const shell = circleToExportVertices(geometry.center, geometry.radius)
      .map((v) => mcToGeoPosition(v.x, v.z))
      .filter((p): p is [number, number] => p !== null);
    if (shell.length < 3) return null;
    shell.push([...shell[0]]);
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [shell] },
      properties: {
        blockType: geometry.properties.blockType,
        baseY: geometry.properties.baseY,
        priority: geometry.properties.priority,
        mcadType: "circle",
        centerX: geometry.center.x,
        centerZ: geometry.center.z,
        radius: geometry.radius
      }
    };
  }

  return null;
}

/** Export MCAD geometries as a GeoJSON FeatureCollection string. */
export function exportAsGeoJson(geometries: Geometry[]): string {
  const features = geometries
    .map(geometryToGeoJsonFeature)
    .filter((f): f is object => f !== null);
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

// ── KML Export ──────────────────────────────────────────────────────────────

/** Escape special XML characters. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function geometryToKml(geometry: Geometry): string | null {
  if (geometry.type === "polyline") {
    const coords = geometry.vertices
      .map((v) => {
        const ll = tryMinecraftToLatLon({ x: v.x, z: v.z });
        return ll ? `${ll.lon},${ll.lat},0` : null;
      })
      .filter((c): c is string => c !== null);
    if (coords.length < 2) return null;
    const name = `polyline-${geometry.id.slice(0, 8)}`;
    const block = geometry.properties.blockType;
    return `    <Placemark>
      <name>${xmlEscape(name)}</name>
      <ExtendedData>
        <Data name="blockType"><value>${xmlEscape(block)}</value></Data>
        <Data name="width"><value>${geometry.properties.width ?? 1}</value></Data>
        <Data name="baseY"><value>${geometry.properties.baseY ?? 0}</value></Data>
        <Data name="lineStackHeight"><value>${geometry.properties.lineStackHeight ?? 1}</value></Data>
      </ExtendedData>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords.join(" ")}</coordinates>
      </LineString>
    </Placemark>`;
  }

  if (geometry.type === "polygon") {
    const outer = geometry.vertices
      .map((v) => {
        const ll = tryMinecraftToLatLon({ x: v.x, z: v.z });
        return ll ? `${ll.lon},${ll.lat},0` : null;
      })
      .filter((c): c is string => c !== null);
    if (outer.length < 3) return null;
    // Close ring
    if (outer[0] !== outer[outer.length - 1]) outer.push(outer[0]);

    let innerXml = "";
    if (geometry.holes && geometry.holes.length > 0) {
      for (const hole of geometry.holes) {
        const holeCoords = hole
          .map((v) => {
            const ll = tryMinecraftToLatLon({ x: v.x, z: v.z });
            return ll ? `${ll.lon},${ll.lat},0` : null;
          })
          .filter((c): c is string => c !== null);
        if (holeCoords.length >= 3) {
          if (holeCoords[0] !== holeCoords[holeCoords.length - 1]) holeCoords.push(holeCoords[0]);
          innerXml += `\n        <innerBoundaryIs><coordinates>${holeCoords.join(" ")}</coordinates></innerBoundaryIs>`;
        }
      }
    }

    const name = `polygon-${geometry.id.slice(0, 8)}`;
    const block = geometry.properties.blockType;
    return `    <Placemark>
      <name>${xmlEscape(name)}</name>
      <ExtendedData>
        <Data name="blockType"><value>${xmlEscape(block)}</value></Data>
        <Data name="height"><value>${geometry.properties.height ?? 1}</value></Data>
        <Data name="baseY"><value>${geometry.properties.baseY ?? 0}</value></Data>
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs><coordinates>${outer.join(" ")}</coordinates></outerBoundaryIs>${innerXml}
      </Polygon>
    </Placemark>`;
  }

  if (geometry.type === "circle") {
    const outer = circleToExportVertices(geometry.center, geometry.radius)
      .map((v) => {
        const ll = tryMinecraftToLatLon({ x: v.x, z: v.z });
        return ll ? `${ll.lon},${ll.lat},0` : null;
      })
      .filter((c): c is string => c !== null);
    if (outer.length < 3) return null;
    outer.push(outer[0]);
    const name = `circle-${geometry.id.slice(0, 8)}`;
    const block = geometry.properties.blockType;
    return `    <Placemark>
      <name>${xmlEscape(name)}</name>
      <ExtendedData>
        <Data name="blockType"><value>${xmlEscape(block)}</value></Data>
        <Data name="baseY"><value>${geometry.properties.baseY ?? 0}</value></Data>
        <Data name="centerX"><value>${geometry.center.x}</value></Data>
        <Data name="centerZ"><value>${geometry.center.z}</value></Data>
        <Data name="radius"><value>${geometry.radius}</value></Data>
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs><coordinates>${outer.join(" ")}</coordinates></outerBoundaryIs>
      </Polygon>
    </Placemark>`;
  }

  return null;
}

/** Export MCAD geometries as a KML string. */
export function exportAsKml(geometries: Geometry[]): string {
  const placemarks = geometries
    .map(geometryToKml)
    .filter((p): p is string => p !== null)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>MCAD Export</name>
${placemarks}
  </Document>
</kml>`;
}

// ── Download Helpers ────────────────────────────────────────────────────────

function downloadBlob(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadGeoJson(geometries: Geometry[], filename = "mcad-export.geojson") {
  downloadBlob(exportAsGeoJson(geometries), "application/geo+json", filename);
}

export function downloadKml(geometries: Geometry[], filename = "mcad-export.kml") {
  downloadBlob(exportAsKml(geometries), "application/vnd.google-earth.kml+xml", filename);
}
