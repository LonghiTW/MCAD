import { useState } from "react";
import { X } from "lucide-react";
import { latLonToMinecraft } from "../core/projection";
import { useEditorStore } from "../store/editorStore";

type Props = {
  onClose: () => void;
};

function parsePair(input: string): [number, number] | null {
  const parts = input.split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = parseFloat(parts[0]);
  const b = parseFloat(parts[1]);
  if (isNaN(a) || isNaN(b)) return null;
  return [a, b];
}

export function MoveToLocation({ onClose }: Props) {
  const [mode, setMode] = useState<"latlon" | "mcxz">("latlon");
  const [coordInput, setCoordInput] = useState("");

  const goTo = () => {
    const store = useEditorStore.getState();
    const pair = parsePair(coordInput);
    if (!pair) return;
    if (mode === "latlon") {
      const [latVal, lonVal] = pair;
      const mc = latLonToMinecraft({ lat: latVal, lon: lonVal });
      store.setViewport({ center: mc, zoom: 18 });
    } else {
      const [xVal, zVal] = pair;
      store.setViewport({ center: { x: xVal, z: zVal }, zoom: 18 });
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Move to Location</h3>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="modal-tabs">
            <button
              type="button"
              className={mode === "latlon" ? "modal-tab active" : "modal-tab"}
              onClick={() => { setMode("latlon"); setCoordInput(""); }}
            >
              Lat / Lon
            </button>
            <button
              type="button"
              className={mode === "mcxz" ? "modal-tab active" : "modal-tab"}
              onClick={() => { setMode("mcxz"); setCoordInput(""); }}
            >
              MC X / Z
            </button>
          </div>
          {mode === "latlon" ? (
            <div className="modal-fields">
              <label className="layer-field">
                <span>Lat, Lon</span>
                <input
                  type="text"
                  placeholder="25.149363, 121.460042"
                  value={coordInput}
                  onChange={(e) => setCoordInput(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className="modal-fields">
              <label className="layer-field">
                <span>MC X, Z</span>
                <input
                  type="text"
                  placeholder="1000, -2000"
                  value={coordInput}
                  onChange={(e) => setCoordInput(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="modal-btn cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="modal-btn confirm" onClick={goTo}>
            Go
          </button>
        </footer>
      </div>
    </div>
  );
}
