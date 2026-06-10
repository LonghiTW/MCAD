/**
 * Project persistence — serialise / deserialise MCAD projects.
 *
 * `.mcad.json` format:
 *   - Includes layers (definition only, no block cells), geometries, viewport, settings.
 *   - Excludes Google API key and RasterizedBlockLayer actual block cells.
 *   - After loading, chunks are rebuilt by re-rasterization.
 *
 * localStorage autosave:
 *   - Key: `mcad-autosave`
 *   - Debounced 1 second after state change.
 */

import type { McadLayer, RasterizedBlockLayer, ReferenceImageLayer, ThreeDTilesReferenceLayer } from "./layers";
import type { Geometry, ViewportState } from "./types";

// ── Project schema ──────────────────────────────────────────────────────────

export interface McadProject {
  /** Schema version — increment on breaking changes. */
  version: number;
  viewport: ViewportState;
  layers: McadLayer[];
  geometries: Geometry[];
  activeBlock: string;
  activeGeometryLayerId: string | null;
}

/** Current schema version. Bump on breaking format changes. */
export const CURRENT_VERSION = 1;

// ── Serialise ───────────────────────────────────────────────────────────────

/**
 * Create a McadProject from the current editor state.
 * Strips actual block cell data from RasterizedBlockLayer entries (they are
 * derived and will be rebuilt on load).
 */
export function serializeProject(state: {
  viewport: ViewportState;
  layers: McadLayer[];
  geometries: Geometry[];
  activeBlock: string;
  activeGeometryLayerId: string | null;
}): McadProject {
  // Deep-clone layers, stripping runtime-only fields:
  // - RasterizedBlockLayer: no block cells to persist
  // - ReferenceImageLayer: dataUrl is stored in IndexedDB, not in JSON
  const layers: McadLayer[] = state.layers.map((layer) => {
    if (layer.type === "rasterized-block") {
      const { ...rest } = layer as RasterizedBlockLayer;
      return rest as McadLayer;
    }
    if (layer.type === "reference-image") {
      const { dataUrl: _, ...rest } = layer as ReferenceImageLayer;
      return rest as McadLayer;
    }
    if (layer.type === "3d-tiles-reference") {
      const { apiKeyRef: _, ...rest } = layer as ThreeDTilesReferenceLayer;
      return rest as McadLayer;
    }
    return { ...layer } as McadLayer;
  });

  // Deep-clone geometries (strip mutable refs like holes sub-arrays)
  const geometries: Geometry[] = state.geometries.map((g) => ({
    ...g,
    ...(g.type === "circle"
      ? { center: { ...g.center } }
      : {
          vertices: g.vertices.map((v) => ({ ...v })),
          holes: g.holes?.map((hole) => hole.map((v) => ({ ...v })))
        }),
    properties: { ...g.properties }
  }));

  return {
    version: CURRENT_VERSION,
    viewport: { ...state.viewport },
    layers,
    geometries,
    activeBlock: state.activeBlock,
    activeGeometryLayerId: state.activeGeometryLayerId
  };
}

// ── Deserialise ─────────────────────────────────────────────────────────────

/** Result of deserialising a project file. */
export interface DeserializeResult {
  ok: boolean;
  project: McadProject | null;
  error?: string;
}

/**
 * Parse and validate a JSON string into a McadProject.
 * Applies schema migration if needed.
 */
export function deserializeProject(json: string): DeserializeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, project: null, error: "Invalid JSON" };
  }

  if (!raw || typeof raw !== "object") {
    return { ok: false, project: null, error: "Project file is not an object" };
  }

  const obj = raw as Record<string, unknown>;

  // Version check
  if (typeof obj.version !== "number") {
    return { ok: false, project: null, error: "Missing or invalid version field" };
  }

  // Run migrations
  let project: McadProject;
  try {
    project = migrate(obj as unknown as McadProject);
  } catch (err) {
    return { ok: false, project: null, error: `Migration failed: ${err}` };
  }

  // Validate required fields
  if (!project.viewport || typeof project.viewport.center !== "object") {
    return { ok: false, project: null, error: "Invalid viewport data" };
  }
  if (!Array.isArray(project.layers)) {
    return { ok: false, project: null, error: "Invalid layers data" };
  }
  if (!Array.isArray(project.geometries)) {
    return { ok: false, project: null, error: "Invalid geometries data" };
  }

  return { ok: true, project };
}

// ── Schema migration ────────────────────────────────────────────────────────

/**
 * Migrate a loaded project to the current schema version.
 * Add migration steps as version increments occur.
 */
function migrate(project: McadProject): McadProject {
  let migrated = { ...project };

  // v0 → v1: initial versioned schema (if ever needed)
  // if (migrated.version === 0) { ... migrated.version = 1; }

  // Add future migrations here:
  // if (migrated.version === 1) { ... migrated.version = 2; }

  // Ensure all layers have required fields with defaults
  migrated.layers = migrated.layers.map((layer) => {
    const base = {
      ...layer,
      visible: (layer as any).visible ?? true,
      opacity: (layer as any).opacity ?? 1,
      locked: (layer as any).locked ?? false
    };
    // ReferenceImageLayer: ensure dataUrl exists (will be restored from IndexedDB at runtime)
    if (layer.type === "reference-image" && !(layer as any).dataUrl) {
      (base as any).dataUrl = "";
      if ((base as any).lockAspectRatio === undefined) {
        (base as any).lockAspectRatio = false;
      }
    }
    return base;
  });

  // Ensure geometries have required fields
  migrated.geometries = migrated.geometries.map((g) => {
    const legacyFillMode = (g.properties as any).fillMode;
    if (g.type === "polygon" && legacyFillMode === "smooth-outline" && g.vertices.length >= 3) {
      const center = {
        x: g.vertices.reduce((sum, v) => sum + v.x, 0) / g.vertices.length,
        z: g.vertices.reduce((sum, v) => sum + v.z, 0) / g.vertices.length
      };
      const radius = g.vertices.reduce((sum, v) => sum + Math.hypot(v.x - center.x, v.z - center.z), 0) / g.vertices.length;
      return {
        id: g.id,
        type: "circle",
        center,
        radius,
        layerId: g.layerId,
        properties: {
          blockType: g.properties.blockType,
          baseY: g.properties.baseY ?? 0,
          boundaryMode: "center",
          solid: false,
          closedShapeThickness: 1,
          priority: g.properties.priority ?? 0
        }
      };
    }

    return {
      ...g,
      ...(g.type === "circle" ? { center: { ...g.center }, radius: g.radius ?? 1 } : { holes: g.holes ?? [] }),
      properties: {
        blockType: g.properties.blockType,
        width: g.type === "polyline" ? g.properties.width ?? 1 : g.properties.width,
        height: g.properties.height,
        baseY: g.properties.baseY ?? 0,
        lineStackHeight: g.type === "polyline" ? g.properties.lineStackHeight ?? 1 : g.properties.lineStackHeight,
        boundaryMode: g.type === "polygon" || g.type === "circle" ? g.properties.boundaryMode ?? "center" : g.properties.boundaryMode,
        solid: g.type === "polygon" || g.type === "circle" ? g.properties.solid ?? false : g.properties.solid,
        closedShapeThickness: g.type === "polygon" || g.type === "circle" ? g.properties.closedShapeThickness ?? 1 : g.properties.closedShapeThickness,
        priority: g.properties.priority ?? 0
      }
    };
  });

  migrated.version = CURRENT_VERSION;
  return migrated;
}

// ── Blob / file helpers ─────────────────────────────────────────────────────

/** Convert a McadProject to a JSON Blob suitable for download. */
export function projectToBlob(project: McadProject): Blob {
  const json = JSON.stringify(project, null, 2);
  return new Blob([json], { type: "application/json" });
}

/** Download a McadProject as `.mcad.json`. */
export function downloadProject(project: McadProject, filename = "project.mcad.json"): void {
  const blob = projectToBlob(project);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── localStorage autosave ───────────────────────────────────────────────────

const AUTOSAVE_KEY = "mcad-autosave";

/** Save project state to localStorage. */
export function autosave(state: {
  viewport: ViewportState;
  layers: McadLayer[];
  geometries: Geometry[];
  activeBlock: string;
  activeGeometryLayerId: string | null;
}): void {
  try {
    const project = serializeProject(state);
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    // Silently fail — autosave is best-effort
  }
}

/** Load autosaved project from localStorage. Returns null if none or invalid. */
export function loadAutosave(): McadProject | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    if (!json) return null;
    const result = deserializeProject(json);
    if (!result.ok || !result.project) return null;

    // Restore apiKeyRef for 3D Tiles layers from localStorage
    // (it's stripped from serialization for security)
    let storedApiKey = "";
    try { storedApiKey = localStorage.getItem("mcad-google-api-key") ?? ""; } catch { /* ignore */ }
    if (storedApiKey) {
      result.project.layers = result.project.layers.map((layer) => {
        if (layer.type === "3d-tiles-reference" && !layer.apiKeyRef) {
          return { ...layer, apiKeyRef: storedApiKey };
        }
        return layer;
      });
    }

    return result.project;
  } catch {
    return null;
  }
}

/** Clear autosave from localStorage. */
export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
}

// ── Debounced autosave helper ───────────────────────────────────────────────

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a debounced autosave. Call this after every state change.
 * The actual save fires 1 second after the last call.
 */
export function scheduleAutosave(state: {
  viewport: ViewportState;
  layers: McadLayer[];
  geometries: Geometry[];
  activeBlock: string;
  activeGeometryLayerId: string | null;
}): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosave(state);
    autosaveTimer = null;
  }, 1000);
}
