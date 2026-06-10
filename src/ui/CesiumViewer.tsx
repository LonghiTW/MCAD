/**
 * CesiumViewer.tsx — CesiumJS-based Google 3D Tiles reference viewer.
 *
 * Replaces the 2D viewport when a 3D Tiles layer is visible.
 * Camera position syncs with the MCAD 2D viewport center.
 */
import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import type { ThreeDTilesReferenceLayer } from "../core/layers";
import { useEditorStore } from "../store/editorStore";
import { minecraftToLatLon } from "../core/projection";
import { getStoredApiKey } from "./ApiKeyDialog";

// Suppress Ion default token warning
try { (Cesium.Ion as any).defaultAccessToken = undefined; } catch { /* ignore */ }

type CesiumViewerProps = {
  layer: ThreeDTilesReferenceLayer;
  onExit: () => void;
};

/**
 * Try to resolve MCAD Minecraft X/Z coordinates to lat/lon for Cesium camera positioning.
 */
function mcadToCesiumCartesian(x: number, z: number): Cesium.Cartesian3 {
  try {
    const latLon = minecraftToLatLon({ x, z });
    const lat = latLon.lat ?? 0;
    const lon = latLon.lon ?? 0;
    return Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  } catch {
    // Fallback to BTE world center if projection not available
    return Cesium.Cartesian3.fromDegrees(139.6917, 35.6895, 0);
  }
}

export function CesiumViewer({ layer, onExit }: CesiumViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const tilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const viewport = useEditorStore((s) => s.viewport);
  const [tilesetError, setTilesetError] = useState<string | null>(null);

  // Initialize Cesium viewer
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: false,           // Do NOT load default Bing Maps imagery (needs Cesium Ion token)
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      creditContainer: document.createElement("div"),
      requestRenderMode: false,
      maximumRenderTimeChange: Infinity,
    } as any);

    // Make globe transparent but keep it for depth testing
    viewer.scene.globe.baseColor = Cesium.Color.TRANSPARENT;
    viewer.scene.globe.show = true;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#111515");
    viewer.scene.fog.enabled = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;

    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      tilesetRef.current = null;
    };
  }, []);

  // Load / reload tileset when layer config changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // Remove old tileset
    if (tilesetRef.current) {
      viewer.scene.primitives.remove(tilesetRef.current);
      tilesetRef.current = null;
    }

    if (!layer.visible) return;

    // Use layer apiKeyRef first, fall back to localStorage
    const apiKey = layer.apiKeyRef || getStoredApiKey();
    const tilesetUrl = layer.rootTilesetUrl;

    if (!apiKey || !tilesetUrl) return;

    // For Google 3D Tiles, build the URL with API key
    let url = tilesetUrl;
    if (layer.provider === "google-photorealistic-3d-tiles") {
      url = tilesetUrl + "?key=" + encodeURIComponent(apiKey);
    }

    let cancelled = false;
    setTilesetError(null);

    // CesiumJS v1.100+ requires fromUrl() static method — constructor url param is silently ignored
    Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: 16,
      dynamicScreenSpaceError: true,
      skipLevelOfDetail: true,
      immediatelyLoadDesiredLevelOfDetail: false,
    }).then((tileset) => {
      if (cancelled) return;

      // Apply offsets via model matrix
      tileset.modelMatrix = Cesium.Matrix4.fromTranslation(
        new Cesium.Cartesian3(
          layer.horizontalOffsetX,
          layer.verticalOffsetY,
          layer.horizontalOffsetZ
        )
      );

      viewer.scene.primitives.add(tileset);
      tilesetRef.current = tileset;
      setTilesetError(null);
      console.log("[CesiumViewer] 3D Tiles loaded successfully from:", url.split("?")[0]);
    }).catch((error: any) => {
      if (cancelled) return;
      console.error("[CesiumViewer] 3D Tiles load failed:", error);
      setTilesetError(error?.message ?? "Failed to load 3D Tiles. Check your API key and network.");
    });

    return () => {
      cancelled = true;
      if (tilesetRef.current && viewer) {
        viewer.scene.primitives.remove(tilesetRef.current);
        tilesetRef.current = null;
      }
    };
  }, [layer.rootTilesetUrl, layer.apiKeyRef, layer.provider, layer.visible,
      layer.horizontalOffsetX, layer.horizontalOffsetZ, layer.verticalOffsetY]);

  // Update offsets when they change (without reloading tileset)
  useEffect(() => {
    const tileset = tilesetRef.current;
    if (!tileset) return;

    const modelMatrix = Cesium.Matrix4.fromTranslation(
      new Cesium.Cartesian3(
        layer.horizontalOffsetX,
        layer.verticalOffsetY,
        layer.horizontalOffsetZ
      )
    );
    tileset.modelMatrix = modelMatrix;
  }, [layer.horizontalOffsetX, layer.horizontalOffsetZ, layer.verticalOffsetY]);

  // Sync camera with MCAD viewport center
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !layer.visible) return;

    const cartesian = mcadToCesiumCartesian(viewport.center.x, viewport.center.z);
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);

    // MCAD zoom is px/block. At zoom=1, 1 MC block = 1px.
    // We want the camera at an altitude where ~512 blocks are visible.
    // Camera half-fov ≈ 30°, so altitude ≈ (visible_blocks/2) / tan(30°)
    // But MCAD zoom can be tiny (whole world) or huge (street level).
    const blocksVisible = 512 / Math.max(viewport.zoom, 1e-4);
    // Clamp to sensible altitude: 200m (close) to 100km (city-scale)
    const alt = Math.max(200, Math.min(100_000, blocksVisible));

    // If camera position is invalid (NaN), use BTE world center (Tokyo area)
    const lon = isNaN(cartographic.longitude) ? 139.6917 : Cesium.Math.toDegrees(cartographic.longitude);
    const lat = isNaN(cartographic.latitude) ? 35.6895 : Cesium.Math.toDegrees(cartographic.latitude);

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
    });
  }, [viewport.center.x, viewport.center.z, viewport.zoom, layer.visible]);

  // Update opacity via tileset style
  useEffect(() => {
    const tileset = tilesetRef.current;
    if (!tileset) return;
    try {
      tileset.style = new Cesium.Cesium3DTileStyle({
        color: `color("white", ${layer.opacity})`,
      });
    } catch { /* style may not be ready */ }
  }, [layer.opacity]);

  return (
    <>
      <div className="top-bar">
        <div className="segmented">
          <button onClick={onExit}>
            ← Back to 2D
          </button>
          <button disabled>
            {layer.name}
          </button>
        </div>
      </div>
      <div className="viewport-shell" style={{ background: "#111515" }}>
        <div
          ref={containerRef}
          className="cesium-viewer-container"
          style={{ width: "100%", height: "100%" }}
        />
        {tilesetError && (
          <div className="preview-3d-toolbar" style={{ top: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(60,30,30,0.9)", borderColor: "#aa4444", color: "#ffaaaa" }}>
            ⚠ {tilesetError}
          </div>
        )}
        <div className="preview-3d-toolbar">
          <button type="button" onClick={onExit} title="Back to 2D view">
            ← 2D
          </button>
          <span style={{ fontSize: 11, color: "#9fb0a7", marginLeft: 8 }}>
            {layer.name}
          </span>
        </div>
      </div>
    </>
  );
}
