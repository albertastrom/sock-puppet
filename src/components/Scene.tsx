import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  ContactShadows,
  Grid,
  OrbitControls,
  RoundedBox,
} from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { config, type Side } from "@sock-puppet/robot/config";
import { paintEye } from "@sock-puppet/robot/display";
import type { Eye } from "@sock-puppet/robot/protocol";
import type { Simulator } from "@sock-puppet/robot/simulator";

const { width: frameWidth, height: frameHeight } = config.display;

function useFabric() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#b7b7b7";
    ctx.fillRect(0, 0, 128, 128);
    for (let y = -8; y < 136; y += 8)
      for (let x = 0; x < 128; x += 8) {
        ctx.strokeStyle = "#e4e4e4";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 3, y + 5);
        ctx.lineTo(x + 6, y);
        ctx.stroke();
        ctx.strokeStyle = "#858585";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 5);
        ctx.lineTo(x + 3, y + 8);
        ctx.stroke();
      }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    tex.anisotropy = 8;
    return tex;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Screen({ side, simulator }: { side: Side; simulator: Simulator }) {
  const last = useRef<Eye | undefined>(undefined);
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    return { canvas, texture };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    const eye = simulator.getState().eyes[side];
    if (eye === last.current) return;
    last.current = eye;
    paintEye(canvas, eye);
    texture.needsUpdate = true;
  });
  const d = config.dimensions;
  return (
    <group position={[side === "left" ? d.eyeX : -d.eyeX, d.eyeY, d.eyeZ]}>
      <RoundedBox
        args={[d.eyeSize + 0.008, d.eyeSize / 2 + 0.008, 0.009]}
        radius={0.007}
        smoothness={4}
      >
        <meshStandardMaterial color="#333333" roughness={0.55} />
      </RoundedBox>
      <mesh position={[0, 0, 0.0046]}>
        <planeGeometry args={[d.eyeSize, d.eyeSize / 2]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive="white"
          color="black"
          emissiveIntensity={1}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Puppet({ simulator, axes }: { simulator: Simulator; axes: boolean }) {
  const root = useRef<THREE.Group>(null),
    head = useRef<THREE.Group>(null),
    jaw = useRef<THREE.Group>(null);
  const fabric = useFabric(),
    d = config.dimensions,
    c = config.colors;
  const previousPitch = useRef(Number.NaN);
  const body = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(
      d.radius,
      d.radius * 1.12,
      d.neckY - d.baseHeight,
      48,
      32,
      true,
    );
    geometry.translate(0, (d.neckY + d.baseHeight) / 2, 0);
    return {
      geometry,
      original: new Float32Array(geometry.attributes.position.array),
    };
  }, [d]);
  useEffect(() => () => body.geometry.dispose(), [body]);
  useFrame(() => {
    const state = simulator.getState(),
      pitch = -THREE.MathUtils.degToRad(state.motors.headPitch.angleDeg);
    root.current!.rotation.y = THREE.MathUtils.degToRad(
      state.motors.baseYaw.angleDeg,
    );
    head.current!.rotation.x = pitch;
    jaw.current!.rotation.x = THREE.MathUtils.degToRad(
      state.motors.jawOpen.angleDeg,
    );
    if (pitch === previousPitch.current) return;
    previousPitch.current = pitch;
    const positions = body.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = body.original[i * 3],
        y = body.original[i * 3 + 1],
        z = body.original[i * 3 + 2];
      const t = THREE.MathUtils.smoothstep(y, d.neckY - 0.13, d.neckY),
        angle = pitch * t;
      const neckRadius = 1 - 0.34 * t;
      const neckZ = z * neckRadius - 0.03 * t;
      const ripple = 1 + 0.022 * Math.sin(y * 130) + 0.012 * Math.cos(y * 270);
      positions.setXYZ(
        i,
        x * ripple * neckRadius,
        d.neckY + (y - d.neckY) * Math.cos(angle) - neckZ * Math.sin(angle),
        (y - d.neckY) * Math.sin(angle) + neckZ * Math.cos(angle),
      );
    }
    positions.needsUpdate = true;
    body.geometry.computeVertexNormals();
  });
  const material = (
    <meshStandardMaterial
      color={c.fabric}
      roughness={0.96}
      map={fabric}
      bumpMap={fabric}
      bumpScale={0.001}
    />
  );
  return (
    <group>
      <RoundedBox
        args={[d.base, d.baseHeight, d.base]}
        radius={0.012}
        position={[0, d.baseHeight / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={c.base} roughness={0.5} />
      </RoundedBox>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <mesh
            key={`${x}-${z}`}
            position={[x * 0.08, d.baseHeight + 0.0002, z * 0.08]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.003, 16]} />
            <meshStandardMaterial
              color="#a1a8a0"
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.028, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.065, 0.008, 64]} />
        <meshStandardMaterial color="#7a8479" roughness={0.6} />
      </mesh>
      <group ref={root}>
        {axes && <axesHelper args={[0.13]} />}
        <mesh geometry={body.geometry} castShadow receiveShadow>
          {material}
        </mesh>
        <mesh position={[0, 0.065, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.064, 0.055, 64]} />
          <meshStandardMaterial
            color={c.cuff}
            roughness={1}
            map={fabric}
            bumpMap={fabric}
            bumpScale={0.001}
          />
        </mesh>
        {[0.045, 0.059, 0.073, 0.087].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.063, 0.0015, 6, 64]} />
            <meshStandardMaterial color="#dcb680" roughness={1} />
          </mesh>
        ))}
        <group ref={head} position={[0, d.neckY, 0]}>
          {axes && <axesHelper args={[0.1]} />}
          <mesh
            position={[0, 0.004, -0.026]}
            scale={[0.038, 0.031, 0.045]}
            castShadow
          >
            <sphereGeometry args={[1, 32, 24]} />
            {material}
          </mesh>
          <mesh
            position={[0, 0.035, 0.042]}
            scale={[d.headWidth / 2, d.headHeight / 2, d.headDepth / 2]}
            castShadow
          >
            <sphereGeometry args={[1, 48, 32]} />
            {material}
          </mesh>
          <mesh position={[0, 0.002, 0.071]} scale={[0.065, 0.008, 0.056]}>
            <sphereGeometry args={[1, 32, 16]} />
            <meshStandardMaterial color={c.mouth} roughness={1} />
          </mesh>
          <Screen side="left" simulator={simulator} />
          <Screen side="right" simulator={simulator} />
          <group ref={jaw} position={[0, d.jawY, d.jawZ]}>
            {axes && <axesHelper args={[0.08]} />}
            <mesh
              position={[0, -0.013, 0.052]}
              scale={[0.067, 0.022, 0.06]}
              castShadow
            >
              <sphereGeometry args={[1, 40, 24]} />
              {material}
            </mesh>
            <mesh position={[0, 0.001, 0.057]} scale={[0.059, 0.006, 0.049]}>
              <sphereGeometry args={[1, 32, 16]} />
              <meshStandardMaterial color={c.mouth} roughness={1} />
            </mesh>
            <mesh position={[0, 0.006, 0.073]} scale={[0.026, 0.003, 0.024]}>
              <sphereGeometry args={[1, 24, 16]} />
              <meshStandardMaterial color={c.tongue} roughness={0.9} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

function CameraControls({ reset }: { reset: number }) {
  const ref = useRef<OrbitControlsImpl>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.object.position.set(0.64, 0.45, 0.92);
      ref.current.target.set(0, 0.22, 0);
      ref.current.update();
    }
  }, [reset]);
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      target={[0, 0.22, 0]}
      minDistance={0.35}
      maxDistance={2.5}
      maxPolarAngle={Math.PI / 2 - 0.03}
      enableDamping
    />
  );
}

export function Scene({
  simulator,
  axes,
  reset,
}: {
  simulator: Simulator;
  axes: boolean;
  reset: number;
}) {
  return (
    <Canvas
      className="three-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.64, 0.45, 0.92], fov: 36, near: 0.01, far: 30 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#f5f5f5"]} />
      <fog attach="fog" args={["#f5f5f5", 1.8, 5]} />
      <ambientLight intensity={1.4} />
      <hemisphereLight args={["#fff9ec", "#8d9a87", 1.3]} />
      <directionalLight
        position={[1, 2, 1.5]}
        intensity={2.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-0.6}
        shadow-camera-right={0.6}
        shadow-camera-top={0.7}
        shadow-camera-bottom={-0.6}
        shadow-normalBias={0.002}
      />
      <Suspense fallback={null}>
        <Puppet simulator={simulator} axes={axes} />
        <ContactShadows
          position={[0, 0.0001, 0]}
          opacity={0.35}
          scale={2}
          blur={2.5}
          far={0.65}
          resolution={512}
          frames={1}
        />
      </Suspense>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.0003, 0]}
        receiveShadow
      >
        <planeGeometry args={[20, 20]} />
        <shadowMaterial transparent opacity={0.14} />
      </mesh>
      <Grid
        position={[0, -0.0005, 0]}
        args={[10, 10]}
        cellSize={0.1}
        cellThickness={0.55}
        cellColor="#bdc4b9"
        sectionSize={0.5}
        sectionThickness={0.8}
        sectionColor="#a5af9f"
        fadeDistance={3}
        fadeStrength={1.5}
        infiniteGrid
      />
      <CameraControls reset={reset} />
    </Canvas>
  );
}
