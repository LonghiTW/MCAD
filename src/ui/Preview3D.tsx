/**
 * Preview3D.tsx — Three.js 3D Minecraft preview panel.
 *
 * Renders an InstancedMesh per blockType from ChunkData.
 * Provides orbit controls, camera sync with 2D viewport, vertical exaggeration,
 * and selected geometry highlight.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EyeOff, RotateCcw, Maximize2 } from "lucide-react";
import type { ChunkData, ChunkID } from "../core/types";
import { colorForBlock } from "../render/blockColors";
import { useEditorStore } from "../store/editorStore";

type Preview3DProps = {
  /** Switch back to 2D view. */
  onExit: () => void;
};

/**
 * Build instanced meshes from the chunk map.
 * Returns a group containing one InstancedMesh per blockType.
 */
function buildChunkMeshes(
  chunks: Map<ChunkID, ChunkData>,
  yScale: number,
  highlightGeoId: string | null,
): { group: THREE.Group; totalBlocks: number; bounds: THREE.Box3 } {
  // First pass: count blocks per type and build matrices
  type BlockEntry = {
    blockType: string;
    color: THREE.Color;
    opacity: number;
    matrices: THREE.Matrix4[];
  };

  const byType = new Map<string, BlockEntry>();
  let totalBlocks = 0;
  const bounds = new THREE.Box3();

  const _mat = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3(1, 1, 1);

  for (const chunk of chunks.values()) {
    for (const block of chunk.blocks.values()) {
      // In highlight mode, skip blocks not from the selected geometry
      if (highlightGeoId && block.sourceGeometryId !== highlightGeoId) {
        // Still add them but at very low opacity (ghost mode)
        const key = block.blockType + "__ghost";
        let entry = byType.get(key);
        if (!entry) {
          const rgba = colorForBlock(block.blockType);
          entry = {
            blockType: block.blockType,
            color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
            opacity: 0.12,
            matrices: [],
          };
          byType.set(key, entry);
        }
        _pos.set(block.x + 0.5, block.y * yScale + 0.5, block.z + 0.5);
        _mat.compose(_pos, _quat, _scale);
        entry.matrices.push(_mat.clone());
        bounds.expandByPoint(_pos);
        totalBlocks++;
        continue;
      }

      const key = block.blockType;
      let entry = byType.get(key);
      if (!entry) {
        const rgba = colorForBlock(block.blockType);
        entry = {
          blockType: block.blockType,
          color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
          opacity: rgba[3],
          matrices: [],
        };
        byType.set(key, entry);
      }

      _pos.set(block.x + 0.5, block.y * yScale + 0.5, block.z + 0.5);
      _mat.compose(_pos, _quat, _scale);
      entry.matrices.push(_mat.clone());
      bounds.expandByPoint(_pos);
      totalBlocks++;
    }
  }

  const group = new THREE.Group();
  group.name = "chunk-blocks";

  for (const entry of byType.values()) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({
      color: entry.color,
      transparent: entry.opacity < 1 || entry.matrices.some(() => false),
      opacity: entry.opacity,
      // For ghost blocks, use low opacity
    });

    // Check if this is a ghost entry (ends with __ghost)
    const isGhost = entry.matrices.length > 0 && entry.opacity < 0.2;
    if (isGhost) {
      mat.opacity = entry.opacity;
      mat.transparent = true;
      mat.depthWrite = false;
    }

    const mesh = new THREE.InstancedMesh(geo, mat, entry.matrices.length);
    mesh.name = `blocks-${entry.blockType}`;

    for (let i = 0; i < entry.matrices.length; i++) {
      mesh.setMatrixAt(i, entry.matrices[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  return { group, totalBlocks, bounds };
}

/**
 * Create a semi-transparent ground plane centered on the bounds.
 */
function createGroundPlane(bounds: THREE.Box3): THREE.Mesh {
  const center = new THREE.Vector3();
  bounds.getCenter(center);

  const size = new THREE.Vector3();
  bounds.getSize(size);
  const span = Math.max(size.x, size.z, 32) * 1.5;

  const geo = new THREE.PlaneGeometry(span, span);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1a2a1a,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(center.x, -0.01, center.z);
  mesh.name = "ground-plane";
  return mesh;
}

/**
 * Create coordinate axis helper lines (X=red, Z=blue, Y=green).
 */
function createAxes(bounds: THREE.Box3): THREE.Group {
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const len = Math.max(size.x, size.z, size.y) * 0.6;

  const group = new THREE.Group();
  group.name = "axes";

  // X axis (red)
  const xGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-len, 0.01, 0),
    new THREE.Vector3(len, 0.01, 0),
  ]);
  group.add(new THREE.Line(xGeo, new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.5 })));

  // Z axis (blue)
  const zGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.01, -len),
    new THREE.Vector3(0, 0.01, len),
  ]);
  group.add(new THREE.Line(zGeo, new THREE.LineBasicMaterial({ color: 0x4444ff, transparent: true, opacity: 0.5 })));

  // Y axis (green, vertical)
  const yGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, len * 2, 0),
  ]);
  group.add(new THREE.Line(yGeo, new THREE.LineBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.5 })));

  group.position.set(center.x, 0, center.z);
  return group;
}

export function Preview3D({ onExit }: Preview3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const blocksGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);
  const [yScale, setYScale] = useState(1);
  const [showAxes, setShowAxes] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [blockCount, setBlockCount] = useState(0);

  // Read store values
  const chunks = useEditorStore((s) => s.chunks);
  const viewport = useEditorStore((s) => s.viewport);
  const selectedGeometryId = useEditorStore((s) => s.selectedGeometryId);

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x111515, 1);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111515);
    scene.fog = new THREE.FogExp2(0x111515, 0.003);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 2000);
    // Position camera based on 2D viewport center
    const cx = viewport.center.x;
    const cz = viewport.center.z;
    // Initial distance based on zoom (inverse relationship: higher zoom = closer)
    const dist = Math.max(60, 200 / Math.max(viewport.zoom, 0.01));
    camera.position.set(cx + dist * 0.6, dist * 0.5, cz + dist * 0.6);
    camera.lookAt(cx, 0, cz);
    cameraRef.current = camera;

    // Controls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.target.set(cx, 0, cz);
    controls.minDistance = 5;
    controls.maxDistance = 2000;
    controls.maxPolarAngle = Math.PI * 0.48; // Slightly above horizontal
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 30);
    dirLight.castShadow = false;
    scene.add(dirLight);

    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362907, 0.4);
    scene.add(hemiLight);

    // Resize handler
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    // Animation loop
    let running = true;
    const animate = () => {
      if (!running) return;
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.clear();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount once

  // Sync camera target with 2D viewport center
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    const controls = controlsRef.current;
    controls.target.set(viewport.center.x, 0, viewport.center.z);
  }, [viewport.center.x, viewport.center.z]);

  // Rebuild meshes when chunks, yScale, or highlight changes
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    // Remove old blocks
    const old = scene.getObjectByName("chunk-blocks") as THREE.Group | undefined;
    if (old) {
      old.traverse((child) => {
        if (child instanceof THREE.InstancedMesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      scene.remove(old);
    }

    // Remove old ground & axes
    const oldGround = scene.getObjectByName("ground-plane");
    if (oldGround) scene.remove(oldGround);
    const oldAxes = scene.getObjectByName("axes");
    if (oldAxes) scene.remove(oldAxes);

    if (chunks.size === 0) return;

    // Build new meshes
    const { group, totalBlocks, bounds } = buildChunkMeshes(chunks, yScale, selectedGeometryId);
    scene.add(group);
    blocksGroupRef.current = group;
    setBlockCount(totalBlocks);

    // Ground plane
    if (showGround) {
      const ground = createGroundPlane(bounds);
      scene.add(ground);
    }

    // Axes
    if (showAxes) {
      const axes = createAxes(bounds);
      scene.add(axes);
    }
  }, [chunks, yScale, selectedGeometryId, showGround, showAxes]);

  // Fit camera to bounds when chunks change significantly
  const fitCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || chunks.size === 0) return;

    const { bounds } = buildChunkMeshes(chunks, yScale, selectedGeometryId);
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    const size = new THREE.Vector3();
    bounds.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let dist = maxDim / (2 * Math.tan(fov / 2));
    dist *= 1.3; // Add some padding

    const dir = new THREE.Vector3(1, 0.6, 1).normalize();
    cameraRef.current.position.copy(center).addScaledVector(dir, dist);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  }, [chunks, yScale, selectedGeometryId]);

  return (
    <div ref={containerRef} className="preview-3d-fullscreen">
      <canvas ref={canvasRef} className="preview-3d-canvas" />

      {/* Floating toolbar overlay */}
      <div className="preview-3d-toolbar">
        <button
          type="button"
          className="icon-button compact"
          title="Back to 2D"
          onClick={onExit}
        >
          <EyeOff size={14} />
        </button>
        <span className="preview-3d-badge">{blockCount.toLocaleString()} blocks</span>
        <label className="preview-3d-slider-row">
          <span>Vertical Scale</span>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={yScale}
            onChange={(e) => setYScale(Number(e.target.value))}
          />
          <span className="preview-3d-slider-value">{yScale.toFixed(1)}×</span>
        </label>
        <button
          type="button"
          className={`icon-button compact ${showAxes ? "active" : ""}`}
          title="Toggle axes"
          onClick={() => setShowAxes(!showAxes)}
        >
          <span style={{ fontSize: 11 }}>XYZ</span>
        </button>
        <button
          type="button"
          className={`icon-button compact ${showGround ? "active" : ""}`}
          title="Toggle ground plane"
          onClick={() => setShowGround(!showGround)}
        >
          <span style={{ fontSize: 11 }}>⬜</span>
        </button>
        <button
          type="button"
          className="icon-button compact"
          title="Fit camera to content"
          onClick={fitCamera}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          className="icon-button compact"
          title="Reset view"
          onClick={fitCamera}
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}
