export type Vec2 = {
  x: number;
  z: number;
};

export type Vec3 = Vec2 & {
  y: number;
};

export type LatLon = {
  lat: number;
  lon: number;
};

export type GeometryType = "polyline" | "polygon";

export type GeometryProperties = {
  blockType: string;
  width?: number;
  height?: number;
  priority?: number;
};

export interface Geometry {
  id: string;
  type: GeometryType;
  vertices: Vec2[];
  holes?: Vec2[][];
  properties: GeometryProperties;
}

export type BlockCell = {
  x: number;
  y: number;
  z: number;
  blockType: string;
  sourceGeometryId?: string;
};

export type ChunkID = `${number},${number}`;

export type ChunkData = {
  id: ChunkID;
  cx: number;
  cz: number;
  blocks: Map<string, BlockCell>;
  dirty: boolean;
  updatedAt: number;
};

export type ToolMode = "select" | "pan" | "polyline" | "polygon" | "vertex" | "erase";

export type TileSourceKind = "xyz" | "wmts";

export type TileSource = {
  id: string;
  name: string;
  kind: TileSourceKind;
  urlTemplate: string;
  attribution?: string | any;
  iconUrl?: string;
  minZoom: number;
  maxZoom: number;
  visible: boolean;
  opacity: number;
  offsetX?: number;
  offsetZ?: number;
  projection?: string;
  metadata?: Record<string, any>;
};

export type TileLibraryNode = {
  name: string;
  children: (TileSource | TileLibraryNode)[];
};

export type ViewportState = {
  center: Vec2;
  zoom: number;
  width: number;
  height: number;
};

export type CoordinateReadout = {
  minecraft: Vec2;
  latLon: LatLon;
  chunk: {
    cx: number;
    cz: number;
    localX: number;
    localZ: number;
  };
};
