/**
 * Import Modal — import GeoJSON / KML / KMZ files as MCAD Geometry.
 *
 * Flow:
 * 1. User selects file.
 * 2. User configures property defaults (blockType, baseY, etc.).
 * 3. System parses file and converts WGS-84 → MC via BTE projection.
 * 4. Geometries are added to the editor store.
 */

import { useMemo, useState } from "react";
import { Upload, X } from "lucide-react";
import { detectFileKind, importFileToGeometries, type ImportPropertyMapping } from "../core/geoImport";
import { useEditorStore, blockPalette } from "../store/editorStore";
import { geometryLayers } from "../core/layers";

type Props = {
  onClose: () => void;
};

export function ImportModal({ onClose }: Props) {
  const store = useEditorStore();
  const geomLayers = useMemo(() => geometryLayers(store.layers), [store.layers]);
  const [file, setFile] = useState<File | null>(null);
  const [blockType, setBlockType] = useState("gray_concrete");
  const [baseY, setBaseY] = useState(0);
  const [targetLayerId, setTargetLayerId] = useState<string>(geomLayers[0]?.id ?? "");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number } | null>(null);

  const fileKind = file ? detectFileKind(file.name) : null;

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const properties: ImportPropertyMapping = {
        blockType,
        baseY
      };
      const geometries = await importFileToGeometries(file, {
        properties,
        targetLayerId: targetLayerId || geomLayers[0]?.id || ""
      });
      if (geometries.length === 0) {
        setError("No valid geometries found in the file. Points and multi-points are skipped.");
        setImporting(false);
        return;
      }
      // Add all geometries to the store
      for (const geo of geometries) {
        if (geo.type === "circle") continue;
        store.commitGeometryWithVertices(geo.type, geo.vertices);
      }
      // Update properties for imported geometries (the store just created them)
      const state = useEditorStore.getState();
      const imported = state.geometries.slice(-geometries.length);
      for (let i = 0; i < imported.length; i++) {
        const geo = imported[i];
        const src = geometries[i];
        store.updateGeometry({
          ...geo,
          properties: { ...geo.properties, ...src.properties },
          layerId: src.layerId || geo.layerId
        });
      }
      setResult({ count: geometries.length });
      setImporting(false);
    } catch (err: any) {
      setError(err.message || "Failed to import file");
      setImporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Upload size={18} />
            Import GeoJSON / KML / KMZ
          </h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* File Selection */}
          <div className="modal-fields">
            <label className="layer-field">
              <span>File</span>
              <div className="file-input-row">
                <input
                  type="file"
                  accept=".geojson,.json,.kml,.kmz"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setResult(null);
                    setError(null);
                  }}
                />
                {file && (
                  <span className="file-name">
                    {file.name}
                    {fileKind && <span className="file-badge">{fileKind.toUpperCase()}</span>}
                  </span>
                )}
              </div>
            </label>

            <label className="layer-field">
              <span>Default block type</span>
              <select value={blockType} onChange={(e) => setBlockType(e.target.value)}>
                {blockPalette.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="layer-field">
              <span>Base Y</span>
              <input
                type="number"
                value={baseY}
                onChange={(e) => setBaseY(Number(e.target.value) || 0)}
              />
            </label>

            {geomLayers.length > 0 && (
              <label className="layer-field">
                <span>Target geometry layer</span>
                <select
                  value={targetLayerId}
                  onChange={(e) => setTargetLayerId(e.target.value)}
                >
                  {geomLayers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.name || "Unnamed layer"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {error && <p className="modal-error">{error}</p>}
          {result && (
            <p className="modal-success">
              Imported {result.count} geometry{result.count !== 1 ? "ies" : ""} successfully.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn primary-action"
            disabled={!file || importing}
            onClick={handleImport}
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
