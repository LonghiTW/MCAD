/**
 * Unified layer model for MCAD.
 *
 * Layer rendering order is determined by array position:
 * - MinecraftBaseLayer  → always first (bottom)
 * - TileOverlayLayer    → user tile overlays
 * - GeometryLayer       → editable geometry sources
 * - RasterizedBlockLayer→ derived block data
 * - SystemGridLayer     → always last (top)
 *
 * System layers (MinecraftBase, SystemGrid) are locked and cannot be
 * reordered or deleted by the user.
 */

import type { TileSource } from "./types";

// ── Base fields shared by every layer ───────────────────────────────────────

export interface McadLayerBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
}

// ── Concrete layer types ────────────────────────────────────────────────────

export interface MinecraftBaseLayer extends McadLayerBase {
  type: "minecraft-base";
}

export interface SystemGridLayer extends McadLayerBase {
  type: "system-grid";
}

export interface TileOverlayLayer extends McadLayerBase {
  type: "tile-overlay";
  urlTemplate: string;
  kind: "xyz" | "wmts";
  minZoom: number;
  maxZoom: number;
  offsetX: number;
  offsetZ: number;
  projection: string;
  attribution?: string;
  metadata?: Record<string, any>;
}

export interface GeometryLayer extends McadLayerBase {
  type: "geometry";
  /** Vertical offset in blocks added to each geometry's baseY. */
  verticalOffsetY: number;
}

export interface RasterizedBlockLayer extends McadLayerBase {
  type: "rasterized-block";
}

export interface ReferenceImageLayer extends McadLayerBase {
  type: "reference-image";
  dataUrl: string;
  centerX: number;
  centerZ: number;
  widthBlocks: number;
  heightBlocks: number;
  rotationDeg: number;
  lockAspectRatio: boolean;
}

export interface ThreeDTilesReferenceLayer extends McadLayerBase {
  type: "3d-tiles-reference";
  provider: "google-photorealistic-3d-tiles" | "custom-3d-tiles";
  apiKeyRef: string;
  rootTilesetUrl: string;
  horizontalOffsetX: number;
  horizontalOffsetZ: number;
  verticalOffsetY: number;
  attributionRequired: boolean;
}

// ── Union type ──────────────────────────────────────────────────────────────

export type McadLayer =
  | MinecraftBaseLayer
  | SystemGridLayer
  | TileOverlayLayer
  | GeometryLayer
  | RasterizedBlockLayer
  | ReferenceImageLayer
  | ThreeDTilesReferenceLayer;

// ── Type guards ─────────────────────────────────────────────────────────────

export function isMinecraftBaseLayer(layer: McadLayer): layer is MinecraftBaseLayer {
  return layer.type === "minecraft-base";
}

export function isSystemGridLayer(layer: McadLayer): layer is SystemGridLayer {
  return layer.type === "system-grid";
}

export function isTileOverlayLayer(layer: McadLayer): layer is TileOverlayLayer {
  return layer.type === "tile-overlay";
}

export function isGeometryLayer(layer: McadLayer): layer is GeometryLayer {
  return layer.type === "geometry";
}

export function isRasterizedBlockLayer(layer: McadLayer): layer is RasterizedBlockLayer {
  return layer.type === "rasterized-block";
}

export function isReferenceImageLayer(layer: McadLayer): layer is ReferenceImageLayer {
  return layer.type === "reference-image";
}

export function is3DTilesLayer(layer: McadLayer): layer is ThreeDTilesReferenceLayer {
  return layer.type === "3d-tiles-reference";
}

// ── Factory helpers ─────────────────────────────────────────────────────────

export function createMinecraftBaseLayer(): MinecraftBaseLayer {
  return {
    id: "system-minecraft-base",
    name: "Minecraft grass plane",
    type: "minecraft-base",
    visible: true,
    opacity: 1,
    locked: true
  };
}

export function createSystemGridLayer(): SystemGridLayer {
  return {
    id: "system-grid",
    name: "Block and chunk grid",
    type: "system-grid",
    visible: true,
    opacity: 1,
    locked: true
  };
}

export function createTileOverlayLayer(
  patch: Partial<TileOverlayLayer> & { urlTemplate: string; name: string }
): TileOverlayLayer {
  return {
    id: patch.id || crypto.randomUUID(),
    name: patch.name,
    type: "tile-overlay",
    visible: patch.visible ?? true,
    opacity: patch.opacity ?? 1,
    locked: false,
    urlTemplate: patch.urlTemplate,
    kind: patch.kind ?? "xyz",
    minZoom: patch.minZoom ?? 0,
    maxZoom: patch.maxZoom ?? 0,
    offsetX: patch.offsetX ?? 0,
    offsetZ: patch.offsetZ ?? 0,
    projection: patch.projection ?? "web-mercator",
    attribution: patch.attribution,
    metadata: patch.metadata
  };
}

export function createGeometryLayer(name: string, verticalOffsetY = 0): GeometryLayer {
  return {
    id: crypto.randomUUID(),
    name,
    type: "geometry",
    visible: true,
    opacity: 1,
    locked: false,
    verticalOffsetY
  };
}

export function createRasterizedBlockLayer(): RasterizedBlockLayer {
  return {
    id: "system-rasterized-block",
    name: "Rasterized blocks",
    type: "rasterized-block",
    visible: true,
    opacity: 1,
    locked: true
  };
}

export function create3DTilesReferenceLayer(
  patch: Partial<ThreeDTilesReferenceLayer> & {
    name: string;
    provider?: ThreeDTilesReferenceLayer["provider"];
  }
): ThreeDTilesReferenceLayer {
  const provider = patch.provider ?? "google-photorealistic-3d-tiles";
  const rootTilesetUrl =
    patch.rootTilesetUrl ??
    (provider === "google-photorealistic-3d-tiles"
      ? "https://tile.googleapis.com/v1/3dtiles/root.json"
      : "");
  return {
    id: patch.id || crypto.randomUUID(),
    name: patch.name,
    type: "3d-tiles-reference",
    visible: patch.visible ?? true,
    opacity: patch.opacity ?? 1,
    locked: false,
    provider,
    apiKeyRef: patch.apiKeyRef ?? "",
    rootTilesetUrl,
    horizontalOffsetX: patch.horizontalOffsetX ?? 0,
    horizontalOffsetZ: patch.horizontalOffsetZ ?? 0,
    verticalOffsetY: patch.verticalOffsetY ?? 0,
    attributionRequired: true,
  };
}

export function createReferenceImageLayer(
  patch: Partial<ReferenceImageLayer> & {
    name: string;
    dataUrl: string;
    centerX: number;
    centerZ: number;
    widthBlocks: number;
    heightBlocks: number;
  }
): ReferenceImageLayer {
  return {
    id: patch.id || crypto.randomUUID(),
    name: patch.name,
    type: "reference-image",
    visible: patch.visible ?? true,
    opacity: patch.opacity ?? 0.75,
    locked: false,
    dataUrl: patch.dataUrl,
    centerX: patch.centerX,
    centerZ: patch.centerZ,
    widthBlocks: Math.max(1, patch.widthBlocks),
    heightBlocks: Math.max(1, patch.heightBlocks),
    rotationDeg: patch.rotationDeg ?? 0,
    lockAspectRatio: patch.lockAspectRatio ?? false
  };
}

// ── Default layer stack ─────────────────────────────────────────────────────

export function defaultLayers(): McadLayer[] {
  return [createMinecraftBaseLayer(), createSystemGridLayer()];
}

// ── Query helpers ───────────────────────────────────────────────────────────

/** Extract tile overlay layers in array order. */
export function tileOverlayLayers(layers: McadLayer[]): TileOverlayLayer[] {
  return layers.filter(isTileOverlayLayer);
}

/** Extract geometry layers in array order. */
export function geometryLayers(layers: McadLayer[]): GeometryLayer[] {
  return layers.filter(isGeometryLayer);
}

/** Extract reference image layers in array order. */
export function referenceImageLayers(layers: McadLayer[]): ReferenceImageLayer[] {
  return layers.filter(isReferenceImageLayer);
}

/** Find a layer by id (returns undefined if not found). */
export function findLayer(layers: McadLayer[], id: string): McadLayer | undefined {
  return layers.find((l) => l.id === id);
}

/** Get the SystemGridLayer (always exactly one). */
export function getGridLayer(layers: McadLayer[]): SystemGridLayer | undefined {
  return layers.find(isSystemGridLayer);
}

/** Check whether the grid is visible. */
export function isGridVisible(layers: McadLayer[]): boolean {
  const grid = getGridLayer(layers);
  return grid?.visible ?? false;
}

// ── Migration: TileSource ↔ TileOverlayLayer ────────────────────────────────

/**
 * Converts legacy `TileSource` objects into `TileOverlayLayer` objects.
 * Used during migration so existing defaultTileSources still work.
 */
export function migrateTileSourceToLayer(source: TileSource): TileOverlayLayer {
  return {
    id: source.id,
    name: source.name,
    type: "tile-overlay",
    visible: source.visible,
    opacity: source.opacity,
    locked: false,
    urlTemplate: source.urlTemplate,
    kind: source.kind,
    minZoom: source.minZoom,
    maxZoom: source.maxZoom,
    offsetX: source.offsetX ?? 0,
    offsetZ: source.offsetZ ?? 0,
    projection: source.projection ?? "web-mercator",
    attribution: source.attribution as string | undefined,
    metadata: source.metadata
  };
}

/**
 * Converts a `TileOverlayLayer` back into a legacy `TileSource`.
 * Useful for passing to existing code that still expects `TileSource`.
 */
export function layerToTileSource(layer: TileOverlayLayer): TileSource {
  return {
    id: layer.id,
    name: layer.name,
    kind: layer.kind,
    urlTemplate: layer.urlTemplate,
    attribution: layer.attribution,
    minZoom: layer.minZoom,
    maxZoom: layer.maxZoom,
    visible: layer.visible,
    opacity: layer.opacity,
    offsetX: layer.offsetX,
    offsetZ: layer.offsetZ,
    projection: layer.projection,
    metadata: layer.metadata
  };
}
