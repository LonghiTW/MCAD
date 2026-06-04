import {
  Box,
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  Eraser,
  Hand,
  Layers,
  Map,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Route,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { defaultBteViewportCenter, latLonToMinecraft, sampledBteWorldBounds } from "../core/projection";
import { exportSpongeSchematic } from "../core/schematic";
import { TILE_LIBRARY, type SourceNode } from "../core/tileSources";
import type { CoordinateReadout, ToolMode } from "../core/types";
import { fitBoundsZoom } from "../core/view";
import { allBlocks, blockPalette, useEditorStore } from "../store/editorStore";
import { ViewportCanvas } from "./ViewportCanvas";

const tools: Array<{ id: ToolMode; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "pan", label: "Pan", icon: Hand },
  { id: "polyline", label: "Road", icon: Route },
  { id: "polygon", label: "Area", icon: Building2 },
  { id: "erase", label: "Erase", icon: Eraser }
];

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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null);
  const selectedGeometry = store.geometries.find((geometry) => geometry.id === store.selectedGeometryId) ?? null;
  const blocks = useMemo(() => allBlocks(store.chunks), [store.chunks]);

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

    store.addTileSource(layerName, layerUrl, {
      id: safeId,
      opacity: 1.0
    });

    setLayerName("");
    setLayerUrl("");
    setLayerId("");
  };

  return (
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
                className={store.tool === tool.id ? "icon-button active" : "icon-button"}
                onClick={() => store.setTool(tool.id)}
                title={tool.label}
              >
                <Icon size={19} />
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
      </div>
      <ViewportCanvas onCoordinate={setCoordinate} />
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
          <div className="layer-row locked">
            <input
              type="checkbox"
              checked={store.gridVisible}
              onChange={() => store.setGridVisible(!store.gridVisible)}
            />
            <span>Block and chunk grid</span>
            <strong>top</strong>
          </div>
          <div className="layer-row locked">
            <span>Minecraft grass plane</span>
            <strong>base</strong>
          </div>
          {store.tileSources.map((source) => (
            <div className={expandedLayerId === source.id ? "tile-layer expanded" : "tile-layer"} key={source.id}>
              <button
                type="button"
                className="layer-summary"
                onClick={() => setExpandedLayerId(expandedLayerId === source.id ? null : source.id)}
              >
                <input
                  type="checkbox"
                  checked={source.visible}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => store.toggleTiles(source.id)}
                />
                <span>{source.name}</span>
                <strong>{Math.round(source.opacity * 100)}%</strong>
              </button>
              <div className="layer-opacity-slider">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={source.opacity}
                  onChange={(event) => store.setTileOpacity(source.id, Number(event.target.value))}
                />
              </div>
              {expandedLayerId === source.id ? (
                <div className="layer-settings">
                  <label className="layer-field">
                    <span>Name</span>
                    <input value={source.name} onChange={(event) => store.updateTileSource(source.id, { name: event.target.value })} />
                  </label>
                  <label className="layer-field">
                    <span>URL</span>
                    <input value={source.urlTemplate} onChange={(event) => store.updateTileSource(source.id, { urlTemplate: event.target.value })} />
                  </label>
                  <div className="offset-grid">
                    <label className="layer-field">
                      <span>Min zoom</span>
                      <input
                        type="number"
                        value={source.minZoom}
                        onChange={(event) => store.updateTileSource(source.id, { minZoom: Number(event.target.value) || 0 })}
                      />
                    </label>
                  </div>
                  <div className="offset-grid">
                    <label className="layer-field">
                      <span>Offset X</span>
                      <input
                        type="number"
                        value={source.offsetX ?? 0}
                        onChange={(event) => store.updateTileSource(source.id, { offsetX: Number(event.target.value) || 0 })}
                      />
                    </label>
                    <label className="layer-field">
                      <span>Offset Z</span>
                      <input
                        type="number"
                        value={source.offsetZ ?? 0}
                        onChange={(event) => store.updateTileSource(source.id, { offsetZ: Number(event.target.value) || 0 })}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="delete-layer-button"
                    onClick={() => {
                      store.deleteTileSource(source.id);
                      setExpandedLayerId(null);
                    }}
                  >
                    <Trash2 size={14} />
                    Delete layer
                  </button>
                </div>
              ) : null}
            </div>
          ))}
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
              Add layer
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
              <span>{selectedGeometry.vertices.length} vertices</span>
              <span>{selectedGeometry.properties.blockType}</span>
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
          <p className="muted">Exports derived chunk blocks with palette compression. Vector geometry remains the editable source.</p>
          <button className="primary-action" onClick={exportSelection}>
            <Download size={16} />
            Export .schem
          </button>
        </section>
      </aside>
    </main>
  );
}
