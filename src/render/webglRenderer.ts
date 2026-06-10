import { CHUNK_SIZE } from "../core/chunks";
import { isGridVisible, isTileOverlayLayer, type McadLayer } from "../core/layers";
import { geometrySpatialIndex } from "../core/spatialIndex";
import type { BlockCell, ChunkData, ChunkID, Geometry, Vec2, ViewportState } from "../core/types";
import { colorForBlock } from "./blockColors";

type RenderInput = {
  viewport: ViewportState;
  chunks: Map<ChunkID, ChunkData>;
  geometries: Geometry[];
  draftVertices: Vec2[];
  closeDraftPreview?: boolean;
  circleDraftPreview?: { center: Vec2; radius: number } | null;
  selectedGeometryId: string | null;
  layers: McadLayer[];
};

type ProgramInfo = {
  program: WebGLProgram;
  position: number;
  color: number;
  resolution: WebGLUniformLocation;
};

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): ProgramInfo {
  const vertex = compile(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 a_position;
      attribute vec4 a_color;
      uniform vec2 u_resolution;
      varying vec4 v_color;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clip = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_color = a_color;
      }
    `
  );
  const fragment = compile(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying vec4 v_color;
      void main() {
        gl_FragColor = v_color;
      }
    `
  );
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
  }
  return {
    program,
    position: gl.getAttribLocation(program, "a_position"),
    color: gl.getAttribLocation(program, "a_color"),
    resolution: gl.getUniformLocation(program, "u_resolution")!
  };
}

export class MinecraftWebGLRenderer {
  private gl: WebGLRenderingContext;
  private info: ProgramInfo;
  private buffer: WebGLBuffer;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    this.info = createProgram(gl);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to create buffer");
    this.buffer = buffer;
  }

  resize() {
    const width = Math.floor(this.canvas.clientWidth);
    const height = Math.floor(this.canvas.clientHeight);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  render(input: RenderInput) {
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.06, 0.075, 0.075, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const vertices: number[] = [];
    const toScreen = (point: Vec2): Vec2 => ({
      x: (point.x - input.viewport.center.x) * input.viewport.zoom + this.canvas.width / 2,
      z: (point.z - input.viewport.center.z) * input.viewport.zoom + this.canvas.height / 2
    });

    this.addGrassPlane(vertices, input.viewport, toScreen);
    this.addChunks(vertices, input, toScreen);
    this.addGeometry(vertices, input, toScreen);
    if (isGridVisible(input.layers)) {
      this.addGrid(vertices, input.viewport, toScreen);
    }

    gl.useProgram(this.info.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.info.position);
    gl.vertexAttribPointer(this.info.position, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.info.color);
    gl.vertexAttribPointer(this.info.color, 4, gl.FLOAT, false, 24, 8);
    gl.uniform2f(this.info.resolution, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
  }

  private addQuad(vertices: number[], x: number, z: number, w: number, h: number, color: [number, number, number, number]) {
    const [r, g, b, a] = color;
    vertices.push(x, z, r, g, b, a, x + w, z, r, g, b, a, x, z + h, r, g, b, a);
    vertices.push(x + w, z, r, g, b, a, x + w, z + h, r, g, b, a, x, z + h, r, g, b, a);
  }

  private addLine(vertices: number[], a: Vec2, b: Vec2, width: number, color: [number, number, number, number]) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const ox = (-dz / length) * width * 0.5;
    const oz = (dx / length) * width * 0.5;
    const [r, g, bl, alpha] = color;
    vertices.push(a.x - ox, a.z - oz, r, g, bl, alpha, b.x - ox, b.z - oz, r, g, bl, alpha, a.x + ox, a.z + oz, r, g, bl, alpha);
    vertices.push(b.x - ox, b.z - oz, r, g, bl, alpha, b.x + ox, b.z + oz, r, g, bl, alpha, a.x + ox, a.z + oz, r, g, bl, alpha);
  }

  private addGrassPlane(vertices: number[], viewport: ViewportState, toScreen: (point: Vec2) => Vec2) {
    const min = toScreen({ x: viewport.center.x - viewport.width / viewport.zoom, z: viewport.center.z - viewport.height / viewport.zoom });
    this.addQuad(vertices, min.x, min.z, this.canvas.width * 2, this.canvas.height * 2, [0.08, 0.09, 0.09, 0.18]);
  }

  private addGrid(vertices: number[], viewport: ViewportState, toScreen: (point: Vec2) => Vec2) {
    if (viewport.zoom < 5) return;
    const blocksWide = this.canvas.width / viewport.zoom;
    const blocksHigh = this.canvas.height / viewport.zoom;
    const minX = Math.floor(viewport.center.x - blocksWide / 2);
    const maxX = Math.ceil(viewport.center.x + blocksWide / 2);
    const minZ = Math.floor(viewport.center.z - blocksHigh / 2);
    const maxZ = Math.ceil(viewport.center.z + blocksHigh / 2);
    for (let x = minX; x <= maxX; x += 1) {
      const s = toScreen({ x, z: minZ });
      const e = toScreen({ x, z: maxZ });
      const chunk = x % CHUNK_SIZE === 0;
      this.addLine(vertices, s, e, chunk ? 2 : 1, chunk ? [0.55, 0.75, 0.62, 0.42] : [0.55, 0.75, 0.62, 0.12]);
    }
    for (let z = minZ; z <= maxZ; z += 1) {
      const s = toScreen({ x: minX, z });
      const e = toScreen({ x: maxX, z });
      const chunk = z % CHUNK_SIZE === 0;
      this.addLine(vertices, s, e, chunk ? 2 : 1, chunk ? [0.55, 0.75, 0.62, 0.42] : [0.55, 0.75, 0.62, 0.12]);
    }
  }

  private addChunks(vertices: number[], input: RenderInput, toScreen: (point: Vec2) => Vec2) {
    const blocksWide = this.canvas.width / input.viewport.zoom;
    const blocksHigh = this.canvas.height / input.viewport.zoom;
    const minX = input.viewport.center.x - blocksWide / 2 - CHUNK_SIZE;
    const maxX = input.viewport.center.x + blocksWide / 2 + CHUNK_SIZE;
    const minZ = input.viewport.center.z - blocksHigh / 2 - CHUNK_SIZE;
    const maxZ = input.viewport.center.z + blocksHigh / 2 + CHUNK_SIZE;

    for (const chunk of input.chunks.values()) {
      const chunkMinX = chunk.cx * CHUNK_SIZE;
      const chunkMinZ = chunk.cz * CHUNK_SIZE;
      const chunkMaxX = chunkMinX + CHUNK_SIZE;
      const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
      if (chunkMaxX < minX || chunkMinX > maxX || chunkMaxZ < minZ || chunkMinZ > maxZ) continue;
      for (const block of chunk.blocks.values()) this.addBlock(vertices, block, input.viewport.zoom, toScreen);
    }
  }

  private addBlock(vertices: number[], block: BlockCell, zoom: number, toScreen: (point: Vec2) => Vec2) {
    const screen = toScreen({ x: block.x, z: block.z });
    const color = colorForBlock(block.blockType);
    this.addQuad(vertices, screen.x, screen.z, Math.max(1, zoom), Math.max(1, zoom), color);
  }

  private addGeometry(vertices: number[], input: RenderInput, toScreen: (point: Vec2) => Vec2) {
    const toCellCenter = (point: Vec2): Vec2 => ({
      x: Math.floor(point.x) + 0.5,
      z: Math.floor(point.z) + 0.5
    });
    const drawPath = (points: Vec2[], color: [number, number, number, number], closed: boolean, alignToCells = false) => {
      const centered = alignToCells ? points.map(toCellCenter) : points;
      for (let i = 0; i < centered.length - 1; i += 1) this.addLine(vertices, toScreen(centered[i]), toScreen(centered[i + 1]), 3, color);
      if (closed && centered.length > 2) this.addLine(vertices, toScreen(centered.at(-1)!), toScreen(centered[0]), 3, color);
      for (const point of centered) {
        const s = toScreen(point);
        this.addQuad(vertices, s.x - 4, s.z - 4, 8, 8, [0.9, 0.92, 0.76, 0.95]);
      }
    };
    const drawCircle = (center: Vec2, radius: number, color: [number, number, number, number]) => {
      const segments = Math.max(32, Math.min(128, Math.ceil(radius * 2)));
      let previous: Vec2 | null = null;
      for (let i = 0; i <= segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        const point = toScreen({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
        if (previous) this.addLine(vertices, previous, point, 3, color);
        previous = point;
      }
      const centerScreen = toScreen(center);
      this.addQuad(vertices, centerScreen.x - 4, centerScreen.z - 4, 8, 8, [0.9, 0.92, 0.76, 0.95]);
    };
    // Use spatial index for viewport culling — only iterate geometries with bounding boxes
    // that intersect the current viewport (plus margin for edges near the border)
    const visibleIds = new Set(
      geometrySpatialIndex.queryViewport(
        input.viewport.center.x, input.viewport.center.z,
        input.viewport.width, input.viewport.height,
        input.viewport.zoom
      )
    );
    // Always include the selected geometry even if offscreen
    if (input.selectedGeometryId) visibleIds.add(input.selectedGeometryId);

    for (const geometry of input.geometries) {
      if (!visibleIds.has(geometry.id)) continue;
      const selected = geometry.id === input.selectedGeometryId;
      const color: [number, number, number, number] = selected ? [1, 0.88, 0.32, 1] : [0.68, 0.85, 1, 0.72];
      if (geometry.type === "circle") {
        drawCircle(geometry.center, geometry.radius, color);
        continue;
      }
      drawPath(geometry.vertices, color, geometry.type === "polygon", true);
      if (geometry.type === "polygon") {
        for (const hole of geometry.holes ?? []) drawPath(hole, color, true, true);
      }
    }
    drawPath(input.draftVertices, [0.33, 0.95, 0.77, 1], Boolean(input.closeDraftPreview && input.draftVertices.length >= 3));
    if (input.circleDraftPreview && input.circleDraftPreview.radius > 0) {
      drawCircle(input.circleDraftPreview.center, input.circleDraftPreview.radius, [0.33, 0.95, 0.77, 1]);
    }
  }
}
