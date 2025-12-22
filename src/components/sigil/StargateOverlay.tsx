// src/components/sigil/StargateOverlay.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Environment,
  Html,
  OrbitControls,
  useTexture,
  Stars,
} from "@react-three/drei";
import * as THREE from "three";
import { BREATH_SEC, GENESIS_TS } from "../../SovereignSolar";

/** Golden-breath timing (φ-exact): T = 3 + √5 seconds (imported via BREATH_SEC) */
const BREATH_T = BREATH_SEC;

/** Live breath phase (0..1) and amplitude (0..1) driven by genesis-anchored time */
function useKaiBreath() {
  const [phase, setPhase] = useState(0);
  const [amp, setAmp] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const periodMs = BREATH_T * 1000;
    const tick = () => {
      const now = Date.now();
      const phi = ((now - GENESIS_TS) % periodMs + periodMs) % periodMs; // 0..periodMs
      const ph = phi / periodMs; // 0..1
      const a = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2); // smooth inhale/exhale
      setPhase(ph);
      setAmp(a);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { phase, amp };
}

/* Minimal WebXR facades to avoid `any` + avoid requiring lib.dom.webxr in tsconfig */
type XRSessionLike = { end(): Promise<void> };
type XRSessionInitLike = { optionalFeatures?: string[] };
type XRSystemLike = {
  isSessionSupported?(mode: "immersive-vr"): Promise<boolean>;
  requestSession?(
    mode: "immersive-vr",
    init?: XRSessionInitLike
  ): Promise<XRSessionLike>;
};
type NavigatorWithXR = Navigator & { xr?: XRSystemLike };

/** Enter VR button (native WebXR) */
function EnterVRButton() {
  const { gl } = useThree();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const xr = (navigator as NavigatorWithXR).xr;
        if (!xr || !xr.isSessionSupported) {
          if (!canceled) setSupported(false);
          return;
        }
        const ok = await xr.isSessionSupported("immersive-vr");
        if (!canceled) setSupported(!!ok);
      } catch {
        if (!canceled) setSupported(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const onSessionChange = () => setPresenting(!!gl.xr.getSession());
    gl.xr.addEventListener("sessionstart", onSessionChange);
    gl.xr.addEventListener("sessionend", onSessionChange);
    return () => {
      gl.xr.removeEventListener("sessionstart", onSessionChange);
      gl.xr.removeEventListener("sessionend", onSessionChange);
    };
  }, [gl]);

  if (supported === false) return null;

  const toggleVR = async () => {
    if (presenting) {
      await gl.xr.getSession()?.end();
      return;
    }
    const xr = (navigator as NavigatorWithXR).xr;
    if (!xr?.requestSession) return;
    const session = await xr.requestSession("immersive-vr", {
      optionalFeatures: [
        "local-floor",
        "bounded-floor",
        "hand-tracking",
        "layers",
      ],
    });
    // three's WebXRManager accepts a real XRSession; our minimal type is compatible at runtime.
    await gl.xr.setSession(session as unknown as never);
  };

  return (
    <Html
      transform
      wrapperClass="stargate-vr-ui"
      position={[0, 1.4, -1.5]}
      distanceFactor={2}
    >
      <button
        type="button"
        className="stargate-vr-btn"
        onClick={(e) => {
          e.stopPropagation();
          void toggleVR();
        }}
      >
        {presenting ? "Exit VR" : "Enter VR"}
      </button>
    </Html>
  );
}

/** Breathing portal ring with emissive feel */
function PortalRing({ amp }: { amp: number }) {
  const torus = useRef<THREE.Mesh>(null!);
  useFrame((_, delta) => {
    if (!torus.current) return;
    torus.current.rotation.x += delta * 0.07;
    torus.current.rotation.y += delta * 0.12;
    const s = 1 + amp * 0.12;
    torus.current.scale.setScalar(s);
  });

  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#00ffd0").lerp(
          new THREE.Color("#ffffff"),
          0.25
        ),
        emissive: new THREE.Color("#00ffd0"),
        emissiveIntensity: 0.6,
        metalness: 0.4,
        roughness: 0.2,
        transmission: 0.2,
        thickness: 0.6,
        transparent: true,
        opacity: 0.9,
      }),
    []
  );

  return (
    <mesh ref={torus}>
      <torusKnotGeometry args={[1.2, 0.18, 220, 36, 2, 5]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

/**
 * Hook: load + configure sigil texture without mutating the hook return.
 * We clone the base texture so eslint’s immutability rule is satisfied.
 */
function useSigilTexture(src: string): THREE.Texture {
  const baseTexture = useTexture(src) as THREE.Texture;

  const configured = useMemo(() => {
    const clone = baseTexture.clone();
    clone.colorSpace = THREE.SRGBColorSpace;
    clone.anisotropy = 8;
    return clone;
  }, [baseTexture]);

  useEffect(() => {
    return () => {
      configured.dispose();
    };
  }, [configured]);

  return configured;
}

/** The sigil plane (texture) that breathes */
function SigilPortal({
  src,
  phase,
  amp,
}: {
  src: string;
  phase: number;
  amp: number;
}) {
  const mesh = useRef<THREE.Mesh>(null!);
  const tex = useSigilTexture(src);

  useFrame(() => {
    if (!mesh.current) return;
    const wobble = 0.015 + amp * 0.02;
    mesh.current.rotation.z = Math.sin(phase * Math.PI * 2) * 0.15;
    mesh.current.position.z = Math.sin(phase * Math.PI * 2) * 0.05;
    const scale = 1 + Math.sin(phase * Math.PI * 2) * 0.06;
    mesh.current.scale.setScalar(scale);
    const mat = mesh.current.material as THREE.MeshPhysicalMaterial;
    mat.emissiveIntensity = 0.3 + amp * 0.7;
    mat.roughness = 0.25 - wobble * 0.5;
  });

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        map: tex,
        transparent: true,
        color: new THREE.Color(1, 1, 1),
        emissive: new THREE.Color("#00ffd0").multiplyScalar(0.15),
        metalness: 0.15,
        roughness: 0.25,
        clearcoat: 0.7,
        clearcoatRoughness: 0.2,
      }),
    [tex]
  );

  return (
    <mesh ref={mesh}>
      <planeGeometry args={[1.6, 1.6]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** Golden-ratio particle halo (instanced) */
function PhiHalo({ phase, amp }: { phase: number; amp: number }) {
  const count = 900;
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
      }),
    []
  );

  // Precompute positions on a golden spiral
  const positions = useMemo(() => {
    const pts: { pos: THREE.Vector3; r: number; a: number }[] = [];
    const phi = (1 + Math.sqrt(5)) / 2;
    const turn = 2 * Math.PI * (1 - 1 / phi); // ~137.5°
    for (let i = 0; i < count; i++) {
      const r = 0.5 + i * 0.0025;
      const a = i * turn;
      const x = Math.cos(a) * r * 2.2;
      const y = Math.sin(a) * r * 2.2;
      const z = Math.sin(i * 0.07) * 0.1;
      pts.push({ pos: new THREE.Vector3(x, y, z), r, a });
    }
    return pts;
  }, [count]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const spin = t * 0.12 + phase * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const { pos, a } = positions[i];
      dummy.position.set(
        pos.x * (1 + amp * 0.07),
        pos.y * (1 + amp * 0.07),
        pos.z + Math.sin(a + t * 0.8) * 0.02
      );
      dummy.rotation.set(0, 0, a + spin);
      const s = 0.008 + (Math.sin(a + t * 3.0) * 0.5 + 0.5) * 0.012;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);

      color.setHSL(
        ((a / (Math.PI * 2)) + phase) % 1,
        0.6,
        0.6 + amp * 0.2
      );
      mesh.current.setColorAt(i, color);
    }
    mesh.current.instanceMatrix.needsUpdate = true;

    const im = mesh.current as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, count]} />;
}

/** Main scene */
function StargateScene({ src }: { src: string }) {
  const { phase, amp } = useKaiBreath();

  const group = useRef<THREE.Group>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.1) * 0.05;
      group.current.rotation.x = Math.sin(t * 0.13) * 0.03;
    }
  });

  return (
    <>
      <group ref={group}>
        <SigilPortal src={src} phase={phase} amp={amp} />
        <PortalRing amp={amp} />
        <group scale={1.2} position={[0, 0, -0.1]}>
          <PhiHalo phase={phase} amp={amp} />
        </group>
      </group>

      <Stars depth={50} radius={80} factor={2} fade />
      <Environment preset="night" background={false} />

      <OrbitControls
        enableZoom
        enablePan={false}
        minDistance={1.5}
        maxDistance={6}
        target={[0, 0, 0]}
      />

      <EnterVRButton />
    </>
  );
}

type Press = {
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

type Props = {
  open: boolean;
  src: string;
  onClose: () => void;
  closePress: Press;
};

export default function StargateOverlay({
  open,
  src,
  onClose,
  closePress,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="stargate-overlay"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      tabIndex={-1}
      onClick={() => onClose()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2_147_483_600,
        background:
          "radial-gradient(80% 60% at 50% 50%, rgba(0,0,0,0.75), rgba(0,0,0,0.95))",
        backdropFilter: "blur(3px)",
      }}
    >
      <button
        className="stargate-exit"
        aria-label="Close viewer"
        {...closePress}
        style={{
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          right: "max(12px, env(safe-area-inset-right))",
          width: 44,
          height: 44,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.06)",
          color: "#fff",
          fontSize: 18,
          zIndex: 2,
        }}
        onClick={(e) => {
          e.stopPropagation();
          closePress.onClick(e);
          onClose();
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          closePress.onPointerUp(e);
        }}
      >
        ✕
      </button>

      <div
        className="stargate-stage"
        onClick={(e) => e.stopPropagation()}
        style={{ position: "absolute", inset: 0 }}
      >
        <Canvas
          dpr={[1, 2]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
          }}
          onCreated={(state) => {
            // TS-safe renderer with optional legacy flags for older three versions
            const r = state.gl as THREE.WebGLRenderer &
              Partial<{
                physicallyCorrectLights: boolean;
                useLegacyLights: boolean;
              }>;

            // Color/tone mapping
            r.outputColorSpace = THREE.SRGBColorSpace;
            r.toneMapping = THREE.ACESFilmicToneMapping;
            r.toneMappingExposure = 1.0;

            // For older three versions only (guards prevent TS errors + no-ops on modern builds)
            if (typeof r.useLegacyLights !== "undefined")
              r.useLegacyLights = false;
            if (typeof r.physicallyCorrectLights !== "undefined")
              r.physicallyCorrectLights = true;
          }}
          camera={{
            fov: 55,
            near: 0.1,
            far: 200,
            position: [0, 0, 3.2],
          }}
        >
          <StargateScene src={src} />
        </Canvas>
      </div>
    </div>
  );
}