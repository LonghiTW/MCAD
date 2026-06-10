/**
 * Export Modal — export MCAD Geometry as GeoJSON / KML.
 *
 * Options:
 * - Export format: GeoJSON or KML
 * - Scope: all geometries or selected geometry only
 */

import { useState } from "react";
import { Download, X } from "lucide-react";
import { downloadGeoJson, downloadKml } from "../core/geoExport";
import { useEditorStore } from "../store/editorStore";

type Props = {
  onClose: () => void;
};

export function ExportModal({ onClose }: Props) {
  const store = useEditorStore();
  const [format, setFormat] = useState<"geojson" | "kml">("geojson");
  const [scope, setScope] = useState<"all" | "selected">("all");

  const geometries =
    scope === "selected" && store.selectedGeometryId
      ? store.geometries.filter((g) => g.id === store.selectedGeometryId)
      : store.geometries;

  const handleExport = () => {
    if (geometries.length === 0) {
      alert("No geometries to export.");
      return;
    }
    if (format === "geojson") {
      downloadGeoJson(geometries);
    } else {
      downloadKml(geometries);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Download size={18} />
            Export Geometry
          </h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-fields">
            <label className="layer-field">
              <span>Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as "geojson" | "kml")}>
                <option value="geojson">GeoJSON (.geojson)</option>
                <option value="kml">KML (.kml)</option>
              </select>
            </label>

            <label className="layer-field">
              <span>Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "selected")}>
                <option value="all">
                  All geometries ({store.geometries.length})
                </option>
                <option
                  value="selected"
                  disabled={!store.selectedGeometryId}
                >
                  Selected geometry{store.selectedGeometryId ? ` (${store.geometries.filter((g) => g.id === store.selectedGeometryId).length})` : " (none selected)"}
                </option>
              </select>
            </label>
          </div>

          <p className="muted">
            Coordinates will be converted from Minecraft X/Z back to WGS-84 lat/lon via the BTE projection.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="modal-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn primary-action"
            disabled={geometries.length === 0}
            onClick={handleExport}
          >
            Export {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
