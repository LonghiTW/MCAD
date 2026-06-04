import { useEffect, useRef } from "react";
import { latLonToMinecraft, tryMinecraftToLatLon } from "../core/projection";
import { detectMaxZoomFromUrl } from "../core/tiles";
import type { LatLon, TileSource, Vec2, ViewportState } from "../core/types";
import { useEditorStore } from "../store/editorStore";

type Props = {
  viewport: ViewportState;
  tileSources: TileSource[];
};

type TileRequest = {
  source: TileSource;
  x: number;
  y: number;
  z: number;
};

const TILE_SIZE = 256;

function tileZoomForViewport(zoom: number) {
  const bteEquatorWidth = 40_075_016.686;
  return Math.round(Math.log2((bteEquatorWidth * zoom) / TILE_SIZE));
}

function lonLatToTile(lon: number, lat: number, zoom: number) {
  const latRad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const n = 2 ** zoom;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  };
}

function tilePointToLatLon(tileX: number, tileY: number, zoom: number): LatLon {
  const n = 2 ** zoom;
  return {
    lon: (tileX / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI
  };
}

function toScreen(point: Vec2, viewport: ViewportState): Vec2 {
  return {
    x: (point.x - viewport.center.x) * viewport.zoom + viewport.width / 2,
    z: (point.z - viewport.center.z) * viewport.zoom + viewport.height / 2
  };
}

function triangleTooLong(a: Vec2, b: Vec2, c: Vec2, viewport: ViewportState) {
  const ab = Math.hypot(a.x - b.x, a.z - b.z);
  const bc = Math.hypot(b.x - c.x, b.z - c.z);
  const ca = Math.hypot(c.x - a.x, c.z - a.z);
  const maxAllowed = viewport.zoom < 0.0002 ? 180 : Math.max(180, Math.min(viewport.width, viewport.height) * 0.28);
  return Math.max(ab, bc, ca) > maxAllowed;
}

function addLayerOffset(point: Vec2, source: TileSource): Vec2 {
  return {
    x: point.x - (source.offsetX ?? 0),
    z: point.z - (source.offsetZ ?? 0)
  };
}

function worldTriangleCrossesSeam(a: Vec2, b: Vec2, c: Vec2, viewport: ViewportState) {
  const ab = Math.hypot(a.x - b.x, a.z - b.z);
  const bc = Math.hypot(b.x - c.x, b.z - c.z);
  const ca = Math.hypot(c.x - a.x, c.z - a.z);
  const visibleWorldSpan = Math.max(viewport.width, viewport.height) / viewport.zoom;
  const maxAllowed = visibleWorldSpan * 0.08;
  return Math.max(ab, bc, ca) > maxAllowed;
}

function triangleOffscreen(a: Vec2, b: Vec2, c: Vec2, viewport: ViewportState) {
  const minX = Math.min(a.x, b.x, c.x);
  const maxX = Math.max(a.x, b.x, c.x);
  const minY = Math.min(a.z, b.z, c.z);
  const maxY = Math.max(a.z, b.z, c.z);
  return maxX < -64 || maxY < -64 || minX > viewport.width + 64 || minY > viewport.height + 64;
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: [Vec2, Vec2, Vec2],
  dest: [Vec2, Vec2, Vec2],
  viewport: ViewportState
) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = dest;
  if (triangleTooLong(d0, d1, d2, viewport) || triangleOffscreen(d0, d1, d2, viewport)) return;

  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.z + d1.z + d2.z) / 3;
  const expand = (point: Vec2): Vec2 => {
    const dx = point.x - cx;
    const dz = point.z - cy;
    const length = Math.hypot(dx, dz) || 1;
    return {
      x: point.x + (dx / length) * 0.65,
      z: point.z + (dz / length) * 0.65
    };
  };
  const c0 = expand(d0);
  const c1 = expand(d1);
  const c2 = expand(d2);

  const det = s0.x * (s1.z - s2.z) + s1.x * (s2.z - s0.z) + s2.x * (s0.z - s1.z);
  if (Math.abs(det) < 0.00001) return;

  const a = (d0.x * (s1.z - s2.z) + d1.x * (s2.z - s0.z) + d2.x * (s0.z - s1.z)) / det;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / det;
  const e =
    (d0.x * (s1.x * s2.z - s2.x * s1.z) +
      d1.x * (s2.x * s0.z - s0.x * s2.z) +
      d2.x * (s0.x * s1.z - s1.x * s0.z)) /
    det;
  const b = (d0.z * (s1.z - s2.z) + d1.z * (s2.z - s0.z) + d2.z * (s0.z - s1.z)) / det;
  const d = (d0.z * (s2.x - s1.x) + d1.z * (s0.x - s2.x) + d2.z * (s1.x - s0.x)) / det;
  const f =
    (d0.z * (s1.x * s2.z - s2.x * s1.z) +
      d1.z * (s2.x * s0.z - s0.x * s2.z) +
      d2.z * (s0.x * s1.z - s1.x * s0.z)) /
    det;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.z);
  ctx.lineTo(c1.x, c1.z);
  ctx.lineTo(c2.x, c2.z);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
  ctx.restore();
}

function chooseTiles(viewport: ViewportState, source: TileSource): TileRequest[] {
  // When maxZoom is 0 (not yet detected), use a reasonable default to avoid z=0 (only 1 tile)
  const effectiveMaxZoom = source.maxZoom > 0 ? source.maxZoom : 22;
  const z = Math.max(source.minZoom, Math.min(effectiveMaxZoom, tileZoomForViewport(viewport.zoom)));
  const n = 2 ** z;

  if (viewport.zoom < 0.0002) {
    const requests: TileRequest[] = [];
    for (let x = 0; x < n; x += 1) {
      for (let y = 0; y < n; y += 1) requests.push({ source, x, y, z });
    }
    return requests;
  }

  const samples: LatLon[] = [];
  for (let sx = 0; sx <= 4; sx += 1) {
    for (let sy = 0; sy <= 4; sy += 1) {
      const world = {
        x: viewport.center.x + ((sx / 4) * viewport.width - viewport.width / 2) / viewport.zoom,
        z: viewport.center.z + ((sy / 4) * viewport.height - viewport.height / 2) / viewport.zoom
      };
      const geo = tryMinecraftToLatLon(world);
      if (geo) samples.push(geo);
    }
  }
  if (!samples.length) return [];

  const tiles = samples.map((sample) => lonLatToTile(sample.lon, sample.lat, z));
  const minX = Math.max(0, Math.min(...tiles.map((tile) => tile.x)) - 1);
  const maxX = Math.min(n - 1, Math.max(...tiles.map((tile) => tile.x)) + 1);
  const minY = Math.max(0, Math.min(...tiles.map((tile) => tile.y)) - 1);
  const maxY = Math.min(n - 1, Math.max(...tiles.map((tile) => tile.y)) + 1);
  const requests: TileRequest[] = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) requests.push({ source, x, y, z });
  }
  return requests;
}

export function TileMeshOverlay({ viewport, tileSources }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef(new Map<string, HTMLImageElement>());
  const updateTileSource = useEditorStore((state) => state.updateTileSource);
  const probedSourcesRef = useRef(new Map<string, string>());

  // Probe for maxZoom of each tile source
  useEffect(() => {
    let cancelled = false;
    for (const source of tileSources) {
      const lastProbedUrl = probedSourcesRef.current.get(source.id);
      if (lastProbedUrl === source.urlTemplate) continue; // Already probed this URL

      const probeSource = async () => {
        const detectedMaxZoom = await detectMaxZoomFromUrl(source.urlTemplate, source.id);
        if (cancelled) return;
        probedSourcesRef.current.set(source.id, source.urlTemplate);
        if (detectedMaxZoom > 0 && detectedMaxZoom !== source.maxZoom) {
          console.log(`[Probe] ${source.id}: detected maxZoom=${detectedMaxZoom}`);
          updateTileSource(source.id, { maxZoom: detectedMaxZoom });
        }
      };

      void probeSource();
    }

    return () => {
      cancelled = true;
    };
  }, [tileSources, updateTileSource]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.width <= 1 || viewport.height <= 1) return;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    const visibleSources = tileSources.filter((source) => source.visible && source.opacity > 0);

    const draw = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const source of visibleSources) {
        ctx.globalAlpha = source.opacity;
        for (const request of chooseTiles(viewport, source)) {
          const url = source.urlTemplate.replace("{x}", String(request.x)).replace("{y}", String(request.y)).replace("{z}", String(request.z));
          let image = cacheRef.current.get(url);
          if (!image) {
            image = new Image();
            image.crossOrigin = "anonymous";
            image.src = url;
            image.onload = draw;
            cacheRef.current.set(url, image);
          }
          if (!image.complete || image.naturalWidth === 0) continue;

          const subdivisions = viewport.zoom < 0.0002 ? 10 : 8;
          for (let i = 0; i < subdivisions; i += 1) {
            for (let j = 0; j < subdivisions; j += 1) {
              const u0 = i / subdivisions;
              const u1 = (i + 1) / subdivisions;
              const v0 = j / subdivisions;
              const v1 = (j + 1) / subdivisions;
              const geo00 = tilePointToLatLon(request.x + u0, request.y + v0, request.z);
              const geo10 = tilePointToLatLon(request.x + u1, request.y + v0, request.z);
              const geo11 = tilePointToLatLon(request.x + u1, request.y + v1, request.z);
              const geo01 = tilePointToLatLon(request.x + u0, request.y + v1, request.z);
              const w00 = addLayerOffset(latLonToMinecraft(geo00), source);
              const w10 = addLayerOffset(latLonToMinecraft(geo10), source);
              const w11 = addLayerOffset(latLonToMinecraft(geo11), source);
              const w01 = addLayerOffset(latLonToMinecraft(geo01), source);
              const p00 = toScreen(w00, viewport);
              const p10 = toScreen(w10, viewport);
              const p11 = toScreen(w11, viewport);
              const p01 = toScreen(w01, viewport);
              const s00 = { x: u0 * TILE_SIZE, z: v0 * TILE_SIZE };
              const s10 = { x: u1 * TILE_SIZE, z: v0 * TILE_SIZE };
              const s11 = { x: u1 * TILE_SIZE, z: v1 * TILE_SIZE };
              const s01 = { x: u0 * TILE_SIZE, z: v1 * TILE_SIZE };
              if (!worldTriangleCrossesSeam(w00, w10, w11, viewport)) {
                drawTexturedTriangle(ctx, image, [s00, s10, s11], [p00, p10, p11], viewport);
              }
              if (!worldTriangleCrossesSeam(w00, w11, w01, viewport)) {
                drawTexturedTriangle(ctx, image, [s00, s11, s01], [p00, p11, p01], viewport);
              }
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    draw();
    return () => {
      cancelled = true;
    };
  }, [viewport, tileSources]);

  return <canvas ref={canvasRef} className="tile-mesh-overlay" aria-hidden="true" />;
}
