/**
 * ApiKeyDialog.tsx — Modal dialog for entering a Google Maps / 3D Tiles API key.
 *
 * Stores the key in localStorage (not in project files).
 */
import { useCallback, useState } from "react";
import { Key, AlertTriangle, ExternalLink } from "lucide-react";

const API_KEY_STORAGE_KEY = "mcad-google-api-key";

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeApiKey(key: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  } catch { /* ignore */ }
}

type ApiKeyDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (apiKey: string) => void;
  initialKey?: string;
};

export function ApiKeyDialog({ open, onClose, onConfirm, initialKey = "" }: ApiKeyDialogProps) {
  const [key, setKey] = useState(initialKey);

  const handleConfirm = useCallback(() => {
    const trimmed = key.trim();
    if (!trimmed) return;
    storeApiKey(trimmed);
    onConfirm(trimmed);
  }, [key, onConfirm]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog api-key-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <Key size={16} />
          <h3>Google 3D Tiles API Key</h3>
        </header>

        <div className="modal-body">
          <p className="api-key-info">
            Enter your Google Maps Platform API key to enable Photorealistic 3D Tiles.
          </p>

          <div className="api-key-requirements">
            <p><strong>Required setup:</strong></p>
            <ul>
              <li>Create a <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud project</a></li>
              <li>Enable <strong>Map Tiles API</strong></li>
              <li>Set up billing</li>
              <li>Create an API key</li>
            </ul>
            <a href="https://developers.google.com/maps/documentation/tile/get-api-key" target="_blank" rel="noreferrer" className="api-key-docs-link">
              <ExternalLink size={12} />
              API Key documentation
            </a>
          </div>

          <div className="api-key-warning">
            <AlertTriangle size={14} />
            <span>API key is stored locally in your browser. It is <strong>never</strong> saved in project files.</span>
          </div>

          <input
            type="text"
            className="api-key-input"
            placeholder="AIzaSy..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            autoFocus
          />
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!key.trim()}
            onClick={handleConfirm}
          >
            Connect
          </button>
        </footer>
      </div>
    </div>
  );
}
