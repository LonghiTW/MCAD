import { create } from "zustand";
import { clearSourceBlocks, setBlock } from "../core/chunks";
import {
  type McadLayer,
  type TileOverlayLayer,
  type ReferenceImageLayer,
  type ThreeDTilesReferenceLayer,
  type GeometryLayer,
  createTileOverlayLayer,
  createReferenceImageLayer,
  createGeometryLayer,
  create3DTilesReferenceLayer,
  tileOverlayLayers,
  geometryLayers,
  isGridVisible,
  migrateTileSourceToLayer
} from "../core/layers";
import { loadAutosave, scheduleAutosave } from "../core/projectPersistence";
import {
  storeImageData,
  retrieveAllImageData,
  deleteImageData,
  pruneImageData
} from "../core/imageStorage";
import { defaultBteViewportCenter } from "../core/projection";
import { defaultTileSources } from "../core/tiles";
import { DEFAULT_GLOBAL_ZOOM } from "../core/view";
import { rasterizeGeometry } from "../core/rasterize";
import { geometrySpatialIndex } from "../core/spatialIndex";
import type { BlockCell, ChunkData, ChunkID, Geometry, GeometryProperties, ToolMode, Vec2, ViewportState } from "../core/types";
import type { McadProject } from "../core/projectPersistence";

type HistoryState = {
  geometries: Geometry[];
};

// ── Initial state: prefer autosave, else default layers ─────────────────────
const savedProject = loadAutosave();
const initialLayers: McadLayer[] = savedProject?.layers ?? (() => {
  const initialTileLayers = defaultTileSources.map(migrateTileSourceToLayer);
  return [
    { id: "system-minecraft-base", name: "Minecraft grass plane", type: "minecraft-base", visible: true, opacity: 1, locked: true },
    ...initialTileLayers,
    { id: "system-grid", name: "Block and chunk grid", type: "system-grid", visible: true, opacity: 1, locked: true }
  ];
})();

// ── Async: restore image data URLs from IndexedDB into initial layers ───────
{
  const imageLayerIds = initialLayers
    .filter((l): l is ReferenceImageLayer => l.type === "reference-image")
    .map((l) => l.id);
  if (imageLayerIds.length > 0) {
    retrieveAllImageData().then((imageMap) => {
      const { layers } = useEditorStore.getState();
      const updated = layers.map((layer) => {
        if (layer.type === "reference-image" && !layer.dataUrl) {
          const restoredUrl = imageMap.get(layer.id);
          if (restoredUrl) return { ...layer, dataUrl: restoredUrl };
        }
        return layer;
      });
      useEditorStore.setState({ layers: updated });
    }).catch((err) => {
      console.warn("Failed to restore image data from IndexedDB:", err);
    });
  }
}

type EditorState = {
  viewport: ViewportState;
  tool: ToolMode;
  snapToGrid: boolean;
  selectedGeometryId: string | null;
  geometries: Geometry[];
  chunks: Map<ChunkID, ChunkData>;
  /** Unified layer stack — the single source of truth for layer ordering and settings. */
  layers: McadLayer[];
  activeBlock: string;
  /** Geometry layer id for newly created geometries. */
  activeGeometryLayerId: string | null;
  history: HistoryState[];
  future: HistoryState[];
  draftVertices: Vec2[];
  setViewport: (viewport: Partial<ViewportState>) => void;
  setTool: (tool: ToolMode) => void;
  setActiveBlock: (block: string) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setSelectedGeometry: (id: string | null) => void;
  deleteGeometry: (id: string) => void;
  addDraftVertex: (point: Vec2) => void;
  clearDraft: () => void;
  commitGeometry: (type: "polyline" | "polygon") => void;
  closeDraftAsPolygon: () => void;
  /** Commit geometry with explicit vertices (used by circle tool). */
  commitGeometryWithVertices: (type: "polyline" | "polygon", vertices: Vec2[], properties?: Partial<GeometryProperties>) => void;
  commitCircleGeometry: (center: Vec2, radius: number, properties?: Partial<GeometryProperties>) => void;
  updateGeometry: (geometry: Geometry) => void;
  addVertexToGeometry: (geometryId: string, afterIndex: number, point: Vec2) => void;
  removeVertexFromGeometry: (geometryId: string, vertexIndex: number) => void;
  deleteSelected: () => void;
  rerasterize: (geometry: Geometry) => void;
  undo: () => void;
  redo: () => void;
  // ── Layer actions ──────────────────────────────────────────────────────
  toggleLayerVisibility: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  renameLayer: (id: string, name: string) => void;
  deleteLayer: (id: string) => void;
  addTileOverlayLayer: (name: string, urlTemplate: string, options?: { id?: string; opacity?: number; maxZoom?: number }) => void;
  addReferenceImageLayer: (options: { name: string; dataUrl: string; width: number; height: number }) => void;
  addGeometryLayer: (name: string) => void;
  add3DTilesReferenceLayer: (options: { name: string; apiKey?: string; provider?: ThreeDTilesReferenceLayer["provider"] }) => void;
  update3DTilesReferenceLayer: (id: string, patch: Partial<ThreeDTilesReferenceLayer>) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;
  setGeometryLayerVerticalOffset: (id: string, verticalOffsetY: number) => void;
  setActiveGeometryLayer: (id: string | null) => void;
  updateTileOverlayLayer: (id: string, patch: Partial<TileOverlayLayer>) => void;
  updateReferenceImageLayer: (id: string, patch: Partial<ReferenceImageLayer>) => void;
  // ── Project actions ────────────────────────────────────────────────────
  loadProject: (project: McadProject) => void;
};

function snapshot(state: EditorState): HistoryState {
  return {
    geometries: state.geometries.map(cloneGeometry)
  };
}

function cloneGeometry(geometry: Geometry): Geometry {
  if (geometry.type === "circle") {
    return { ...geometry, center: { ...geometry.center }, properties: { ...geometry.properties } };
  }
  return {
    ...geometry,
    vertices: geometry.vertices.map((vertex) => ({ ...vertex })),
    holes: geometry.holes?.map((hole) => hole.map((vertex) => ({ ...vertex }))),
    properties: { ...geometry.properties }
  };
}

function rebuildChunks(geometries: Geometry[], layers: McadLayer[]) {
  const chunks = new Map<ChunkID, ChunkData>();
  for (const geometry of geometries) {
    const layer = geometry.layerId ? layers.find((l) => l.id === geometry.layerId) : undefined;
    const layerOffsetY = layer && layer.type === "geometry" ? layer.verticalOffsetY : 0;
    for (const block of rasterizeGeometry(geometry, layerOffsetY)) setBlock(chunks, block);
  }
  // Keep spatial index in sync
  geometrySpatialIndex.rebuild(geometries);
  return chunks;
}

function snap(point: Vec2, enabled: boolean): Vec2 {
  if (!enabled) return point;
  return { x: Math.round(point.x), z: Math.round(point.z) };
}

/** Look up the vertical offset for a geometry via its layer. */
function geometryLayerOffset(geometry: Geometry, layers: McadLayer[]): number {
  if (!geometry.layerId) return 0;
  const layer = layers.find((l) => l.id === geometry.layerId);
  return layer && layer.type === "geometry" ? layer.verticalOffsetY : 0;
}

export const blockPalette = [
  { id: "grass_block", label: "Grass", color: "#5b9f45" },
  { id: "gray_concrete", label: "Road", color: "#777b82" },
  { id: "blue_concrete", label: "Water", color: "#2e6fd8" },
  { id: "stone_bricks", label: "Masonry", color: "#9a9690" },
  { id: "white_concrete", label: "Walls", color: "#d7d7d1" },
  { id: "oak_planks", label: "Wood", color: "#b8874f" }
];

export const useEditorStore = create<EditorState>((set, get) => ({
  viewport: savedProject?.viewport ?? { center: defaultBteViewportCenter(), zoom: DEFAULT_GLOBAL_ZOOM, width: 1, height: 1 },
  tool: "select",
  snapToGrid: true,
  selectedGeometryId: null,
  geometries: savedProject?.geometries ?? [],
  chunks: savedProject?.geometries ? rebuildChunks(savedProject.geometries, initialLayers) : new Map(),
  layers: initialLayers,
  activeBlock: savedProject?.activeBlock ?? "gray_concrete",
  activeGeometryLayerId: savedProject?.activeGeometryLayerId ?? null,
  history: [],
  future: [],
  draftVertices: [],
  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  setTool: (tool) =>
    set((state) => ({
      tool,
      draftVertices: tool === state.tool ? state.draftVertices : [],
      selectedGeometryId: tool === state.tool ? state.selectedGeometryId : null
    })),
  setActiveBlock: (activeBlock) => set({ activeBlock }),
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
  setSelectedGeometry: (selectedGeometryId) => set({ selectedGeometryId }),
  deleteGeometry: (id) =>
    set((state) => {
      const geometries = state.geometries.filter((geometry) => geometry.id !== id);
      if (geometries.length === state.geometries.length) return state;
      return {
        geometries,
        chunks: rebuildChunks(geometries, state.layers),
        selectedGeometryId: state.selectedGeometryId === id ? null : state.selectedGeometryId,
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  addDraftVertex: (point) => set((state) => ({ draftVertices: [...state.draftVertices, snap(point, state.snapToGrid)] })),
  clearDraft: () => set({ draftVertices: [] }),
  commitGeometry: (type) =>
    set((state) => {
      if (state.draftVertices.length < (type === "polygon" ? 3 : 2)) return state;
      // Determine the target geometry layer for this new geometry.
      const geomLayers = geometryLayers(state.layers);
      const targetLayerId = state.activeGeometryLayerId ?? geomLayers[0]?.id;
      const geometry: Geometry = {
        id: crypto.randomUUID(),
        type,
        vertices: state.draftVertices,
        layerId: targetLayerId,
        properties: {
          blockType: state.activeBlock,
          width: type === "polyline" ? 1 : undefined,
          lineStackHeight: type === "polyline" ? 1 : undefined,
          boundaryMode: type === "polygon" ? "center" : undefined,
          solid: type === "polygon" ? false : undefined,
          closedShapeThickness: type === "polygon" ? 1 : undefined,
          priority: 0
        }
      };
      const chunks = new Map(state.chunks);
      for (const block of rasterizeGeometry(geometry, geometryLayerOffset(geometry, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(geometry);
      return {
        geometries: [...state.geometries, geometry],
        chunks,
        selectedGeometryId: geometry.id,
        draftVertices: [],
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  closeDraftAsPolygon: () =>
    set((state) => {
      if (state.draftVertices.length < 3) return state;
      const geomLayers = geometryLayers(state.layers);
      const targetLayerId = state.activeGeometryLayerId ?? geomLayers[0]?.id;
      const geometry: Geometry = {
        id: crypto.randomUUID(),
        type: "polygon",
        vertices: state.draftVertices,
        layerId: targetLayerId,
        properties: {
          blockType: state.activeBlock,
          boundaryMode: "center",
          solid: false,
          closedShapeThickness: 1,
          priority: 0
        }
      };
      const chunks = new Map(state.chunks);
      for (const block of rasterizeGeometry(geometry, geometryLayerOffset(geometry, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(geometry);
      return {
        geometries: [...state.geometries, geometry],
        chunks,
        selectedGeometryId: geometry.id,
        draftVertices: [],
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  commitGeometryWithVertices: (type, vertices, properties) =>
    set((state) => {
      if (vertices.length < (type === "polygon" ? 3 : 2)) return state;
      const geomLayers = geometryLayers(state.layers);
      const targetLayerId = state.activeGeometryLayerId ?? geomLayers[0]?.id;
      const geometry: Geometry = {
        id: crypto.randomUUID(),
        type,
        vertices: vertices.map((v) => ({ ...v })),
        layerId: targetLayerId,
        properties: {
          blockType: state.activeBlock,
          width: type === "polyline" ? 1 : undefined,
          lineStackHeight: type === "polyline" ? 1 : undefined,
          boundaryMode: type === "polygon" ? "center" : undefined,
          solid: type === "polygon" ? false : undefined,
          closedShapeThickness: type === "polygon" ? 1 : undefined,
          priority: 0,
          ...properties
        }
      };
      const chunks = new Map(state.chunks);
      for (const block of rasterizeGeometry(geometry, geometryLayerOffset(geometry, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(geometry);
      return {
        geometries: [...state.geometries, geometry],
        chunks,
        selectedGeometryId: geometry.id,
        draftVertices: [],
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  commitCircleGeometry: (center, radius, properties) =>
    set((state) => {
      if (!Number.isFinite(radius) || radius <= 0) return state;
      const geomLayers = geometryLayers(state.layers);
      const targetLayerId = state.activeGeometryLayerId ?? geomLayers[0]?.id;
      const geometry: Geometry = {
        id: crypto.randomUUID(),
        type: "circle",
        center: { ...center },
        radius,
        layerId: targetLayerId,
        properties: {
          blockType: state.activeBlock,
          boundaryMode: "center",
          solid: false,
          closedShapeThickness: 1,
          priority: 0,
          ...properties
        }
      };
      const chunks = new Map(state.chunks);
      for (const block of rasterizeGeometry(geometry, geometryLayerOffset(geometry, state.layers))) setBlock(chunks, block);
      return {
        geometries: [...state.geometries, geometry],
        chunks,
        selectedGeometryId: geometry.id,
        draftVertices: [],
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  updateGeometry: (geometry) =>
    set((state) => {
      const geometries = state.geometries.map((item) => (item.id === geometry.id ? geometry : item));
      const chunks = new Map(state.chunks);
      clearSourceBlocks(chunks, geometry.id);
      for (const block of rasterizeGeometry(geometry, geometryLayerOffset(geometry, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(geometry);
      return { geometries, chunks, history: [...state.history, snapshot(state)], future: [] };
    }),
  addVertexToGeometry: (geometryId, afterIndex, point) =>
    set((state) => {
      const geometry = state.geometries.find((g) => g.id === geometryId);
      if (!geometry || geometry.type === "circle") return state;
      const snapped = snap(point, state.snapToGrid);
      const vertices = [...geometry.vertices];
      vertices.splice(afterIndex + 1, 0, snapped);
      const updated = { ...geometry, vertices };
      const geometries = state.geometries.map((g) => (g.id === geometryId ? updated : g));
      const chunks = new Map(state.chunks);
      clearSourceBlocks(chunks, geometryId);
      for (const block of rasterizeGeometry(updated, geometryLayerOffset(updated, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(updated);
      return { geometries, chunks, history: [...state.history, snapshot(state)], future: [] };
    }),
  removeVertexFromGeometry: (geometryId, vertexIndex) =>
    set((state) => {
      const geometry = state.geometries.find((g) => g.id === geometryId);
      if (!geometry || geometry.type === "circle" || geometry.vertices.length <= 2) return state;
      const vertices = geometry.vertices.filter((_, i) => i !== vertexIndex);
      const updated = { ...geometry, vertices };
      const geometries = state.geometries.map((g) => (g.id === geometryId ? updated : g));
      const chunks = new Map(state.chunks);
      clearSourceBlocks(chunks, geometryId);
      for (const block of rasterizeGeometry(updated, geometryLayerOffset(updated, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(updated);
      return { geometries, chunks, history: [...state.history, snapshot(state)], future: [] };
    }),
  deleteSelected: () =>
    set((state) => {
      if (!state.selectedGeometryId) return state;
      const geometries = state.geometries.filter((geometry) => geometry.id !== state.selectedGeometryId);
      geometrySpatialIndex.remove(state.selectedGeometryId);
      return {
        geometries,
        chunks: rebuildChunks(geometries, state.layers),
        selectedGeometryId: null,
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  rerasterize: (geometry) =>
    set((state) => {
      const chunks = new Map(state.chunks);
      clearSourceBlocks(chunks, geometry.id);
      for (const block of rasterizeGeometry(geometry, geometryLayerOffset(geometry, state.layers))) setBlock(chunks, block);
      geometrySpatialIndex.update(geometry);
      return { chunks };
    }),
  undo: () =>
    set((state) => {
      const previous = state.history.at(-1);
      if (!previous) return state;
      const history = state.history.slice(0, -1);
      return {
        geometries: previous.geometries,
        chunks: rebuildChunks(previous.geometries, state.layers),
        history,
        future: [snapshot(state), ...state.future],
        selectedGeometryId: null
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        geometries: next.geometries,
        chunks: rebuildChunks(next.geometries, state.layers),
        history: [...state.history, snapshot(state)],
        future: state.future.slice(1),
        selectedGeometryId: null
      };
    }),
  // ── Layer actions ────────────────────────────────────────────────────────
  toggleLayerVisibility: (id) =>
    set((state) => ({
      layers: state.layers.map((layer) => (layer.id === id ? { ...layer, visible: !layer.visible } : layer))
    })),
  setLayerOpacity: (id, opacity) =>
    set((state) => ({
      layers: state.layers.map((layer) => (layer.id === id ? { ...layer, opacity } : layer))
    })),
  renameLayer: (id, name) =>
    set((state) => ({
      layers: state.layers.map((layer) => (layer.id === id ? { ...layer, name } : layer))
    })),
  deleteLayer: (id) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === id);
      if (!layer || layer.locked) return state;
      // Remove image data from IndexedDB if deleting a reference-image layer
      if (layer.type === "reference-image") {
        deleteImageData(id).catch((err) =>
          console.warn("Failed to delete image from IndexedDB:", err)
        );
      }
      return {
        layers: state.layers.filter((l) => l.id !== id)
      };
    }),
  addTileOverlayLayer: (name, urlTemplate, options) =>
    set((state) => {
      const newLayer = createTileOverlayLayer({
        id: options?.id,
        name,
        urlTemplate,
        opacity: options?.opacity,
        maxZoom: options?.maxZoom
      });
      // Insert before the system grid layer (always last)
      const gridIndex = state.layers.findIndex((l) => l.type === "system-grid");
      const layers = [...state.layers];
      layers.splice(gridIndex >= 0 ? gridIndex : layers.length, 0, newLayer);
      return { layers };
    }),
  addReferenceImageLayer: (options) =>
    set((state) => {
      const maxPreviewBlocks = 512;
      const scale = Math.min(1, maxPreviewBlocks / Math.max(options.width, options.height));
      const newLayer = createReferenceImageLayer({
        name: options.name,
        dataUrl: options.dataUrl,
        centerX: state.viewport.center.x,
        centerZ: state.viewport.center.z,
        widthBlocks: Math.max(1, Math.round(options.width * scale)),
        heightBlocks: Math.max(1, Math.round(options.height * scale))
      });
      const insertBefore = state.layers.findIndex((l) => l.type === "geometry" || l.type === "rasterized-block" || l.type === "system-grid");
      const layers = [...state.layers];
      layers.splice(insertBefore >= 0 ? insertBefore : layers.length, 0, newLayer);
      // Persist image data to IndexedDB asynchronously
      storeImageData(newLayer.id, options.dataUrl).catch((err) =>
        console.warn("Failed to store image in IndexedDB:", err)
      );
      return { layers };
    }),
  addGeometryLayer: (name) =>
    set((state) => {
      const newLayer = createGeometryLayer(name || `Geometry ${geometryLayers(state.layers).length + 1}`);
      // Insert before the rasterized block layer or grid layer
      const insertBefore = state.layers.findIndex((l) => l.type === "rasterized-block" || l.type === "system-grid");
      const layers = [...state.layers];
      layers.splice(insertBefore >= 0 ? insertBefore : layers.length, 0, newLayer);
      return { layers, activeGeometryLayerId: newLayer.id };
    }),
  add3DTilesReferenceLayer: (options) =>
    set((state) => {
      const newLayer = create3DTilesReferenceLayer({
        name: options.name,
        provider: options.provider,
        apiKeyRef: options.apiKey ?? "",
      });
      // Insert before the system grid layer
      const insertBefore = state.layers.findIndex((l) => l.type === "system-grid");
      const layers = [...state.layers];
      layers.splice(insertBefore >= 0 ? insertBefore : layers.length, 0, newLayer);
      return { layers };
    }),
  update3DTilesReferenceLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === id && layer.type === "3d-tiles-reference" ? { ...layer, ...patch } : layer
      )
    })),
  moveLayerUp: (id) =>
    set((state) => {
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return state;
      const layer = state.layers[idx];
      // Don't allow moving system layers or moving above system layers
      if (layer.locked) return state;
      const prev = state.layers[idx - 1];
      if (prev.locked) return state;
      const layers = [...state.layers];
      [layers[idx - 1], layers[idx]] = [layers[idx], layers[idx - 1]];
      return { layers };
    }),
  moveLayerDown: (id) =>
    set((state) => {
      const idx = state.layers.findIndex((l) => l.id === id);
      if (idx < 0 || idx >= state.layers.length - 1) return state;
      const layer = state.layers[idx];
      if (layer.locked) return state;
      const next = state.layers[idx + 1];
      if (next.locked) return state;
      const layers = [...state.layers];
      [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
      return { layers };
    }),
  setGeometryLayerVerticalOffset: (id, verticalOffsetY) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === id && layer.type === "geometry" ? { ...layer, verticalOffsetY } : layer
      )
    })),
  setActiveGeometryLayer: (activeGeometryLayerId) => set({ activeGeometryLayerId }),
  updateTileOverlayLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === id && layer.type === "tile-overlay" ? { ...layer, ...patch } : layer
      )
    })),
  updateReferenceImageLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === id && layer.type === "reference-image" ? { ...layer, ...patch } : layer
      )
    })),
  // ── Project actions ──────────────────────────────────────────────────────
  loadProject: (project) =>
    set((state) => {
      const chunks = rebuildChunks(project.geometries, project.layers);
      return {
        viewport: project.viewport,
        layers: project.layers,
        geometries: project.geometries,
        chunks,
        activeBlock: project.activeBlock,
        activeGeometryLayerId: project.activeGeometryLayerId,
        selectedGeometryId: null,
        draftVertices: [],
        history: [],
        future: []
      };
    })
}));

// ── Autosave subscription ───────────────────────────────────────────────────

let pruneTimeout: ReturnType<typeof setTimeout> | null = null;

useEditorStore.subscribe((state) => {
  scheduleAutosave({
    viewport: state.viewport,
    layers: state.layers,
    geometries: state.geometries,
    activeBlock: state.activeBlock,
    activeGeometryLayerId: state.activeGeometryLayerId
  });

  // Debounced prune: clean orphaned IndexedDB image entries (2s delay)
  if (pruneTimeout) clearTimeout(pruneTimeout);
  pruneTimeout = setTimeout(() => {
    const imageIds = new Set(
      useEditorStore.getState().layers
        .filter((l): l is ReferenceImageLayer => l.type === "reference-image")
        .map((l) => l.id)
    );
    pruneImageData(imageIds).catch((err) =>
      console.warn("Failed to prune IndexedDB:", err)
    );
  }, 2000);
});

// ── Derived selectors ───────────────────────────────────────────────────────

/** Get tile overlay layers as TileSource[] for backward-compatible rendering. */
export function tileSourcesFromLayers(layers: McadLayer[]) {
  return tileOverlayLayers(layers);
}

/** Check if grid is visible (convenience selector). */
export { isGridVisible };

/** Get first active geometry layer id. */
export function firstGeometryLayerId(layers: McadLayer[]): string | null {
  const gl = geometryLayers(layers);
  return gl[0]?.id ?? null;
}

export function allBlocks(chunks: Map<ChunkID, ChunkData>): BlockCell[] {
  const blocks: BlockCell[] = [];
  for (const chunk of chunks.values()) blocks.push(...chunk.blocks.values());
  return blocks;
}
