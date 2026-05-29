export const MIN_ZOOM = 0.00001;
export const MAX_ZOOM = 512;
export const DEFAULT_GLOBAL_ZOOM = 0.000025;

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function fitBoundsZoom(width: number, height: number, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }) {
  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxZ - bounds.minZ;
  const zoom = Math.min(width / worldWidth, height / worldHeight) * 0.88;
  return clampZoom(zoom);
}
