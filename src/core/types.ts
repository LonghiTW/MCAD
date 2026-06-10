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

export type GeometryType = "polyline" | "polygon" | "circle";

export type GeometryProperties = {
  blockType: string;
  /** Width in blocks (applies to polyline walls). */
  width?: number;
  /** Total height in blocks (polygon fill layers up to this height). */
  height?: number;
  /** Base Y offset in blocks — added to the geometry layer's verticalOffsetY. */
  baseY?: number;
  /** Line stack height — polyline is extruded upward this many blocks. */
  lineStackHeight?: number;
  /** Closed-shape line meaning: cell centerline, outer diameter, or inner diameter. */
  boundaryMode?: "center" | "outer" | "inner";
  /** Closed-shape fill mode. false = only ring/band edge; true = fill the selected side. */
  solid?: boolean;
  /** Bounded band thickness used for exterior solid generation. */
  closedShapeThickness?: number;
  priority?: number;
};

export interface BaseGeometry {
  id: string;
  type: GeometryType;
  properties: GeometryProperties;
  /** Owning geometry layer id. Omitted for legacy data (treated as first geometry layer). */
  layerId?: string;
}

export interface PathGeometry extends BaseGeometry {
  type: "polyline" | "polygon";
  vertices: Vec2[];
  holes?: Vec2[][];
}

export interface CircleGeometry extends BaseGeometry {
  type: "circle";
  center: Vec2;
  radius: number;
}

export type Geometry = PathGeometry | CircleGeometry;

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

export type ToolMode = "select" | "pan" | "polyline" | "polygon" | "vertex" | "erase" | "circle";

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
