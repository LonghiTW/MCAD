/// <reference types="vite/client" />

declare global {
  var Buffer: typeof import("buffer").Buffer;
}

declare module "bte-projection" {
  export const BTE_PROJECTION: {
    fromGeo(coord: { lat: number; lon: number }): { x: number; y: number };
    toGeo(coord: { x: number; y: number }): { lat: number; lon: number };
    bounds(): { minX: number; minY: number; maxX: number; maxY: number };
  };
}
