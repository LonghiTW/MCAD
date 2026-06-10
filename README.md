# MCAD Minecraft Editor

MCAD is a web-based Minecraft world editor with geospatial projection overlays. Minecraft X/Z is the canonical coordinate space; WGS84 data and map tiles are projected into that space as references.

Inspired by [TerrasEdit](https://github.com/Codestian/TerrasEdit), but with a stricter architecture: the Minecraft voxel world is primary, while GIS data and map tiles are overlays.

## Stack

- React + TypeScript + Vite
- WebGL canvas renderer
- Zustand editor state
- Chunked Minecraft block storage
- [`bte-projection`](https://github.com/tf2mandeokyi/bte-projection) integration with a local fallback projection adapter
- Sponge `.schem` export path using gzipped NBT

## Core Model

The editor stores vector geometry as the source of truth:

```ts
interface Geometry {
  id: string
  type: "polyline" | "polygon"
  vertices: Vec2[]
  properties: {
    blockType: string
    width?: number
    height?: number
    priority?: number
  }
}
```

Rasterized blocks are derived data. Geometry changes clear and rebuild the affected chunk blocks.

## Implemented Systems

- Continuous Minecraft grass plane with block grid and chunk boundaries
- 16x16 chunk indexing, dirty chunk metadata, viewport chunk culling
- Polyline rasterization with Bresenham line cells and configurable width
- Polygon rasterization with scanline fill, hole support in the raster core, and height extrusion
- Editable vector drawing, selection, vertex dragging, snapping, undo/redo
- Block palette assignment
- Coordinate readout for Minecraft X/Z, chunk/local coordinates, and lat/lon
- XYZ/WMTS-style tile source model with reprojected WebGL overlay footprints and opacity controls
- Sponge schematic export with palette compression

## Run

Install Node.js 20+, then:

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, typically `http://localhost:5173`.

### Node PATH Notes

On Windows, ensure `node` is on your system PATH. If using nvm-windows or volta, restart your terminal after installation so the PATH takes effect:

```powershell
# Verify node version (should be >= 20)
node --version

# If node is not found, try restarting your terminal or:
refreshenv
```

On macOS / Linux, if you use nvm:

```bash
nvm use 20
node --version
```

### Smoke Tests

The project includes smoke tests that verify core algorithms without needing a browser:

```bash
# Run all smoke tests at once
npm run check:all

# Or run individually
npm run check:projection   # BTE projection round-trip
npm run check:raster       # Bresenham line, scanline fill, chunk assignment
npm run check:schematic    # Sponge schematic v3 NBT byte generation
```

All tests should print `All ... tests passed.` with zero failures.

### Build

```bash
npm run build    # tsc + vite build
npm run preview  # preview production build
```

## Notes

Tile sources are modeled as imagery-only overlays. The renderer currently projects tile footprints into Minecraft space and applies layer opacity; the next extension point is binding fetched tile images to the projected WebGL quads.

Schematic export is chunk-derived. Vector geometry remains editable and canonical inside the editor.

## Reference Goals From TerrasEdit

- Layered outlining workflow
- Lines, polygons, and future rectangle tools
- Tile sources for tracing/reference
- Block type and elevation-style properties
- Lat/lon jump navigation
- Schematic and future GeoJSON import/export
