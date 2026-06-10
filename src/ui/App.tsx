import {
  Box,
  ChevronDown,
  ChevronRight,
  Diamond,
  Diameter,
  Download,
  Eraser,
  Eye,
  EyeOff,
  GripVertical,
  Hand,
  Key,
  Layers,
  Lock,
  Map,
  ImagePlus,
  MouseLeft,
  MousePointer2,
  MouseRight,
  Navigation,
  Pencil,
  Plus,
  Redo2,
  Route,
  Save,
  Trash2,
  Undo2,
  Upload
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isMinecraftBaseLayer, isSystemGridLayer, is3DTilesLayer, type ThreeDTilesReferenceLayer } from "../core/layers";
import { serializeProject, downloadProject, deserializeProject } from "../core/projectPersistence";
import { defaultBteViewportCenter, latLonToMinecraft, sampledBteWorldBounds } from "../core/projection";
import { exportSpongeSchematic } from "../core/schematic";
import { TILE_LIBRARY, type SourceNode } from "../core/tileSources";
import type { CoordinateReadout, ToolMode } from "../core/types";
import { fitBoundsZoom } from "../core/view";
import { allBlocks, blockPalette, useEditorStore } from "../store/editorStore";
import { ViewportCanvas } from "./ViewportCanvas";
import { Preview3D } from "./Preview3D";
import { CesiumViewer } from "./CesiumViewer";
import { ApiKeyDialog, getStoredApiKey } from "./ApiKeyDialog";
import { MoveToLocation } from "./MoveToLocation";
import { ImportModal } from "./ImportModal";
import { ExportModal } from "./ExportModal";

const tools: Array<{ id: ToolMode; label: string; icon: React.ComponentType<{ size?: number }>; rightClickTool?: ToolMode }> = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pan", label: "Pan", icon: Hand },
  { id: "polyline", label: "Line / Polygon", icon: Route, rightClickTool: "polygon" },
  { id: "circle", label: "Circle", icon: Diameter, rightClickTool: "circle" },
  { id: "erase", label: "Erase", icon: Eraser }
];

type CircleMode = "center-radius" | "three-point";

function NumberField({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function App() {
  const store = useEditorStore();
  const [coordinate, setCoordinate] = useState<CoordinateReadout>(() => ({
    minecraft: { x: 0, z: 0 },
    latLon: { lat: 0, lon: 0 },
    chunk: { cx: 0, cz: 0, localX: 0, localZ: 0 }
  }));
  const [layerName, setLayerName] = useState("");
  const [layerUrl, setLayerUrl] = useState("");
  const [layerId, setLayerId] = useState("");
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [circleMode, setCircleMode] = useState<CircleMode>("center-radius");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const [show3D, setShow3D] = useState(false);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [apiKeyDialogLayerId, setApiKeyDialogLayerId] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const selectedGeometry = store.geometries.find((geometry) => geometry.id === store.selectedGeometryId) ?? null;
  const blocks = useMemo(() => allBlocks(store.chunks), [store.chunks]);

  // Find the first visible 3D Tiles reference layer for rendering in viewport
  const visible3DTilesLayer = useMemo(
    () => store.layers.find((l) => l.type === "3d-tiles-reference" && l.visible) as ThreeDTilesReferenceLayer | undefined,
    [store.layers]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") store.undo();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") store.redo();
      if (event.key === "Escape") store.clearDraft();
      if (event.key === "Delete") store.deleteSelected();
      if (event.key === "Enter" && (store.tool === "polyline" || store.tool === "polygon")) store.commitGeometry(store.tool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);

  const exportSelection = () => {
    const schem = exportSpongeSchematic(blocks);
    const url = URL.createObjectURL(schem.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = schem.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // ── Project persistence ─────────────────────────────────────────────────
  const saveProject = useCallback(() => {
    const project = serializeProject({
      viewport: store.viewport,
      layers: store.layers,
      geometries: store.geometries,
      activeBlock: store.activeBlock,
      activeGeometryLayerId: store.activeGeometryLayerId
    });
    downloadProject(project);
  }, [store]);

  const importFileRef = useRef<HTMLInputElement>(null);

  const importProject = useCallback(() => {
    importFileRef.current?.click();
  }, []);

  const addReferenceImage = useCallback(() => {
    imageFileRef.current?.click();
  }, []);

  const add3DTilesLayer = useCallback(() => {
    const existingKey = getStoredApiKey();
    if (existingKey) {
      store.add3DTilesReferenceLayer({
        name: "Google 3D Tiles",
        apiKey: existingKey,
        provider: "google-photorealistic-3d-tiles",
      });
    } else {
      // Open API key dialog, layer creation deferred to onConfirm
      setApiKeyDialogLayerId("__new__");
      setIsApiKeyDialogOpen(true);
    }
  }, [store]);

  const handleApiKeyConfirm = useCallback((apiKey: string) => {
    setIsApiKeyDialogOpen(false);
    if (apiKeyDialogLayerId === "__new__") {
      store.add3DTilesReferenceLayer({
        name: "Google 3D Tiles",
        apiKey,
        provider: "google-photorealistic-3d-tiles",
      });
    } else if (apiKeyDialogLayerId) {
      store.update3DTilesReferenceLayer(apiKeyDialogLayerId, { apiKeyRef: apiKey });
    }
    setApiKeyDialogLayerId(null);
  }, [apiKeyDialogLayerId, store]);

  const handleReferenceImageFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      alert("Unsupported image type. Please choose PNG, JPEG, or WebP.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      const image = new Image();
      image.onload = () => {
        store.addReferenceImageLayer({
          name: `Image: ${file.name}`,
          dataUrl,
          width: image.naturalWidth || 1,
          height: image.naturalHeight || 1
        });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }, [store]);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") return;
      const result = deserializeProject(text);
      if (result.ok && result.project) {
        store.loadProject(result.project);
      } else {
        alert(`Failed to import project: ${result.error}`);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    event.target.value = "";
  }, [store]);

  // ── Keyboard shortcut: Ctrl+S to save project ──────────────────────────
  useEffect(() => {
    const onSaveKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveProject();
      }
    };
    window.addEventListener("keydown", onSaveKey);
    return () => window.removeEventListener("keydown", onSaveKey);
  }, [saveProject]);

  const jumpToLatLon = () => {
    const projected = latLonToMinecraft({ lat: 35.6895, lon: 139.6917 });
    store.setViewport({ center: projected, zoom: 18 });
  };

  const jumpToWorld = () => {
    store.setViewport({
      center: defaultBteViewportCenter(),
      zoom: fitBoundsZoom(Math.max(1, store.viewport.width), Math.max(1, store.viewport.height), sampledBteWorldBounds())
    });
  };

  // 遞迴渲染可摺疊的圖庫樹
  const renderLibraryTree = (nodes: SourceNode[], depth = 0, path: string[] = []) => {
    return (
      <div className="library-tree-level">
        {nodes.map((node) => {
          const fullPath = [...path, node.name].join("/");
          const isFolder = "children" in node;
          const isExpanded = expandedFolders.has(fullPath);

          if (isFolder) {
            return (
              <div key={fullPath} className="tree-group">
                <button
                  type="button"
                  className="tree-folder-trigger"
                  style={{ paddingLeft: `${depth * 12 + 8}px` }}
                  onClick={() => {
                    const next = new Set(expandedFolders);
                    if (next.has(fullPath)) next.delete(fullPath);
                    else next.add(fullPath);
                    setExpandedFolders(next);
                  }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{node.name}</span>
                </button>
                {isExpanded && renderLibraryTree(node.children, depth + 1, [...path, node.name])}
              </div>
            );
          }

          return (
            <button
              key={node.id}
              type="button"
              className={layerUrl === node.url ? "tree-item active" : "tree-item"}
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
              onClick={() => {
                setLayerName(node.name);
                setLayerUrl(node.url);
                setLayerId(node.id);
              }}
            >
              <span>{node.name}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const addLayer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!layerUrl.trim() || !layerName.trim()) return;

    const safeId = layerId || layerName.toLowerCase().replace(/[^\w-]/g, '_') + '_' + Date.now();

    store.addTileOverlayLayer(layerName, layerUrl, {
      id: safeId,
      opacity: 1.0
    });

    setLayerName("");
    setLayerUrl("");
    setLayerId("");
  };

  return (
    <>
    <main className="app-shell">
      <aside className="left-rail">
        <div className="brand">
          <Box size={22} />
          <span>MCAD</span>
        </div>
        <div className="tool-stack" aria-label="Tools">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                className={store.tool === tool.id || store.tool === tool.rightClickTool ? "icon-button active" : "icon-button"}
                onClick={() => {
                  if (tool.id === "circle") setCircleMode("center-radius");
                  store.setTool(tool.id);
                }}
                onContextMenu={(event) => {
                  if (!tool.rightClickTool) return;
                  event.preventDefault();
                  if (tool.id === "circle") {
                    setCircleMode("three-point");
                    store.setTool("circle");
                  } else {
                    store.setTool(tool.rightClickTool);
                  }
                }}
                title={tool.label}
              >
                <Icon size={19} />
                {tool.rightClickTool && (
                  <span className="tool-hover-label" role="tooltip">
                    {tool.id === "circle" ? (
                      <>
                        <span><MouseLeft size={13} /> Center + Radius</span>
                        <span><MouseRight size={13} /> 3 Point Circle</span>
                      </>
                    ) : (
                      <>
                        <span><MouseLeft size={13} /> Line</span>
                        <span><MouseRight size={13} /> Polygon</span>
                      </>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="tool-stack">
          <button className="icon-button" title="Undo" onClick={store.undo}>
            <Undo2 size={19} />
          </button>
          <button className="icon-button" title="Redo" onClick={store.redo}>
            <Redo2 size={19} />
          </button>
          <button className="icon-button danger" title="Delete selected" onClick={store.deleteSelected}>
            <Trash2 size={19} />
          </button>
        </div>
      </aside>

      <section className="center-stage">
      {show3D ? (
        <Preview3D onExit={() => setShow3D(false)} />
      ) : visible3DTilesLayer ? (
        <CesiumViewer layer={visible3DTilesLayer} onExit={() => store.toggleLayerVisibility(visible3DTilesLayer.id)} />
      ) : (
        <>
          <div className="top-bar">
            <div className="segmented">
              <button onClick={jumpToWorld}>
                <Map size={16} />
                World
              </button>
              <button onClick={jumpToLatLon}>
                <Map size={16} />
                Tokyo
              </button>
            </div>
            <button
              className={`icon-button ${show3D ? "active" : ""}`}
              title={show3D ? "Switch to 2D View" : "Switch to 3D View"}
              onClick={() => setShow3D(!show3D)}
            >
              <Box size={19} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Move to Location"
              onClick={() => setIsMoveDialogOpen(true)}
            >
              <Navigation size={16} />
            </button>
          </div>
          <ViewportCanvas onCoordinate={setCoordinate} circleMode={circleMode} />
        </>
      )}
      <div className="status-bar">
        <div className="readout">
          <span>MC X {coordinate.minecraft.x.toFixed(2)}</span>
          <span>Z {coordinate.minecraft.z.toFixed(2)}</span>
          <span>Lat {coordinate.latLon.lat.toFixed(6)}</span>
          <span>Lon {coordinate.latLon.lon.toFixed(6)}</span>
        </div>
        <span>Zoom {store.viewport.zoom >= 0.01 ? store.viewport.zoom.toFixed(2) : store.viewport.zoom.toExponential(2)} px/block</span>
      </div>
    </section>

      <aside className="right-panel">
        <section className="panel-section">
          <header>
            <Layers size={17} />
            <h2>Layers</h2>
          </header>
          <div className="layer-list">
            {store.layers.map((layer, index) => (
              <div
                key={layer.id}
                className={
                  expandedLayerId === layer.id
                    ? `layer-row ${layer.locked ? "locked" : ""} expanded`
                    : `layer-row ${layer.locked ? "locked" : ""}`
                }
              >
                <button
                  type="button"
                  className="layer-summary"
                  onClick={() => setExpandedLayerId(expandedLayerId === layer.id ? null : layer.id)}
                >
                  {layer.locked ? (
                    <Lock size={11} className="layer-grip" />
                  ) : (
                    <GripVertical size={12} className="layer-grip" />
                  )}
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => store.toggleLayerVisibility(layer.id)}
                  />
                  <span className="layer-name-text">{layer.name}</span>
                  {layer.type === "tile-overlay" && (
                    <strong>{Math.round(layer.opacity * 100)}%</strong>
                  )}
                  {layer.type === "reference-image" && (
                    <strong>{Math.round(layer.opacity * 100)}%</strong>
                  )}
                  {is3DTilesLayer(layer) && (
                    <span className="layer-offset-badge">3D</span>
                  )}
                  {layer.type === "geometry" && (
                    <span className="layer-offset-badge">Y+{layer.verticalOffsetY}</span>
                  )}
                  {isMinecraftBaseLayer(layer) && <strong>base</strong>}
                  {isSystemGridLayer(layer) && <strong>top</strong>}
                </button>

                {layer.type === "tile-overlay" && expandedLayerId === layer.id && (
                  <div className="layer-settings">
                    <div className="layer-opacity-slider">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={layer.opacity}
                        onChange={(event) => store.setLayerOpacity(layer.id, Number(event.target.value))}
                      />
                    </div>
                    <label className="layer-field">
                      <span>Name</span>
                      <input
                        value={layer.name}
                        onChange={(event) => store.renameLayer(layer.id, event.target.value)}
                      />
                    </label>
                    <label className="layer-field">
                      <span>URL</span>
                      <input
                        value={layer.urlTemplate}
                        onChange={(event) =>
                          store.updateTileOverlayLayer(layer.id, { urlTemplate: event.target.value })
                        }
                      />
                    </label>
                    <div className="offset-grid">
                      <label className="layer-field">
                        <span>Min zoom</span>
                        <input
                          type="number"
                          value={layer.minZoom}
                          onChange={(event) =>
                            store.updateTileOverlayLayer(layer.id, { minZoom: Number(event.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                    <div className="offset-grid">
                      <label className="layer-field">
                        <span>Offset X</span>
                        <input
                          type="number"
                          value={layer.offsetX}
                          onChange={(event) =>
                            store.updateTileOverlayLayer(layer.id, { offsetX: Number(event.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="layer-field">
                        <span>Offset Z</span>
                        <input
                          type="number"
                          value={layer.offsetZ}
                          onChange={(event) =>
                            store.updateTileOverlayLayer(layer.id, { offsetZ: Number(event.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                    <div className="layer-actions-row">
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index <= 1}
                        onClick={() => store.moveLayerUp(layer.id)}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index >= store.layers.length - 2}
                        onClick={() => store.moveLayerDown(layer.id)}
                        title="Move down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="delete-layer-button"
                        onClick={() => {
                          store.deleteLayer(layer.id);
                          setExpandedLayerId(null);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {layer.type === "geometry" && expandedLayerId === layer.id && (
                  <div className="layer-settings">
                    <label className="layer-field">
                      <span>Name</span>
                      <input
                        value={layer.name}
                        onChange={(event) => store.renameLayer(layer.id, event.target.value)}
                      />
                    </label>
                    <label className="layer-field">
                      <span>Vertical offset Y</span>
                      <input
                        type="number"
                        value={layer.verticalOffsetY}
                        onChange={(event) =>
                          store.setGeometryLayerVerticalOffset(layer.id, Number(event.target.value) || 0)
                        }
                      />
                    </label>
                    <div className="layer-actions-row">
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index <= 1}
                        onClick={() => store.moveLayerUp(layer.id)}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index >= store.layers.length - 2}
                        onClick={() => store.moveLayerDown(layer.id)}
                        title="Move down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="delete-layer-button"
                        onClick={() => {
                          store.deleteLayer(layer.id);
                          setExpandedLayerId(null);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {layer.type === "reference-image" && expandedLayerId === layer.id && (
                  <div className="layer-settings">
                    <div className="layer-opacity-slider">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={layer.opacity}
                        onChange={(event) => store.setLayerOpacity(layer.id, Number(event.target.value))}
                      />
                    </div>
                    <label className="layer-field">
                      <span>Name</span>
                      <input
                        value={layer.name}
                        onChange={(event) => store.renameLayer(layer.id, event.target.value)}
                      />
                    </label>
                    <div className="offset-grid">
                      <label className="layer-field">
                        <span>Center X</span>
                        <input
                          type="number"
                          value={layer.centerX}
                          onChange={(event) =>
                            store.updateReferenceImageLayer(layer.id, { centerX: Number(event.target.value) || 0 })
                          }
                        />
                      </label>
                      <label className="layer-field">
                        <span>Center Z</span>
                        <input
                          type="number"
                          value={layer.centerZ}
                          onChange={(event) =>
                            store.updateReferenceImageLayer(layer.id, { centerZ: Number(event.target.value) || 0 })
                          }
                        />
                      </label>
                    </div>
                    <div className="offset-grid">
                      <label className="layer-field">
                        <span>Width</span>
                        <input
                          type="number"
                          min="1"
                          value={layer.widthBlocks}
                          onChange={(event) => {
                            const newW = Math.max(1, Number(event.target.value) || 1);
                            if (layer.lockAspectRatio) {
                              const ratio = layer.heightBlocks / layer.widthBlocks;
                              store.updateReferenceImageLayer(layer.id, {
                                widthBlocks: newW,
                                heightBlocks: Math.max(1, Math.round(newW * ratio))
                              });
                            } else {
                              store.updateReferenceImageLayer(layer.id, { widthBlocks: newW });
                            }
                          }}
                        />
                      </label>
                      <label className="layer-field">
                        <span>Length</span>
                        <input
                          type="number"
                          min="1"
                          value={layer.heightBlocks}
                          onChange={(event) => {
                            const newH = Math.max(1, Number(event.target.value) || 1);
                            if (layer.lockAspectRatio) {
                              const ratio = layer.widthBlocks / layer.heightBlocks;
                              store.updateReferenceImageLayer(layer.id, {
                                heightBlocks: newH,
                                widthBlocks: Math.max(1, Math.round(newH * ratio))
                              });
                            } else {
                              store.updateReferenceImageLayer(layer.id, { heightBlocks: newH });
                            }
                          }}
                        />
                      </label>
                    </div>
                    <label className="layer-field checkbox-field">
                      <span>Lock aspect ratio</span>
                      <input
                        type="checkbox"
                        checked={layer.lockAspectRatio ?? true}
                        onChange={(event) =>
                          store.updateReferenceImageLayer(layer.id, { lockAspectRatio: event.target.checked })
                        }
                      />
                    </label>
                    <label className="layer-field">
                      <span>Rotation</span>
                      <input
                        type="number"
                        value={layer.rotationDeg}
                        onChange={(event) =>
                          store.updateReferenceImageLayer(layer.id, { rotationDeg: Number(event.target.value) || 0 })
                        }
                      />
                    </label>
                    <div className="layer-actions-row">
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index <= 1}
                        onClick={() => store.moveLayerUp(layer.id)}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index >= store.layers.length - 2}
                        onClick={() => store.moveLayerDown(layer.id)}
                        title="Move down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="delete-layer-button"
                        onClick={() => {
                          store.deleteLayer(layer.id);
                          setExpandedLayerId(null);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {is3DTilesLayer(layer) && expandedLayerId === layer.id && (
                  <div className="layer-settings">
                    <div className="layer-opacity-slider">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={layer.opacity}
                        onChange={(event) => store.setLayerOpacity(layer.id, Number(event.target.value))}
                      />
                    </div>
                    <label className="layer-field">
                      <span>Name</span>
                      <input
                        value={layer.name}
                        onChange={(event) => store.renameLayer(layer.id, event.target.value)}
                      />
                    </label>
                    <label className="layer-field">
                      <span>Provider</span>
                      <select
                        value={layer.provider}
                        onChange={(event) =>
                          store.update3DTilesReferenceLayer(layer.id, {
                            provider: event.target.value as any,
                          })
                        }
                      >
                        <option value="google-photorealistic-3d-tiles">Google Photorealistic 3D Tiles</option>
                        <option value="custom-3d-tiles">Custom 3D Tiles</option>
                      </select>
                    </label>
                    {layer.provider === "custom-3d-tiles" && (
                      <label className="layer-field">
                        <span>Root Tileset URL</span>
                        <input
                          value={layer.rootTilesetUrl}
                          placeholder="https://.../tileset.json"
                          onChange={(event) =>
                            store.update3DTilesReferenceLayer(layer.id, {
                              rootTilesetUrl: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    <label className="layer-field">
                      <span>API Key</span>
                      <div className="api-key-field-row">
                        <input
                          type="password"
                          value={layer.apiKeyRef ?? ""}
                          placeholder="Not set"
                          readOnly
                        />
                        <button
                          type="button"
                          className="layer-action-btn"
                          title="Update API key"
                          onClick={() => {
                            setApiKeyDialogLayerId(layer.id);
                            setIsApiKeyDialogOpen(true);
                          }}
                        >
                          <Key size={13} />
                        </button>
                      </div>
                    </label>
                    <div className="offset-grid">
                      <label className="layer-field">
                        <span>Offset X</span>
                        <input
                          type="number"
                          value={layer.horizontalOffsetX}
                          onChange={(event) =>
                            store.update3DTilesReferenceLayer(layer.id, {
                              horizontalOffsetX: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                      <label className="layer-field">
                        <span>Offset Z</span>
                        <input
                          type="number"
                          value={layer.horizontalOffsetZ}
                          onChange={(event) =>
                            store.update3DTilesReferenceLayer(layer.id, {
                              horizontalOffsetZ: Number(event.target.value) || 0,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="layer-field">
                      <span>Vertical Offset Y</span>
                      <input
                        type="number"
                        value={layer.verticalOffsetY}
                        onChange={(event) =>
                          store.update3DTilesReferenceLayer(layer.id, {
                            verticalOffsetY: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <div className="layer-actions-row">
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index <= 1}
                        onClick={() => store.moveLayerUp(layer.id)}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="layer-action-btn"
                        disabled={index >= store.layers.length - 2}
                        onClick={() => store.moveLayerDown(layer.id)}
                        title="Move down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="delete-layer-button"
                        onClick={() => {
                          store.deleteLayer(layer.id);
                          setExpandedLayerId(null);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <ApiKeyDialog
            open={isApiKeyDialogOpen}
            onClose={() => { setIsApiKeyDialogOpen(false); setApiKeyDialogLayerId(null); }}
            onConfirm={handleApiKeyConfirm}
            initialKey={getStoredApiKey()}
          />
          <div className="layer-add-buttons">
            <button
              type="button"
              className="add-layer-type-btn"
              onClick={() => store.addGeometryLayer("")}
            >
              <Plus size={14} />
              Geometry layer
            </button>
            <button
              type="button"
              className="add-layer-type-btn"
              onClick={addReferenceImage}
            >
              <ImagePlus size={14} />
              Image layer
            </button>
            <button
              type="button"
              className="add-layer-type-btn"
              onClick={add3DTilesLayer}
            >
              <Diamond size={14} />
              3D Tiles layer
            </button>
            <input
              ref={imageFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={handleReferenceImageFile}
            />
          </div>
          <form className="add-layer-form" onSubmit={addLayer}>
            <div className="library-picker">
              <button
                type="button"
                className="library-toggle"
                onClick={() => setIsLibraryOpen(!isLibraryOpen)}
              >
                <Map size={14} />
                {isLibraryOpen ? "Hide Library" : "Browse Preset Library"}
              </button>
              {isLibraryOpen && (
                <div className="library-dropdown">
                  {renderLibraryTree(TILE_LIBRARY)}
                </div>
              )}
            </div>
            <input value={layerName} onChange={(event) => setLayerName(event.target.value)} placeholder="Layer name" />
            <input
              value={layerUrl}
              onChange={(event) => {
                setLayerUrl(event.target.value);
                setLayerId("");
              }}
              placeholder="https://.../{z}/{x}/{y}.png"
            />
            <button type="submit">
              <Plus size={15} />
              Add tile layer
            </button>
          </form>
        </section>

        <section className="panel-section">
          <header>
            <Save size={17} />
            <h2>Geometry</h2>
          </header>
          <div className="stats-grid">
            <NumberField label="Vectors" value={String(store.geometries.length)} />
            <NumberField label="Blocks" value={blocks.length.toLocaleString()} />
            <NumberField label="Chunks" value={String(store.chunks.size)} />
            <NumberField label="Draft" value={String(store.draftVertices.length)} />
          </div>
          {selectedGeometry ? (
            <div className="properties">
              <span className="property-id">{selectedGeometry.id.slice(0, 8)}</span>
              <strong>{selectedGeometry.type}</strong>
              <span>{selectedGeometry.type === "circle" ? `radius ${selectedGeometry.radius.toFixed(2)}` : `${selectedGeometry.vertices.length} vertices`}</span>
              <label className="layer-field">
                <span>Block type</span>
                <select
                  value={selectedGeometry.properties.blockType}
                  onChange={(event) =>
                    store.updateGeometry({
                      ...selectedGeometry,
                      properties: { ...selectedGeometry.properties, blockType: event.target.value }
                    })
                  }
                >
                  {blockPalette.map((block) => (
                    <option key={block.id} value={block.id}>{block.label}</option>
                  ))}
                </select>
              </label>
              {selectedGeometry.type === "polyline" && (
                <label className="layer-field">
                  <span>Width</span>
                  <input
                    type="number"
                    min="1"
                    value={selectedGeometry.properties.width ?? 1}
                    onChange={(event) => {
                      const val = Math.max(1, Number(event.target.value) || 1);
                      store.updateGeometry({
                        ...selectedGeometry,
                        properties: { ...selectedGeometry.properties, width: val }
                      });
                    }}
                  />
                </label>
              )}
              {selectedGeometry.type === "polygon" && (
                <p className="muted" style={{ margin: 0 }}>
                  Outline at Y={Math.round((selectedGeometry.properties.baseY ?? 0) + (selectedGeometry.layerId ? (store.layers.find((l) => l.id === selectedGeometry.layerId && l.type === "geometry") as any)?.verticalOffsetY ?? 0 : 0))}
                </p>
              )}
              {(selectedGeometry.type === "polygon" || selectedGeometry.type === "circle") && (
                <>
                  <label className="layer-field">
                    <span>Boundary</span>
                    <select
                      value={selectedGeometry.properties.boundaryMode ?? "center"}
                      onChange={(event) =>
                        store.updateGeometry({
                          ...selectedGeometry,
                          properties: {
                            ...selectedGeometry.properties,
                            boundaryMode: event.target.value as "center" | "outer" | "inner"
                          }
                        })
                      }
                    >
                      <option value="center">Line = blocks</option>
                      <option value="outer">Outer line (blocks inside)</option>
                      <option value="inner">Inner line (blocks outside)</option>
                    </select>
                  </label>
                  <label className="layer-field checkbox-field">
                    <span>Solid</span>
                    <input
                      type="checkbox"
                      checked={selectedGeometry.properties.solid ?? false}
                      onChange={(event) =>
                        store.updateGeometry({
                          ...selectedGeometry,
                          properties: { ...selectedGeometry.properties, solid: event.target.checked }
                        })
                      }
                    />
                  </label>
                  <label className="layer-field">
                    <span>Thickness</span>
                    <input
                      type="number"
                      min="1"
                      value={selectedGeometry.properties.closedShapeThickness ?? 1}
                      onChange={(event) =>
                        store.updateGeometry({
                          ...selectedGeometry,
                          properties: {
                            ...selectedGeometry.properties,
                            closedShapeThickness: Math.max(1, Number(event.target.value) || 1)
                          }
                        })
                      }
                    />
                  </label>
                </>
              )}
              {selectedGeometry.type === "circle" && (
                <>
                  <label className="layer-field">
                    <span>Center X</span>
                    <input
                      type="number"
                      value={selectedGeometry.center.x}
                      onChange={(event) =>
                        store.updateGeometry({
                          ...selectedGeometry,
                          center: { ...selectedGeometry.center, x: Number(event.target.value) || 0 }
                        })
                      }
                    />
                  </label>
                  <label className="layer-field">
                    <span>Center Z</span>
                    <input
                      type="number"
                      value={selectedGeometry.center.z}
                      onChange={(event) =>
                        store.updateGeometry({
                          ...selectedGeometry,
                          center: { ...selectedGeometry.center, z: Number(event.target.value) || 0 }
                        })
                      }
                    />
                  </label>
                  <label className="layer-field">
                    <span>Radius</span>
                    <input
                      type="number"
                      min="1"
                      value={selectedGeometry.radius}
                      onChange={(event) =>
                        store.updateGeometry({
                          ...selectedGeometry,
                          radius: Math.max(1, Number(event.target.value) || 1)
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label className="layer-field">
                <span>Base Y</span>
                <input
                  type="number"
                  value={selectedGeometry.properties.baseY ?? 0}
                  onChange={(event) =>
                    store.updateGeometry({
                      ...selectedGeometry,
                      properties: { ...selectedGeometry.properties, baseY: Number(event.target.value) || 0 }
                    })
                  }
                />
              </label>
              {selectedGeometry.type === "polyline" && (
                <label className="layer-field">
                  <span>Stack height</span>
                  <input
                    type="number"
                    min="1"
                    value={selectedGeometry.properties.lineStackHeight ?? 1}
                    onChange={(event) =>
                      store.updateGeometry({
                        ...selectedGeometry,
                        properties: {
                          ...selectedGeometry.properties,
                          lineStackHeight: Math.max(1, Number(event.target.value) || 1)
                        }
                      })
                    }
                  />
                </label>
              )}
              <label className="layer-field">
                <span>Priority</span>
                <input
                  type="number"
                  value={selectedGeometry.properties.priority ?? 0}
                  onChange={(event) =>
                    store.updateGeometry({
                      ...selectedGeometry,
                      properties: { ...selectedGeometry.properties, priority: Number(event.target.value) || 0 }
                    })
                  }
                />
              </label>
              <div className="layer-actions-row">
                <button
                  type="button"
                  className="layer-action-btn"
                  title="Delete selected geometry"
                  onClick={() => store.deleteSelected()}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">Draw in Minecraft space. Double-click or press Enter to rasterize.</p>
          )}
        </section>

        <section className="panel-section">
          <header>
            <Pencil size={17} />
            <h2>Block Palette</h2>
          </header>
          <div className="palette">
            {blockPalette.map((block) => (
              <button
                key={block.id}
                className={store.activeBlock === block.id ? "swatch selected" : "swatch"}
                onClick={() => store.setActiveBlock(block.id)}
                title={block.id}
              >
                <span style={{ background: block.color }} />
                {block.label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <header>
            <Download size={17} />
            <h2>Export</h2>
          </header>
          <div className="export-buttons">
            <button className="primary-action" onClick={saveProject}>
              <Save size={16} />
              Save project
            </button>
            <button className="primary-action" onClick={importProject}>
              <Upload size={16} />
              Import project
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".mcad.json,.json"
              style={{ display: "none" }}
              onChange={handleImportFile}
            />
            <button className="primary-action" onClick={() => setIsImportOpen(true)}>
              <Upload size={16} />
              Import GeoJSON/KML
            </button>
            <button className="primary-action" onClick={() => setIsExportOpen(true)}>
              <Download size={16} />
              Export GeoJSON/KML
            </button>
            <button className="primary-action" onClick={exportSelection}>
              <Download size={16} />
              Export .schem
            </button>
          </div>
          <p className="muted">Save/load entire project (.mcad.json), import/export GeoJSON/KML, or export derived blocks as Sponge schematic.</p>
        </section>
      </aside>
    </main>
    {isMoveDialogOpen && <MoveToLocation onClose={() => setIsMoveDialogOpen(false)} />}
    {isImportOpen && <ImportModal onClose={() => setIsImportOpen(false)} />}
    {isExportOpen && <ExportModal onClose={() => setIsExportOpen(false)} />}
    </>
  );
}
