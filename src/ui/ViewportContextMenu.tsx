import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { tryMinecraftToLatLon } from "../core/projection";
import type { Geometry, Vec2 } from "../core/types";
import { useEditorStore } from "../store/editorStore";

export interface ContextMenuItem {
  label: string;
  action: () => void;
  divider?: boolean;
  disabled?: boolean;
}

type ContextMenuState = {
  visible: boolean;
  x: number;
  y: number;
  worldPoint: Vec2;
  /** The geometry under the cursor, if any. */
  hoveredGeometry: Geometry | null;
  /** Edge info for "insert vertex between" — index of the edge segment. */
  edgeIndex: number | null;
};

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export function ViewportContextMenu({ onInsertVertex }: { onInsertVertex: (afterIndex: number, point: Vec2) => void }) {
  const [menu, setMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    worldPoint: { x: 0, z: 0 },
    hoveredGeometry: null,
    edgeIndex: null
  });
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!menu.visible) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [menu.visible, closeMenu]);

  // Close on Escape
  useEffect(() => {
    if (!menu.visible) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [menu.visible, closeMenu]);

  /** Call from the canvas onContextMenu to show the menu. */
  const showMenu = useCallback(
    (event: React.MouseEvent, worldPoint: Vec2, hoveredGeometry: Geometry | null, edgeIndex: number | null) => {
      event.preventDefault();
      setMenu({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        worldPoint,
        hoveredGeometry,
        edgeIndex
      });
    },
    []
  );

  // Expose showMenu globally so ViewportCanvas can call it
  useEffect(() => {
    (window as any).__mcadContextMenu = { show: showMenu };
    return () => {
      delete (window as any).__mcadContextMenu;
    };
  }, [showMenu]);

  if (!menu.visible) return null;

  const mc = menu.worldPoint;
  const latLon = tryMinecraftToLatLon(mc);
  const latStr = latLon ? latLon.lat.toFixed(6) : "N/A";
  const lonStr = latLon ? latLon.lon.toFixed(6) : "N/A";

  const items: ContextMenuItem[] = [];

  // ── Copy coordinates ────────────────────────────────────────────────
  items.push({
    label: `${mc.x.toFixed(0)} ${mc.z.toFixed(0)}`,
    action: () => copyToClipboard(`${mc.x.toFixed(0)} ${mc.z.toFixed(0)}`),
    disabled: false
  });
  items.push({
    label: `${latStr}, ${lonStr}`,
    action: () => copyToClipboard(`${latStr}, ${lonStr}`),
    disabled: !latLon
  });
  items.push({
    label: `/tpll ${latStr}, ${lonStr}`,
    action: () => copyToClipboard(`/tpll ${latStr}, ${lonStr}`),
    disabled: !latLon
  });
  items.push({
    label: `/tp @p ${mc.x.toFixed(0)} ~ ${mc.z.toFixed(0)}`,
    action: () => copyToClipboard(`/tp @p ${mc.x.toFixed(0)} ~ ${mc.z.toFixed(0)}`),
    disabled: false
  });

  // ── Geometry actions ────────────────────────────────────────────────
  if (menu.hoveredGeometry) {
    items.push({ label: "", action: () => {}, divider: true });
    const geo = menu.hoveredGeometry;
    const store = useEditorStore.getState();

    items.push({
      label: `Select geometry (${geo.id.slice(0, 8)})`,
      action: () => store.setSelectedGeometry(geo.id)
    });

    // Insert vertex on edge
    if (geo.type !== "circle" && menu.edgeIndex !== null) {
      items.push({
        label: "Insert vertex here",
        action: () => onInsertVertex(menu.edgeIndex!, menu.worldPoint)
      });
    }

    // Remove vertex if hovering near one
    if (geo.type !== "circle") {
      const storeState = useEditorStore.getState();
      const tolerance = Math.max(0.75, 8 / storeState.viewport.zoom);
      const nearVertex = geo.vertices.findIndex((v) => Math.hypot(v.x - mc.x, v.z - mc.z) <= tolerance);
      if (nearVertex >= 0 && geo.vertices.length > 2) {
        items.push({
          label: `Remove vertex ${nearVertex}`,
          action: () => store.removeVertexFromGeometry(geo.id, nearVertex)
        });
      }
    }

    items.push({
      label: "Delete geometry",
      action: () => store.deleteGeometry(geo.id)
    });
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="context-menu-divider" />
        ) : (
          <button
            key={i}
            type="button"
            className="context-menu-item"
            disabled={item.disabled}
            onClick={() => {
              item.action();
              closeMenu();
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}

/** Trigger the context menu from ViewportCanvas. */
export function triggerContextMenu(
  event: React.MouseEvent,
  worldPoint: Vec2,
  hoveredGeometry: Geometry | null,
  edgeIndex: number | null
) {
  (window as any).__mcadContextMenu?.show(event, worldPoint, hoveredGeometry, edgeIndex);
}
