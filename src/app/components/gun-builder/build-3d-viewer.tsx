"use client";

// The WebGL part of the 3D view. It pulls in three.js, so it is only loaded through
// build-3d-panel's dynamic import, when someone opens the 3D view.

import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Mesh,
  Vector3,
  type Material,
  type Matrix4,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BuildScene, Finish, PartKind, ScenePart, Vec3 } from "@/app/lib/builds/build-scene";
import { modelTransform, VARIANT_SPECS, type ModelShape } from "@/app/lib/builds/part-models";
import gunPartsModel from "@/app/lib/builds/gun-parts-model.json";

const COLORS: Record<PartKind, string> = {
  body: "#76746c",
  receiver: "#8b887e",
  barrel: "#4b4b4b",
  muzzle: "#3d3d3d",
  gasBlock: "#6e6b63",
  handguard: "#7f786a",
  stock: "#6f675b",
  grip: "#5d5850",
  magazine: "#877c60",
  optic: "#52606d",
  ironSight: "#9b978c",
  mount: "#908d85",
  tactical: "#8c7c56",
  foregrip: "#68635b",
  charge: "#9c978d",
  launcher: "#6b7559",
  bipod: "#7b7b75",
  other: "#8d8980",
};
const FINISHES: Record<Finish, string> = {
  wood: "#7a5434",
  tan: "#a48d66",
  olive: "#5f6648",
  grey: "#8f9091",
  black: "#3a3a3a",
};
const LENS = "#23465c";
const ACCENT = "#9a8866";
const SELECTED = "#e6d9b8";
const BACKGROUND = "#070707";
const FOV = 35;

export interface Build3DViewerProps {
  scene: BuildScene;
  selectedId: string | null;
  hoveredId: string | null;
  /** Changing it points the camera back at the whole build. */
  resetKey: number;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onContextLost: () => void;
}

export default function Build3DViewer({
  scene,
  selectedId,
  hoveredId,
  resetKey,
  onHover,
  onSelect,
  onContextLost,
}: Build3DViewerProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: FOV, near: 1, far: 5000, position: [0, 40, 160] }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            onContextLost();
          },
          { once: true }
        );
      }}
      onPointerMissed={(event) => {
        if (event.type === "click") onSelect(null);
      }}
    >
      <color attach="background" args={[BACKGROUND]} />
      <hemisphereLight args={["#fff6e6", "#2a2824", 2.2]} />
      <directionalLight position={[60, 120, 90]} intensity={3} />
      <directionalLight position={[-80, 30, -60]} intensity={1.1} />
      <Ground min={scene.min} max={scene.max} />
      {/* Boxes stand in while the models load, and stay if they can't. */}
      <ModelBoundary fallback={<PartBoxes parts={scene.parts} selectedId={selectedId} hoveredId={hoveredId} onHover={onHover} onSelect={onSelect} />}>
        <Suspense fallback={<PartBoxes parts={scene.parts} selectedId={selectedId} hoveredId={hoveredId} onHover={onHover} onSelect={onSelect} />}>
          <PartModels parts={scene.parts} selectedId={selectedId} hoveredId={hoveredId} onHover={onHover} onSelect={onSelect} />
        </Suspense>
      </ModelBoundary>
      <CameraRig min={scene.min} max={scene.max} resetKey={resetKey} />
    </Canvas>
  );
}

function interactive(part: ScenePart) {
  return part.role !== "builtin";
}

interface PartsProps {
  parts: ScenePart[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PartBoxes({ parts, selectedId, hoveredId, onHover, onSelect }: PartsProps) {
  return parts.map((part) => (
    <PartMesh
      key={part.id}
      part={part}
      selected={part.id === selectedId}
      hovered={part.id === hoveredId}
      onHover={onHover}
      onSelect={onSelect}
    />
  ));
}

type MaterialSlot = "body" | "accent" | "lens";

interface PartModel extends ModelShape {
  pieces: { geometry: BufferGeometry; slot: MaterialSlot }[];
}

/** Copies a mesh's geometry into plain floats in the file's frame, undoing quantization. */
function bakeGeometry(source: BufferGeometry, matrix: Matrix4) {
  const geometry = new BufferGeometry();
  for (const key of ["position", "normal"]) {
    const attribute = source.getAttribute(key);
    if (!attribute) continue;
    const values = new Float32Array(attribute.count * 3);
    for (let index = 0; index < attribute.count; index += 1) {
      values[index * 3] = attribute.getX(index);
      values[index * 3 + 1] = attribute.getY(index);
      values[index * 3 + 2] = attribute.getZ(index);
    }
    geometry.setAttribute(key, new BufferAttribute(values, 3));
  }
  if (source.index) geometry.setIndex(source.index.clone());
  geometry.applyMatrix4(matrix);
  return geometry;
}

function materialSlot(material: Material | Material[]): MaterialSlot {
  const name = Array.isArray(material) ? material[0]?.name : material.name;
  return name === "accent" || name === "lens" ? name : "body";
}

function buildLibrary(root: Object3D) {
  root.updateMatrixWorld(true);
  const library = new Map<string, PartModel>();
  for (const variant of gunPartsModel.variants) {
    const node = root.getObjectByName(variant);
    const mount = root.getObjectByName(`${variant}__mount`);
    if (!node || !mount) continue;
    const pieces: PartModel["pieces"] = [];
    const bounds = new Box3();
    node.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const geometry = bakeGeometry(object.geometry, object.matrixWorld);
      geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
      pieces.push({ geometry, slot: materialSlot(object.material) });
    });
    if (pieces.length === 0 || bounds.isEmpty()) continue;
    const point = mount.getWorldPosition(new Vector3());
    library.set(variant, {
      pieces,
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      mount: point.toArray(),
    });
  }
  return library;
}

function PartModels({ parts, selectedId, hoveredId, onHover, onSelect }: PartsProps) {
  const gltf = useLoader(GLTFLoader, gunPartsModel.url);
  const library = useMemo(() => buildLibrary(gltf.scene), [gltf]);
  useEffect(
    () => () => {
      for (const model of library.values()) for (const piece of model.pieces) piece.geometry.dispose();
    },
    [library]
  );
  return parts.map((part) => {
    const model = library.get(part.variant);
    const spec = VARIANT_SPECS[part.variant];
    const common = {
      part,
      selected: part.id === selectedId,
      hovered: part.id === hoveredId,
      onHover,
      onSelect,
    };
    // Empty slots stay outlined boxes; anything without a model falls back to its box.
    if (part.role === "empty" || !model || !spec) return <PartMesh key={part.id} {...common} />;
    return <ModelMesh key={part.id} {...common} model={model} spec={spec} />;
  });
}

// Parts whose model is metal whatever kind of slot holds them.
const VARIANT_COLORS: Partial<Record<string, string>> = { mag_tube: COLORS.barrel, gas_tube: COLORS.barrel };

function partColor(part: ScenePart) {
  return part.finish ? FINISHES[part.finish] : VARIANT_COLORS[part.variant] ?? COLORS[part.kind];
}

function ModelMesh({
  part,
  model,
  spec,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  part: ScenePart;
  model: PartModel;
  spec: (typeof VARIANT_SPECS)[string];
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const transform = modelTransform(part, spec, model);
  const body = selected ? SELECTED : partColor(part);
  // Wood furniture keeps dark metal fittings; otherwise accents are a darker shade of the part.
  const accent = part.finish === "wood" ? "#2c2c2c" : `#${new Color(body).multiplyScalar(0.42).getHexString()}`;
  const glow = hovered && !selected;

  function handleOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    if (interactive(part)) onHover(part.id);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (event.delta > 6) return;
    onSelect(interactive(part) ? part.id : null);
  }

  return (
    <group
      position={transform.position}
      quaternion={transform.quaternion}
      scale={transform.scale}
      onPointerOver={handleOver}
      onPointerOut={() => onHover(null)}
      onClick={handleClick}
    >
      {model.pieces.map((piece, index) => (
        <mesh key={index} geometry={piece.geometry} position={transform.offset}>
          <meshStandardMaterial
            color={piece.slot === "lens" ? LENS : piece.slot === "accent" ? accent : body}
            roughness={piece.slot === "lens" ? 0.15 : part.finish === "wood" && piece.slot === "body" ? 0.8 : 0.58}
            metalness={piece.slot === "lens" ? 0.6 : part.finish === "wood" && piece.slot === "body" ? 0.05 : 0.4}
            emissive={glow ? ACCENT : "#000000"}
            emissiveIntensity={glow ? 0.35 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

function PartMesh({
  part,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  part: ScenePart;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const [length, height, depth] = part.size;
  const cylinder = part.shape === "cylinder";
  const geometry = useMemo(
    () =>
      cylinder
        ? new CylinderGeometry(height / 2, height / 2, length, 28)
        : new BoxGeometry(length, height, depth),
    [cylinder, length, height, depth]
  );
  const edges = useMemo(() => new EdgesGeometry(geometry, 30), [geometry]);
  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges]
  );

  const empty = part.role === "empty";
  const color = selected ? SELECTED : empty ? ACCENT : COLORS[part.kind];
  // Cylinders are built along y; turn them to lie along the bore.
  const rotation: Vec3 = cylinder ? [0, 0, Math.PI / 2] : [0, 0, part.tilt];

  function handleOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    if (interactive(part)) onHover(part.id);
  }

  function handleOut() {
    onHover(null);
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    // A drag to orbit ends in a click too; only a press that stayed put selects.
    if (event.delta > 6) return;
    onSelect(interactive(part) ? part.id : null);
  }

  return (
    <group position={part.center} rotation={rotation}>
      <mesh geometry={geometry} onPointerOver={handleOver} onPointerOut={handleOut} onClick={handleClick}>
        <meshStandardMaterial
          color={color}
          roughness={0.62}
          metalness={0.35}
          transparent={empty}
          opacity={empty ? 0.18 : 1}
          depthWrite={!empty}
          emissive={hovered && !selected ? ACCENT : "#000000"}
          emissiveIntensity={hovered && !selected ? 0.35 : 0}
        />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial
          color={selected || hovered || empty ? ACCENT : "#0d0d0d"}
          transparent
          opacity={empty ? 0.9 : selected || hovered ? 1 : 0.55}
        />
      </lineSegments>
    </group>
  );
}

function Ground({ min, max }: { min: Vec3; max: Vec3 }) {
  const span = Math.max(max[0] - min[0], max[2] - min[2], 40);
  const size = Math.ceil((span * 1.3) / 10) * 10;
  return (
    <gridHelper
      args={[size, size / 5, "#2a2a2a", "#161616"]}
      position={[(min[0] + max[0]) / 2, min[1] - 2, (min[2] + max[2]) / 2]}
      raycast={() => null}
    />
  );
}

/**
 * Orbit controls plus framing: the camera keeps framing the whole build as parts load and change
 * until the viewer first moves it, then stays put until the view is reset.
 */
function CameraRig({ min, max, resetKey }: { min: Vec3; max: Vec3; resetKey: number }) {
  // three.js objects are mutable by design; read the camera when it's needed rather than as a hook value.
  const getState = useThree((state) => state.get);
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const controlsRef = useRef<OrbitControls | null>(null);
  const movedRef = useRef(false);
  const framedResetRef = useRef<number | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(getState().camera, domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    const markMoved = () => {
      movedRef.current = true;
    };
    const redraw = () => invalidate();
    controls.addEventListener("change", redraw);
    controls.addEventListener("start", markMoved);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", redraw);
      controls.removeEventListener("start", markMoved);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [getState, domElement, invalidate]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = getState().camera as PerspectiveCamera;
    const reset = framedResetRef.current !== resetKey;
    if (!reset && movedRef.current) return;
    framedResetRef.current = resetKey;
    movedRef.current = false;

    const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    // A three-quarter view of the right side, a little from above, muzzle to the right.
    const direction = new Vector3(0.22, 0.28, 0.93).normalize();
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (index) => new Vector3(index & 1 ? max[0] : min[0], index & 2 ? max[1] : min[1], index & 4 ? max[2] : min[2])
    );
    camera.aspect = width > 0 && height > 0 ? width / height : camera.aspect;
    // Start from the distance that fits the bounding sphere, then close in until the box's corners
    // just fit on screen with a margin.
    const radius = Math.max(corners[0].distanceTo(corners[7]) / 2, 5);
    const vertical = (FOV * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    let distance = radius / Math.sin(Math.min(vertical, horizontal) / 2);
    for (let pass = 0; pass < 3; pass += 1) {
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = Math.max(distance / 100, 0.5);
      camera.far = distance * 20;
      camera.lookAt(center);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const reach = Math.max(
        ...corners.map((corner) => {
          const projected = corner.clone().project(camera);
          return Math.max(Math.abs(projected.x), Math.abs(projected.y));
        })
      );
      distance *= Math.min(Math.max(reach / 0.88, 0.5), 1.5);
    }
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.target.copy(center);
    controls.minDistance = distance * 0.15;
    controls.maxDistance = distance * 4;
    controls.update();
    invalidate();
  }, [getState, invalidate, min, max, width, height, resetKey]);

  return null;
}
