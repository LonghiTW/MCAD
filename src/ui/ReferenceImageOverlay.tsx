import { useEffect, useRef } from "react";
import { isReferenceImageLayer, type ReferenceImageLayer, type McadLayer } from "../core/layers";
import type { Vec2, ViewportState } from "../core/types";

type Props = {
  viewport: ViewportState;
  layers: McadLayer[];
  selectedImageId?: string | null;
};

function toScreen(point: Vec2, viewport: ViewportState): Vec2 {
  return {
    x: (point.x - viewport.center.x) * viewport.zoom + viewport.width / 2,
    z: (point.z - viewport.center.z) * viewport.zoom + viewport.height / 2
  };
}

/** Compute corner positions + rotate handle in world space for a given image layer. */
export function getImageHandles(
  img: ReferenceImageLayer
): { corners: { nw: Vec2; ne: Vec2; se: Vec2; sw: Vec2 }; edges: { top: Vec2; right: Vec2; bottom: Vec2; left: Vec2 }; rotateHandle: Vec2; center: Vec2 } {
  const rad = (img.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = img.widthBlocks / 2;
  const hh = img.heightBlocks / 2;

  function localToWorld(lx: number, lz: number): Vec2 {
    return {
      x: img.centerX + lx * cos - lz * sin,
      z: img.centerZ + lx * sin + lz * cos
    };
  }

  // Rotate handle offset proportional to image height, clamped to a reasonable range
  const rhOffset = hh * 0.1;

  return {
    corners: {
      nw: localToWorld(-hw, -hh),
      ne: localToWorld(hw, -hh),
      se: localToWorld(hw, hh),
      sw: localToWorld(-hw, hh)
    },
    edges: {
      top: localToWorld(0, -hh),
      right: localToWorld(hw, 0),
      bottom: localToWorld(0, hh),
      left: localToWorld(-hw, 0)
    },
    rotateHandle: localToWorld(0, -hh - rhOffset),
    center: { x: img.centerX, z: img.centerZ }
  };
}

export function ReferenceImageOverlay({ viewport, layers, selectedImageId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef(new Map<string, HTMLImageElement>());

  const imageLayers = layers.filter(isReferenceImageLayer);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.width <= 1 || viewport.height <= 1) return;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const layer of imageLayers) {
        if (!layer.visible || layer.opacity <= 0) continue;
        let image = cacheRef.current.get(layer.dataUrl);
        if (!image) {
          image = new Image();
          image.src = layer.dataUrl;
          image.onload = draw;
          cacheRef.current.set(layer.dataUrl, image);
        }
        if (!image.complete || image.naturalWidth === 0) continue;

        const center = toScreen({ x: layer.centerX, z: layer.centerZ }, viewport);
        const width = layer.widthBlocks * viewport.zoom;
        const height = layer.heightBlocks * viewport.zoom;

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
        ctx.translate(center.x, center.z);
        ctx.rotate((layer.rotationDeg * Math.PI) / 180);
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
        ctx.restore();

        // ── Draw selection handles for the selected image ─────────────────
        if (selectedImageId === layer.id) {
          const handles = getImageHandles(layer);
          const cScreen = toScreen(handles.center, viewport);
          const cornerScreen = Object.values(handles.corners).map((c) => toScreen(c, viewport));

          // Draw border (rotated rect)
          ctx.save();
          ctx.translate(cScreen.x, cScreen.z);
          ctx.rotate((layer.rotationDeg * Math.PI) / 180);
          ctx.strokeStyle = "#7fb982";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(-width / 2, -height / 2, width, height);
          ctx.setLineDash([]);
          ctx.restore();

          // Draw resize handles: 4 corners (white squares) + 4 edge midpoints (circles)
          const handleSize = 8;
          for (const cs of cornerScreen) {
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#7fb982";
            ctx.lineWidth = 1.5;
            ctx.fillRect(cs.x - handleSize / 2, cs.z - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(cs.x - handleSize / 2, cs.z - handleSize / 2, handleSize, handleSize);
          }
          const edgeWorlds = [handles.edges.top, handles.edges.right, handles.edges.bottom, handles.edges.left];
          for (const ew of edgeWorlds) {
            const es = toScreen(ew, viewport);
            ctx.beginPath();
            ctx.arc(es.x, es.z, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = "#7fb982";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          // Draw rotate handle: line from top-center to rotate handle position
          const tcScreen = toScreen(handles.edges.top, viewport);
          const rhScreen = toScreen(handles.rotateHandle, viewport);

          ctx.beginPath();
          ctx.moveTo(tcScreen.x, tcScreen.z);
          ctx.lineTo(rhScreen.x, rhScreen.z);
          ctx.strokeStyle = "#7fb982";
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Draw rotate handle circle (larger for better hit area)
          ctx.beginPath();
          ctx.arc(rhScreen.x, rhScreen.z, 7, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.strokeStyle = "#7fb982";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1;
    };

    draw();
    return () => {
      cancelled = true;
    };
  }, [viewport, imageLayers, selectedImageId]);

  return <canvas ref={canvasRef} className="reference-image-overlay" aria-hidden="true" />;
}
