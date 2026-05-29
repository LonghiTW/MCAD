import { create } from "zustand";
import { clearSourceBlocks, setBlock } from "../core/chunks";
import { defaultBteViewportCenter } from "../core/projection";
import { defaultTileSources } from "../core/tiles";
import { DEFAULT_GLOBAL_ZOOM } from "../core/view";
import { rasterizeGeometry } from "../core/rasterize";
import type { BlockCell, ChunkData, ChunkID, Geometry, TileSource, ToolMode, Vec2, ViewportState } from "../core/types";

type HistoryState = {
  geometries: Geometry[];
};

type EditorState = {
  viewport: ViewportState;
  tool: ToolMode;
  snapToGrid: boolean;
  selectedGeometryId: string | null;
  geometries: Geometry[];
  chunks: Map<ChunkID, ChunkData>;
  tileSources: TileSource[];
  activeBlock: string;
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
  updateGeometry: (geometry: Geometry) => void;
  deleteSelected: () => void;
  rerasterize: (geometry: Geometry) => void;
  undo: () => void;
  redo: () => void;
  toggleTiles: (id: string) => void;
  setTileOpacity: (id: string, opacity: number) => void;
  updateTileSource: (id: string, patch: Partial<TileSource>) => void;
  addTileSource: (name: string, urlTemplate: string, options?: { id?: string; opacity?: number; maxZoom?: number }) => void;
  deleteTileSource: (id: string) => void;
};

function snapshot(state: EditorState): HistoryState {
  return {
    geometries: state.geometries.map((geometry) => ({
      ...geometry,
      vertices: geometry.vertices.map((vertex) => ({ ...vertex })),
      holes: geometry.holes?.map((hole) => hole.map((vertex) => ({ ...vertex })))
    }))
  };
}

function rebuildChunks(geometries: Geometry[]) {
  const chunks = new Map<ChunkID, ChunkData>();
  for (const geometry of geometries) {
    for (const block of rasterizeGeometry(geometry)) setBlock(chunks, block);
  }
  return chunks;
}

function snap(point: Vec2, enabled: boolean): Vec2 {
  if (!enabled) return point;
  return { x: Math.round(point.x), z: Math.round(point.z) };
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
  viewport: { center: defaultBteViewportCenter(), zoom: DEFAULT_GLOBAL_ZOOM, width: 1, height: 1 },
  tool: "select",
  snapToGrid: true,
  selectedGeometryId: null,
  geometries: [],
  chunks: new Map(),
  tileSources: defaultTileSources,
  activeBlock: "gray_concrete",
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
        chunks: rebuildChunks(geometries),
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
      const geometry: Geometry = {
        id: crypto.randomUUID(),
        type,
        vertices: state.draftVertices,
        properties: {
          blockType: state.activeBlock,
          width: type === "polyline" ? 3 : 1,
          height: type === "polygon" ? 4 : 1,
          priority: 0
        }
      };
      const chunks = new Map(state.chunks);
      for (const block of rasterizeGeometry(geometry)) setBlock(chunks, block);
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
      for (const block of rasterizeGeometry(geometry)) setBlock(chunks, block);
      return { geometries, chunks, history: [...state.history, snapshot(state)], future: [] };
    }),
  deleteSelected: () =>
    set((state) => {
      if (!state.selectedGeometryId) return state;
      const geometries = state.geometries.filter((geometry) => geometry.id !== state.selectedGeometryId);
      return {
        geometries,
        chunks: rebuildChunks(geometries),
        selectedGeometryId: null,
        history: [...state.history, snapshot(state)],
        future: []
      };
    }),
  rerasterize: (geometry) =>
    set((state) => {
      const chunks = new Map(state.chunks);
      clearSourceBlocks(chunks, geometry.id);
      for (const block of rasterizeGeometry(geometry)) setBlock(chunks, block);
      return { chunks };
    }),
  undo: () =>
    set((state) => {
      const previous = state.history.at(-1);
      if (!previous) return state;
      const history = state.history.slice(0, -1);
      return {
        geometries: previous.geometries,
        chunks: rebuildChunks(previous.geometries),
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
        chunks: rebuildChunks(next.geometries),
        history: [...state.history, snapshot(state)],
        future: state.future.slice(1),
        selectedGeometryId: null
      };
    }),
  toggleTiles: (id) =>
    set((state) => ({
      tileSources: state.tileSources.map((source) => (source.id === id ? { ...source, visible: !source.visible } : source))
    })),
  setTileOpacity: (id, opacity) =>
    set((state) => ({
      tileSources: state.tileSources.map((source) => (source.id === id ? { ...source, opacity } : source))
    })),
  updateTileSource: (id, patch) =>
    set((state) => ({
      tileSources: state.tileSources.map((source) => (source.id === id ? { ...source, ...patch } : source))
    })),
  addTileSource: (name, urlTemplate, options) =>
    set((state) => ({
      tileSources: [
        ...state.tileSources,
        {
          id: options?.id || crypto.randomUUID(),
          name: name.trim() || "Custom layer",
          kind: "xyz",
          urlTemplate: urlTemplate.trim(),
          minZoom: 0,
          maxZoom: options?.maxZoom ?? 19,
          visible: true,
          opacity: options?.opacity ?? 1.0,
          offsetX: 0,
          offsetZ: 0
        }
      ]
    })),
  deleteTileSource: (id) =>
    set((state) => ({
      tileSources: state.tileSources.filter((source) => source.id !== id)
    }))
}));

export function allBlocks(chunks: Map<ChunkID, ChunkData>): BlockCell[] {
  const blocks: BlockCell[] = [];
  for (const chunk of chunks.values()) blocks.push(...chunk.blocks.values());
  return blocks;
}
