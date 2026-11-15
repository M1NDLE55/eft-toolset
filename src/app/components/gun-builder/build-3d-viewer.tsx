"use client";

// The WebGL part of the 3D view. It pulls in three.js, so it is only loaded through
// build-3d-panel's dynamic import, when someone opens the 3D view.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { BoxGeometry, CylinderGeometry, EdgesGeometry, Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BuildScene, PartKind, ScenePart, Vec3 } from "@/app/lib/builds/build-scene";

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
      {scene.parts.map((part) => (
        <PartMesh
          key={part.id}
          part={part}
          selected={part.id === selectedId}
          hovered={part.id === hoveredId}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
      <CameraRig min={scene.min} max={scene.max} resetKey={resetKey} />
    </Canvas>
  );
}

function interactive(part: ScenePart) {
  return part.role !== "builtin";
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
