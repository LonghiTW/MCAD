import { useEffect, useMemo, useRef, useState } from "react";
import { chunkReadout } from "../core/chunks";
import { defaultBteViewportCenter, loadBteProjection, sampledBteWorldBounds, tryMinecraftToLatLon } from "../core/projection";
import type { CoordinateReadout, Vec2 } from "../core/types";
import { MinecraftWebGLRenderer } from "../render/webglRenderer";
import { useEditorStore } from "../store/editorStore";
import { clampZoom, fitBoundsZoom } from "../core/view";
import { TileMeshOverlay } from "./TileMeshOverlay";

type Props = {
  onCoordinate: (coordinate: CoordinateReadout) => void;
};

function screenToWorld(clientX: number, clientY: number, rect: DOMRect, center: Vec2, zoom: number): Vec2 {
  return {
    x: center.x + (clientX - rect.left - rect.width / 2) / zoom,
    z: center.z + (clientY - rect.top - rect.height / 2) / zoom
  };
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
}

function hitTestGeometry(point: Vec2, geometries: ReturnType<typeof useEditorStore.getState>["geometries"], tolerance: number) {
  let best: { id: string; distance: number } | null = null;
  for (const geometry of geometries) {
    for (let i = 0; i < geometry.vertices.length; i += 1) {
      const vertexDistance = Math.hypot(point.x - geometry.vertices[i].x, point.z - geometry.vertices[i].z);
      if (vertexDistance <= tolerance && (!best || vertexDistance < best.distance)) best = { id: geometry.id, distance: vertexDistance };
      const next = geometry.vertices[i + 1] ?? (geometry.type === "polygon" ? geometry.vertices[0] : null);
      if (!next) continue;
      const edgeDistance = distanceToSegment(point, geometry.vertices[i], next);
      if (edgeDistance <= tolerance && (!best || edgeDistance < best.distance)) best = { id: geometry.id, distance: edgeDistance };
    }
  }
  return best?.id ?? null;
}

export function ViewportCanvas({ onCoordinate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MinecraftWebGLRenderer | null>(null);
  const draggingRef = useRef<{ x: number; y: number; center: Vec2 } | null>(null);
  const vertexDragRef = useRef<{ geometryId: string; vertexIndex: number } | null>(null);
  const fittedInitialWorldRef = useRef(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const state = useEditorStore();
  const renderInput = useMemo(
    () => ({
      viewport: state.viewport,
      chunks: state.chunks,
      geometries: state.geometries,
      draftVertices: state.draftVertices,
      selectedGeometryId: state.selectedGeometryId,
      tileSources: state.tileSources,
      gridVisible: state.gridVisible
    }),
    [state.viewport, state.chunks, state.geometries, state.draftVertices, state.selectedGeometryId, state.tileSources, state.gridVisible]
  );

  useEffect(() => {
    loadBteProjection();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new MinecraftWebGLRenderer(canvas);
    } catch (error) {
      setWebglError(error instanceof Error ? error.message : "Unable to start WebGL renderer");
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!fittedInitialWorldRef.current && width > 1 && height > 1) {
        fittedInitialWorldRef.current = true;
        state.setViewport({ width, height, center: defaultBteViewportCenter(), zoom: fitBoundsZoom(width, height, sampledBteWorldBounds()) });
        return;
      }
      state.setViewport({ width, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    rendererRef.current?.render(renderInput);
  }, [renderInput]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.82 : 1.22;
      useEditorStore.getState().setViewport({
        zoom: clampZoom(useEditorStore.getState().viewport.zoom * delta)
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const updateCoordinate = (point: Vec2) => {
    const latLon = tryMinecraftToLatLon(point) ?? { lat: Number.NaN, lon: Number.NaN };
    onCoordinate({
      minecraft: point,
      latLon,
      chunk: chunkReadout(point.x, point.z)
    });
  };

  return (
    <div className="viewport-shell">
      <TileMeshOverlay viewport={state.viewport} tileSources={state.tileSources} />
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(event.clientX, event.clientY, rect, state.viewport.center, state.viewport.zoom);
          updateCoordinate(point);
          const vertexDrag = vertexDragRef.current;
          if (vertexDrag) {
            const geometry = state.geometries.find((item) => item.id === vertexDrag.geometryId);
            if (geometry) {
              const vertices = geometry.vertices.map((vertex, index) => (index === vertexDrag.vertexIndex ? point : vertex));
              state.updateGeometry({ ...geometry, vertices });
            }
            return;
          }
          const dragging = draggingRef.current;
          if (!dragging) return;
          state.setViewport({
            center: {
              x: dragging.center.x - (event.clientX - dragging.x) / state.viewport.zoom,
              z: dragging.center.z - (event.clientY - dragging.y) / state.viewport.zoom
            }
          });
        }}
        onMouseDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(event.clientX, event.clientY, rect, state.viewport.center, state.viewport.zoom);
          if (state.tool === "select") {
            const tolerance = Math.max(0.75, 8 / state.viewport.zoom);
            for (const geometry of state.geometries) {
              const vertexIndex = geometry.vertices.findIndex((vertex) => Math.hypot(vertex.x - point.x, vertex.z - point.z) <= tolerance);
              if (vertexIndex >= 0) {
                vertexDragRef.current = { geometryId: geometry.id, vertexIndex };
                state.setSelectedGeometry(geometry.id);
                return;
              }
            }
          }
          if (state.tool === "pan" || event.button === 1 || event.altKey) {
            draggingRef.current = { x: event.clientX, y: event.clientY, center: state.viewport.center };
          }
        }}
        onMouseUp={() => {
          draggingRef.current = null;
          vertexDragRef.current = null;
        }}
        onMouseLeave={() => {
          draggingRef.current = null;
          vertexDragRef.current = null;
        }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(event.clientX, event.clientY, rect, state.viewport.center, state.viewport.zoom);
          if (state.tool === "polyline" || state.tool === "polygon") state.addDraftVertex(point);
          if (state.tool === "select") {
            state.setSelectedGeometry(hitTestGeometry(point, state.geometries, Math.max(0.75, 8 / state.viewport.zoom)));
          }
          if (state.tool === "erase") {
            const selected = hitTestGeometry(point, state.geometries, Math.max(0.75, 8 / state.viewport.zoom));
            if (selected) state.deleteGeometry(selected);
          }
        }}
        onDoubleClick={() => {
          if (state.tool === "polyline" || state.tool === "polygon") state.commitGeometry(state.tool);
        }}
      />
      {webglError ? <div className="viewport-error">{webglError}</div> : null}
    </div>
  );
}
