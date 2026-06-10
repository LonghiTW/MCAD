import { useEffect, useMemo, useRef, useState } from "react";
import { chunkReadout } from "../core/chunks";
import { circumcircle } from "../core/geometryOps";
import { defaultBteViewportCenter, loadBteProjection, sampledBteWorldBounds, tryMinecraftToLatLon } from "../core/projection";
import { loadAutosave } from "../core/projectPersistence";
import { type ReferenceImageLayer, type McadLayer } from "../core/layers";
import { geometrySpatialIndex } from "../core/spatialIndex";
import { getImageHandles } from "./ReferenceImageOverlay";
import type { CoordinateReadout, Vec2 } from "../core/types";
import { MinecraftWebGLRenderer } from "../render/webglRenderer";
import { useEditorStore } from "../store/editorStore";
import { clampZoom, fitBoundsZoom } from "../core/view";
import { TileMeshOverlay } from "./TileMeshOverlay";
import { ReferenceImageOverlay } from "./ReferenceImageOverlay";
import { ViewportContextMenu, triggerContextMenu } from "./ViewportContextMenu";

type Props = {
  onCoordinate: (coordinate: CoordinateReadout) => void;
  circleMode: "center-radius" | "three-point";
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
  // Use spatial index for O(log n) candidate filtering, then precise check
  const candidateIds = geometrySpatialIndex.queryPoint(point.x, point.z, tolerance);
  const candidateSet = new Set(candidateIds);

  let best: { id: string; distance: number } | null = null;
  for (const geometry of geometries) {
    if (!candidateSet.has(geometry.id)) continue;
    if (geometry.type === "circle") {
      const distance = Math.abs(Math.hypot(point.x - geometry.center.x, point.z - geometry.center.z) - geometry.radius);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { id: geometry.id, distance };
      continue;
    }
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

/**
 * Hit-test reference image layers: does the point fall within the image's
 * rotated bounding rectangle OR near any of its handles (corners, edges,
 * rotate handle) in Minecraft X/Z space?
 */
function hitTestImageLayer(
  point: Vec2,
  layers: McadLayer[],
  viewport: { center: Vec2; zoom: number }
): ReferenceImageLayer | null {
  const zoom = viewport.zoom;
  // Generous tolerance so handles outside the body are still hittable
  const handleTolerance = Math.max(1.5, 12 / zoom);
  const rotateTolerance = handleTolerance * 1.5;

  // Iterate layers in reverse (top-most first) for selection priority
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.type !== "reference-image" || !layer.visible || layer.opacity <= 0) continue;
    const img = layer as ReferenceImageLayer;

    // Check rotate handle first (most likely to be outside the body)
    const handles = getImageHandles(img);
    const rhDist = Math.hypot(point.x - handles.rotateHandle.x, point.z - handles.rotateHandle.z);
    if (rhDist <= rotateTolerance) return img;

    // Check corners
    const corners = Object.values(handles.corners);
    for (const corner of corners) {
      const dist = Math.hypot(point.x - corner.x, point.z - corner.z);
      if (dist <= handleTolerance) return img;
    }

    // Check edge midpoints
    const edges = Object.values(handles.edges);
    for (const edge of edges) {
      const dist = Math.hypot(point.x - edge.x, point.z - edge.z);
      if (dist <= handleTolerance) return img;
    }

    // Check body (inside the rotated rect)
    const dx = point.x - img.centerX;
    const dz = point.z - img.centerZ;
    const rad = -(img.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const halfW = img.widthBlocks / 2;
    const halfH = img.heightBlocks / 2;
    if (localX >= -halfW && localX <= halfW && localZ >= -halfH && localZ <= halfH) {
      return img;
    }
  }
  return null;
}

type ImageHandleHit =
  | { kind: "resize-corner"; corner: "nw" | "ne" | "se" | "sw" }
  | { kind: "resize-edge"; edge: "top" | "right" | "bottom" | "left" }
  | { kind: "rotate" }
  | { kind: "body" }
  | null;

/**
 * Hit-test specific handles on the selected image layer.
 * Returns which handle (if any) the point is near.
 */
function hitTestImageHandle(
  point: Vec2,
  img: ReferenceImageLayer,
  zoom: number,
  tolerance: number
): ImageHandleHit {
  const handles = getImageHandles(img);

  // Check rotate handle first (proportional offset, generous hit area)
  const rhDist = Math.hypot(point.x - handles.rotateHandle.x, point.z - handles.rotateHandle.z);
  if (rhDist <= tolerance * 1.5) return { kind: "rotate" };

  // Check corners (resize handles)
  type CornerKey = "nw" | "ne" | "se" | "sw";
  const corners: [CornerKey, Vec2][] = [
    ["nw", handles.corners.nw],
    ["ne", handles.corners.ne],
    ["se", handles.corners.se],
    ["sw", handles.corners.sw]
  ];
  for (const [key, pos] of corners) {
    const dist = Math.hypot(point.x - pos.x, point.z - pos.z);
    if (dist <= tolerance) return { kind: "resize-corner", corner: key };
  }

  // Check edge midpoints (resize handles)
  type EdgeKey = "top" | "right" | "bottom" | "left";
  const edges: [EdgeKey, Vec2][] = [
    ["top", handles.edges.top],
    ["right", handles.edges.right],
    ["bottom", handles.edges.bottom],
    ["left", handles.edges.left]
  ];
  for (const [key, pos] of edges) {
    const dist = Math.hypot(point.x - pos.x, point.z - pos.z);
    if (dist <= tolerance) return { kind: "resize-edge", edge: key };
  }

  // Check body (inside the rotated rect)
  const dx = point.x - img.centerX;
  const dz = point.z - img.centerZ;
  const rad = -(img.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const halfW = img.widthBlocks / 2;
  const halfH = img.heightBlocks / 2;
  if (localX >= -halfW && localX <= halfW && localZ >= -halfH && localZ <= halfH) {
    return { kind: "body" };
  }

  return null;
}

/** Get the cursor style for a given handle hit. */
function handleCursor(hit: ImageHandleHit): string {
  if (!hit) return "default";
  if (hit.kind === "rotate") return "grab";
  if (hit.kind === "body") return "move";
  if (hit.kind === "resize-corner") {
    switch (hit.corner) {
      case "nw": case "se": return "nwse-resize";
      case "ne": case "sw": return "nesw-resize";
    }
  }
  if (hit.kind === "resize-edge") {
    switch (hit.edge) {
      case "top": case "bottom": return "ns-resize";
      case "left": case "right": return "ew-resize";
    }
  }
  return "default";
}

export function ViewportCanvas({ onCoordinate, circleMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MinecraftWebGLRenderer | null>(null);
  const draggingRef = useRef<{ x: number; y: number; center: Vec2 } | null>(null);
  const vertexDragRef = useRef<{ geometryId: string; vertexIndex: number } | null>(null);
  const imageDragRef = useRef<{
    mode: "move" | "resize" | "rotate";
    layerId: string;
    startCenterX: number;
    startCenterZ: number;
    startMouseX: number;
    startMouseZ: number;
    startWidthBlocks: number;
    startHeightBlocks: number;
    startRotationDeg: number;
    resizeCorner?: "nw" | "ne" | "se" | "sw";
    resizeEdge?: "top" | "right" | "bottom" | "left";
    aspectRatio?: number;
  } | null>(null);
  const fittedInitialWorldRef = useRef(loadAutosave() !== null);
  const circlePointsRef = useRef<Vec2[]>([]);
  const [circlePreview, setCirclePreview] = useState<Vec2[] | null>(null);
  const [circleDraftPreview, setCircleDraftPreview] = useState<{ center: Vec2; radius: number } | null>(null);
  const [closeDraftPreview, setCloseDraftPreview] = useState(false);
  const suppressClickRef = useRef(false);
  const lastClickTimeRef = useRef(0);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const state = useEditorStore();
  const renderInput = useMemo(
    () => ({
      viewport: state.viewport,
      chunks: state.chunks,
      geometries: state.geometries,
      draftVertices: state.draftVertices,
      selectedGeometryId: state.selectedGeometryId,
      layers: state.layers,
      closeDraftPreview,
      circleDraftPreview
    }),
    [state.viewport, state.chunks, state.geometries, state.draftVertices, state.selectedGeometryId, state.layers, closeDraftPreview, circleDraftPreview]
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
    if (state.tool !== "polyline" || state.draftVertices.length < 3) setCloseDraftPreview(false);
  }, [state.tool, state.draftVertices.length]);

  useEffect(() => {
    circlePointsRef.current = [];
    setCirclePreview(null);
    setCircleDraftPreview(null);
  }, [state.tool, circleMode]);

  // Clear image selection when switching away from select tool
  useEffect(() => {
    if (state.tool !== "select") {
      setSelectedImageId(null);
    }
  }, [state.tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      // Shift+scroll: scale hovered reference image
      if (event.shiftKey) {
        const rect = canvas.getBoundingClientRect();
        const point = screenToWorld(event.clientX, event.clientY, rect, useEditorStore.getState().viewport.center, useEditorStore.getState().viewport.zoom);
        const hitImage = hitTestImageLayer(point, useEditorStore.getState().layers, useEditorStore.getState().viewport);
        if (hitImage) {
          event.preventDefault();
          const scaleFactor = event.deltaY > 0 ? 0.92 : 1.08;
          const store = useEditorStore.getState();
          store.updateReferenceImageLayer(hitImage.id, {
            widthBlocks: Math.max(1, Math.round(hitImage.widthBlocks * scaleFactor)),
            heightBlocks: Math.max(1, Math.round(hitImage.heightBlocks * scaleFactor))
          });
          return;
        }
      }
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.82 : 1.22;
      useEditorStore.getState().setViewport({
        zoom: clampZoom(useEditorStore.getState().viewport.zoom * delta)
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c") return;
      if (event.repeat) return;
      const storeState = useEditorStore.getState();
      if (storeState.tool !== "polyline" || storeState.draftVertices.length < 3) return;
      event.preventDefault();
      setCloseDraftPreview(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c") return;
      setCloseDraftPreview(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const updateCoordinate = (point: Vec2) => {
    const latLon = tryMinecraftToLatLon(point) ?? { lat: Number.NaN, lon: Number.NaN };
    onCoordinate({
      minecraft: point,
      latLon,
      chunk: chunkReadout(point.x, point.z)
    });
  };

  const handleInsertVertex = (afterIndex: number, point: Vec2) => {
    const storeState = useEditorStore.getState();
    const selected = storeState.selectedGeometryId;
    if (selected) {
      storeState.addVertexToGeometry(selected, afterIndex, point);
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!rect) return;
    const point = screenToWorld(event.clientX, event.clientY, rect, state.viewport.center, state.viewport.zoom);
    const tolerance = Math.max(0.75, 8 / state.viewport.zoom);

    // Check if hovering on a vertex
    let hoveredGeometry = null;
    let edgeIndex: number | null = null;
    for (const geometry of state.geometries) {
      if (geometry.type === "circle") {
        const circleDistance = Math.abs(Math.hypot(point.x - geometry.center.x, point.z - geometry.center.z) - geometry.radius);
        if (circleDistance <= tolerance) {
          hoveredGeometry = geometry;
          break;
        }
        continue;
      }
      // Check vertices
      const nearVertex = geometry.vertices.some((v) => Math.hypot(v.x - point.x, v.z - point.z) <= tolerance);
      if (nearVertex) {
        hoveredGeometry = geometry;
        break;
      }
      // Check edges
      for (let i = 0; i < geometry.vertices.length; i += 1) {
        const next = geometry.vertices[(i + 1) % geometry.vertices.length];
        if (distanceToSegment(point, geometry.vertices[i], next) <= tolerance) {
          hoveredGeometry = geometry;
          edgeIndex = i;
          break;
        }
      }
      if (hoveredGeometry) break;
    }

    triggerContextMenu(event, point, hoveredGeometry, edgeIndex);
  };

  return (
    <div className="viewport-shell">
      <TileMeshOverlay viewport={state.viewport} layers={state.layers} />
      <ReferenceImageOverlay viewport={state.viewport} layers={state.layers} selectedImageId={selectedImageId} />
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(event.clientX, event.clientY, rect, state.viewport.center, state.viewport.zoom);
          updateCoordinate(point);
          if (state.tool === "circle" && circleMode === "center-radius" && circlePointsRef.current.length === 1) {
            const center = circlePointsRef.current[0];
            setCircleDraftPreview({ center, radius: Math.hypot(point.x - center.x, point.z - center.z) });
          }
          // Handle reference image dragging (move / resize / rotate)
          const imageDrag = imageDragRef.current;
          if (imageDrag) {
            if (imageDrag.mode === "move") {
              const dx = point.x - imageDrag.startMouseX;
              const dz = point.z - imageDrag.startMouseZ;
              state.updateReferenceImageLayer(imageDrag.layerId, {
                centerX: imageDrag.startCenterX + dx,
                centerZ: imageDrag.startCenterZ + dz
              });
            } else if (imageDrag.mode === "rotate") {
              const img = state.layers.find(
                (l) => l.id === imageDrag.layerId && l.type === "reference-image"
              ) as ReferenceImageLayer | undefined;
              if (img) {
                const startAngle = Math.atan2(
                  imageDrag.startMouseZ - imageDrag.startCenterZ,
                  imageDrag.startMouseX - imageDrag.startCenterX
                );
                const curAngle = Math.atan2(point.z - img.centerZ, point.x - img.centerX);
                const deltaAngle = (curAngle - startAngle) * (180 / Math.PI);
                // Round to nearest degree for cleaner values
                state.updateReferenceImageLayer(imageDrag.layerId, {
                  rotationDeg: Math.round(imageDrag.startRotationDeg + deltaAngle)
                });
              }
            } else if (imageDrag.mode === "resize") {
              // Resize: project mouse drag onto the image-local axis
              const img = state.layers.find(
                (l) => l.id === imageDrag.layerId && l.type === "reference-image"
              ) as ReferenceImageLayer | undefined;
              if (img) {
                const rad = -(imageDrag.startRotationDeg * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const dmX = point.x - imageDrag.startMouseX;
                const dmZ = point.z - imageDrag.startMouseZ;
                // Local-space delta
                const localDX = dmX * cos - dmZ * sin;
                const localDZ = dmX * sin + dmZ * cos;

                let newW = imageDrag.startWidthBlocks;
                let newH = imageDrag.startHeightBlocks;
                const aspectRatio = imageDrag.startWidthBlocks / imageDrag.startHeightBlocks;

                if (imageDrag.resizeCorner) {
                  // Corner drag → always proportional
                  const corner = imageDrag.resizeCorner;
                  const signX = (corner === "ne" || corner === "se") ? 1 : -1;
                  const signZ = (corner === "se" || corner === "sw") ? 1 : -1;
                  const delta = Math.abs(signX * localDX) >= Math.abs(signZ * localDZ)
                    ? signX * localDX
                    : signZ * localDZ;
                  newW = Math.max(1, imageDrag.startWidthBlocks + delta * 2);
                  newH = Math.max(1, Math.round(newW / aspectRatio));
                } else if (imageDrag.resizeEdge) {
                  // Edge drag → single axis
                  const edge = imageDrag.resizeEdge;
                  if (edge === "top" || edge === "bottom") {
                    const signZ = edge === "bottom" ? 1 : -1;
                    newH = Math.max(1, imageDrag.startHeightBlocks + signZ * localDZ * 2);
                  } else {
                    const signX = edge === "right" ? 1 : -1;
                    newW = Math.max(1, imageDrag.startWidthBlocks + signX * localDX * 2);
                  }
                }

                state.updateReferenceImageLayer(imageDrag.layerId, {
                  widthBlocks: Math.round(newW),
                  heightBlocks: Math.round(newH)
                });
              }
            }
            return;
          }
          // Update cursor when hovering over reference images (select mode only)
          if (state.tool === "select") {
            const hitImage = hitTestImageLayer(point, state.layers, state.viewport);
            if (hitImage) {
              const tolerance = Math.max(1.5, 12 / state.viewport.zoom);
              const handleHit = hitTestImageHandle(point, hitImage, state.viewport.zoom, tolerance);
              event.currentTarget.style.cursor = handleCursor(handleHit ?? { kind: "body" });
            } else {
              event.currentTarget.style.cursor = "default";
            }
          }
          const vertexDrag = vertexDragRef.current;
          if (vertexDrag) {
            const geometry = state.geometries.find((item) => item.id === vertexDrag.geometryId);
            if (geometry && geometry.type !== "circle") {
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
              if (geometry.type === "circle") continue;
              const vertexIndex = geometry.vertices.findIndex((vertex) => Math.hypot(vertex.x - point.x, vertex.z - point.z) <= tolerance);
              if (vertexIndex >= 0) {
                vertexDragRef.current = { geometryId: geometry.id, vertexIndex };
                state.setSelectedGeometry(geometry.id);
                return;
              }
            }
            // Check if clicking on a reference image for drag-to-move/resize/rotate
            const hitImage = hitTestImageLayer(point, state.layers, state.viewport);
            if (hitImage) {
              const tolerance = Math.max(1.5, 12 / state.viewport.zoom);
              const handleHit = hitTestImageHandle(point, hitImage, state.viewport.zoom, tolerance);
              const baseDrag = {
                layerId: hitImage.id,
                startCenterX: hitImage.centerX,
                startCenterZ: hitImage.centerZ,
                startMouseX: point.x,
                startMouseZ: point.z,
                startWidthBlocks: hitImage.widthBlocks,
                startHeightBlocks: hitImage.heightBlocks,
                startRotationDeg: hitImage.rotationDeg
              };

              if (handleHit?.kind === "rotate") {
                imageDragRef.current = { ...baseDrag, mode: "rotate" };
                return;
              }
              if (handleHit?.kind === "resize-corner") {
                imageDragRef.current = {
                  ...baseDrag,
                  mode: "resize",
                  resizeCorner: handleHit.corner
                };
                return;
              }
              if (handleHit?.kind === "resize-edge") {
                imageDragRef.current = {
                  ...baseDrag,
                  mode: "resize",
                  resizeEdge: handleHit.edge
                };
                return;
              }
              // Body click → only left button for move
              if (event.button === 0) {
                imageDragRef.current = { ...baseDrag, mode: "move" };
                setSelectedImageId(hitImage.id);
                return;
              }
            }
            // Clicking on canvas but not on any image → deselect image
            setSelectedImageId(null);
          }
          if (state.tool === "pan" || event.button === 1 || event.altKey) {
            draggingRef.current = { x: event.clientX, y: event.clientY, center: state.viewport.center };
          }
        }}
        onMouseUp={() => {
          draggingRef.current = null;
          vertexDragRef.current = null;
          imageDragRef.current = null;
        }}
        onMouseLeave={() => {
          draggingRef.current = null;
          vertexDragRef.current = null;
          imageDragRef.current = null;
        }}
        onClick={(event) => {
          if (suppressClickRef.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const point = screenToWorld(event.clientX, event.clientY, rect, state.viewport.center, state.viewport.zoom);

          // Detect double-click proactively: two clicks within 300ms
          const now = Date.now();
          const isDoubleClick = now - lastClickTimeRef.current < 300;
          lastClickTimeRef.current = now;

          if (isDoubleClick && (state.tool === "polyline" || state.tool === "polygon")) {
            // Second click of a double-click: skip vertex, commit geometry
            suppressClickRef.current = true;
            setTimeout(() => { suppressClickRef.current = false; }, 0);
            if (state.tool === "polyline" && closeDraftPreview) {
              state.closeDraftAsPolygon();
              setCloseDraftPreview(false);
            } else {
              state.commitGeometry(state.tool);
            }
            return;
          }

          if (state.tool === "polyline" && closeDraftPreview && state.draftVertices.length >= 3) {
            state.closeDraftAsPolygon();
            setCloseDraftPreview(false);
            return;
          }

          if (state.tool === "polyline" || state.tool === "polygon") state.addDraftVertex(point);
          if (state.tool === "circle") {
            if (circleMode === "center-radius") {
              if (circlePointsRef.current.length === 0) {
                circlePointsRef.current = [point];
                setCircleDraftPreview({ center: point, radius: 0 });
              } else {
                const center = circlePointsRef.current[0];
                const radius = Math.hypot(point.x - center.x, point.z - center.z);
                if (radius > 0) useEditorStore.getState().commitCircleGeometry(center, radius);
                circlePointsRef.current = [];
                setCircleDraftPreview(null);
              }
              return;
            }

            circlePointsRef.current.push(point);
            if (circlePointsRef.current.length === 3) {
              const [p1, p2, p3] = circlePointsRef.current;
              const result = circumcircle(p1, p2, p3);
              if (result) {
                useEditorStore.getState().commitCircleGeometry(result.center, result.radius);
              } else {
                alert("These three points are collinear. Cannot form a circle.");
              }
              circlePointsRef.current = [];
              setCirclePreview(null);
              setCircleDraftPreview(null);
            } else {
              setCirclePreview([...circlePointsRef.current]);
            }
            return;
          }
          if (state.tool === "select") {
            state.setSelectedGeometry(hitTestGeometry(point, state.geometries, Math.max(0.75, 8 / state.viewport.zoom)));
          }
          if (state.tool === "erase") {
            const selected = hitTestGeometry(point, state.geometries, Math.max(0.75, 8 / state.viewport.zoom));
            if (selected) state.deleteGeometry(selected);
          }
        }}
        onDoubleClick={() => {
          // Double-click commit is now handled in onClick via timing detection.
          // Reset suppress in case the timing path didn't fire.
          suppressClickRef.current = true;
          setTimeout(() => { suppressClickRef.current = false; }, 0);
        }}
        onContextMenu={handleContextMenu}
      />
      <ViewportContextMenu onInsertVertex={handleInsertVertex} />
      {webglError ? <div className="viewport-error">{webglError}</div> : null}
    </div>
  );
}
