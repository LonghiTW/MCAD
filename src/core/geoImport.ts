/**
 * GeoJSON / KML / KMZ → MCAD Geometry import.
 *
 * TerrasEdit convention: GeoJSON/KML coordinates are in WGS-84 (lat/lon).
 * We project them to Minecraft X/Z via the BTE projection, then store as
 * MCAD Geometry objects.
 */

import { unzipSync } from "fflate";
import togeojson from "@mapbox/togeojson";
import type { Geometry, GeometryProperties, Vec2 } from "./types";
import { latLonToMinecraft } from "./projection";

// ── Types ───────────────────────────────────────────────────────────────────

export type ImportFileKind = "geojson" | "kml" | "kmz";

export type ImportPropertyMapping = {
  blockType?: string;
  baseY?: number;
  width?: number;
  height?: number;
  lineStackHeight?: number;
  priority?: number;
};

/** Options controlling how a file is imported. */
export type ImportOptions = {
  /** Default property overrides applied to every imported geometry. */
  properties: ImportPropertyMapping;
  /** Target geometry layer id for the imported geometries. */
  targetLayerId: string;
};

// ── Format Detection ────────────────────────────────────────────────────────

export function detectFileKind(filename: string): ImportFileKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".kmz")) return "kmz";
  if (lower.endsWith(".kml")) return "kml";
  return "geojson";
}

// ── File Reading ────────────────────────────────────────────────────────────

/**
 * Read a file and return either raw text (GeoJSON/KML) or the unzipped KML
 * text for KMZ archives.
 */
export async function readFileAsImportText(file: File): Promise<string> {
  const kind = detectFileKind(file.name);
  if (kind === "kmz") {
    const buf = await file.arrayBuffer();
    const entries = unzipSync(new Uint8Array(buf));
    const keys = Object.keys(entries);
    const docKml =
      keys.find((k) => (k.split("/").pop() ?? "").toLowerCase() === "doc.kml") ||
      keys.find((k) => k.toLowerCase().endsWith(".kml"));
    if (!docKml) throw new Error("KMZ archive does not contain doc.kml or another .kml file");
    return new TextDecoder("utf-8").decode(entries[docKml]);
  }
  return file.text();
}

// ── GeoJSON Parsing ─────────────────────────────────────────────────────────

interface GeoJsonCoord {
  type: string;
  coordinates: number[] | number[][] | number[][][] | number[][][][];
  properties?: Record<string, unknown>;
}

function extractPositions(coord: number[]): Vec2 {
  // GeoJSON coordinates are [lon, lat] (or [lon, lat, elevation])
  const lon = coord[0];
  const lat = coord[1];
  return latLonToMinecraft({ lat, lon });
}

function extractRing(ring: number[][]): Vec2[] {
  return ring.map((coord) => extractPositions(coord));
}

/**
 * Parse a GeoJSON feature into zero or more MCAD Geometries.
 */
function parseGeoJsonFeature(
  feature: GeoJsonFeature,
  defaults: ImportPropertyMapping,
  layerId: string
): Geometry[] {
  const geom = feature.geometry;
  const props = extractProperties(feature.properties, defaults);

  switch (geom.type) {
    case "Point": {
      // A single point is too small to render; skip it.
      return [];
    }
    case "MultiPoint": {
      // Each point is too small; skip.
      return [];
    }
    case "LineString": {
      const vertices = (geom.coordinates as number[][]).map((coord: number[]) => extractPositions(coord));
      if (vertices.length < 2) return [];
      return [{
        id: crypto.randomUUID(),
        type: "polyline",
        vertices,
        properties: { ...props, lineStackHeight: props.lineStackHeight ?? 1 },
        layerId
      }];
    }
    case "MultiLineString": {
      const results: Geometry[] = [];
      for (const line of geom.coordinates as number[][][]) {
        if (line.length < 2) continue;
        results.push({
          id: crypto.randomUUID(),
          type: "polyline",
          vertices: line.map((coord: number[]) => extractPositions(coord)),
          properties: { ...props, lineStackHeight: props.lineStackHeight ?? 1 },
          layerId
        });
      }
      return results;
    }
    case "Polygon": {
      const coords3 = geom.coordinates as number[][][];
      const shell = extractRing(coords3[0]);
      if (shell.length < 3) return [];
      const holes = coords3.slice(1).map((ring: number[][]) => extractRing(ring));
      return [{
        id: crypto.randomUUID(),
        type: "polygon",
        vertices: shell,
        holes: holes.length > 0 ? holes : undefined,
        properties: { ...props },
        layerId
      }];
    }
    case "MultiPolygon": {
      const results: Geometry[] = [];
      for (const polygon of geom.coordinates as number[][][][]) {
        const shell = extractRing(polygon[0] as number[][]);
        if (shell.length < 3) continue;
        const holes = polygon.slice(1).map((ring: number[][]) => extractRing(ring));
        results.push({
          id: crypto.randomUUID(),
          type: "polygon",
          vertices: shell,
          holes: holes.length > 0 ? holes : undefined,
          properties: { ...props },
          layerId
        });
      }
      return results;
    }
    default:
      return [];
  }
}

function extractProperties(
  featureProps: Record<string, unknown> | null | undefined,
  defaults: ImportPropertyMapping
): GeometryProperties {
  const raw = featureProps ?? {};
  return {
    blockType: defaults.blockType ?? String(raw.block ?? "gray_concrete"),
    baseY: defaults.baseY ?? (Number(raw.elevation ?? 0) || 0),
    width: defaults.width ?? (typeof raw.width === "number" ? raw.width : undefined),
    height: defaults.height ?? (typeof raw.height === "number" ? raw.height : undefined),
    lineStackHeight: defaults.lineStackHeight ?? (typeof raw.lineStackHeight === "number" ? raw.lineStackHeight : undefined),
    priority: defaults.priority ?? (typeof raw.priority === "number" ? raw.priority : undefined)
  };
}

// ── Main Import Entry ───────────────────────────────────────────────────────

interface GeoJsonFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: Record<string, unknown> | null;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/**
 * Parse raw text (GeoJSON or KML) into a list of MCAD Geometry objects.
 * @param text Raw file text.
 * @param kind File format kind ("geojson", "kml", or "kmz" — kmz text is already KML).
 * @param options Import options.
 * @returns Array of MCAD Geometry objects.
 */
export function parseGeoImport(
  text: string,
  kind: ImportFileKind,
  options: ImportOptions
): Geometry[] {
  let geoJson: GeoJsonFeatureCollection;

  if (kind === "kml" || kind === "kmz") {
    // Parse KML → GeoJSON using @mapbox/togeojson
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/xml");
    geoJson = togeojson.kml(doc) as GeoJsonFeatureCollection;
  } else {
    // Already GeoJSON
    geoJson = JSON.parse(text);
  }

  if (!geoJson || geoJson.type !== "FeatureCollection") {
    // Single feature — wrap in a collection
    if (geoJson && (geoJson as any).type === "Feature") {
      geoJson = { type: "FeatureCollection", features: [geoJson as unknown as GeoJsonFeature] };
    } else {
      throw new Error("Input is not a valid GeoJSON FeatureCollection or Feature.");
    }
  }

  const geometries: Geometry[] = [];
  for (const feature of geoJson.features) {
    if (!feature || feature.type !== "Feature" || !feature.geometry) continue;
    geometries.push(
      ...parseGeoJsonFeature(feature, options.properties, options.targetLayerId)
    );
  }
  return geometries;
}

/**
 * High-level import: read a File and return MCAD Geometries.
 */
export async function importFileToGeometries(
  file: File,
  options: ImportOptions
): Promise<Geometry[]> {
  const kind = detectFileKind(file.name);
  const text = await readFileAsImportText(file);
  return parseGeoImport(text, kind, options);
}
