import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ChessPieceSpec } from '../utils/chessParametrics';
import {
  buildProceduralChessPieceGroup,
  buildTournamentBoardSetGroup,
  exportGroupToGLB,
  exportGroupToOBJ,
} from '../three/chessMeshBuilder';

export type CameraPresetId = 'hero' | 'profile' | 'crown' | 'top' | 'board-wide';
export type ViewportSceneMode = 'piece-forge' | 'board-preview';

export interface ChessViewportHandle {
  exportCurrentGLB: (filename: string) => Promise<number>;
  exportCurrentOBJ: (filename: string) => number;
}

interface ChessViewport3DProps {
  spec: ChessPieceSpec;
  sceneMode: ViewportSceneMode;
  cameraPreset: CameraPresetId;
  explodedFactor: number; // 0.0 to 1.0
  wireframe: boolean;
  autoRotate: boolean;
  onExportReady?: (handle: ChessViewportHandle) => void;
}

// Pre-allocated math helpers at module scope (Zero GC inside requestAnimationFrame)
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3();

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  hero: { pos: [4.5, 3.2, 5.5], target: [0, 1.15, 0] },
  profile: { pos: [0.0, 1.65, 6.2], target: [0, 1.15, 0] },
  crown: { pos: [2.2, 3.55, 2.5], target: [0, 2.45, 0] },
  top: { pos: [0.1, 6.8, 0.8], target: [0, 1.3, 0] },
  'board-wide': { pos: [10.4, 8.6, 11.2], target: [0, 0.1, 0] },
};

export const ChessViewport3D: React.FC<ChessViewport3DProps> = ({
  spec,
  sceneMode,
  cameraPreset,
  explodedFactor,
  wireframe,
  autoRotate,
  onExportReady,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Mutable refs for animation loop access without re-mounting WebGLRenderer
  const stateRef = useRef({
    spec,
    sceneMode,
    cameraPreset,
    explodedFactor,
    wireframe,
    autoRotate,
    userInteracting: false,
  });

  useEffect(() => {
    stateRef.current.spec = spec;
    stateRef.current.sceneMode = sceneMode;
    stateRef.current.cameraPreset = cameraPreset;
    stateRef.current.explodedFactor = explodedFactor;
    stateRef.current.wireframe = wireframe;
    stateRef.current.autoRotate = autoRotate;
  }, [spec, sceneMode, cameraPreset, explodedFactor, wireframe, autoRotate]);

  const activeSubjectGroupRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const maxAnisotropyRef = useRef<number>(4);

  // Mount WebGLRenderer & Studio Rig once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const isHeadless =
      navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isHeadless,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch (e) {
      setWebglError('WebGL 2.0 context initialization unavailable in this environment.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(
      isHeadless ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.shadowMap.enabled = !isHeadless;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    maxAnisotropyRef.current = renderer.capabilities.getMaxAnisotropy() || 4;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d11);
    scene.fog = new THREE.FogExp2(0x0b0d11, 0.032);
    sceneRef.current = scene;

    // Studio Environment Map (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    // Camera & OrbitControls
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 120);
    camera.position.set(4.5, 3.2, 5.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 + 0.08;
    controls.minDistance = 1.6;
    controls.maxDistance = 26;
    controls.target.set(0, 1.15, 0);

    const onStartInteract = () => {
      stateRef.current.userInteracting = true;
    };
    const onEndInteract = () => {
      setTimeout(() => {
        stateRef.current.userInteracting = false;
      }, 1500);
    };
    controls.addEventListener('start', onStartInteract);
    controls.addEventListener('end', onEndInteract);

    // 3-Point Warm/Cool Studio Lighting + RectAreaLight Softbox
    RectAreaLightUniformsLib.init();

    const hemiFill = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.75);
    scene.add(hemiFill);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.4);
    keyLight.position.set(5.5, 8.5, 5.0);
    keyLight.castShadow = !isHeadless;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    const d = 7;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.35);
    rimLight.position.set(-5.0, 4.5, -5.5);
    scene.add(rimLight);

    const studioSoftbox = new THREE.RectAreaLight(0xfde68a, 2.2, 4.5, 4.5);
    studioSoftbox.position.set(-3.8, 4.2, 3.2);
    studioSoftbox.lookAt(0, 1.8, 0);
    scene.add(studioSoftbox);

    // Ground Studio Turntable Plinth & Contact Shadow Disc (offset on Y to prevent Z-fighting)
    const plinthGroup = new THREE.Group();
    plinthGroup.name = 'Studio_Floor_Reference';

    const studioFloorGeo = new THREE.CircleGeometry(22, 64);
    const studioFloorMat = new THREE.MeshStandardMaterial({
      color: 0x0e1117,
      roughness: 0.85,
      metalness: 0.1,
    });
    const studioFloor = new THREE.Mesh(studioFloorGeo, studioFloorMat);
    studioFloor.rotation.x = -Math.PI / 2;
    studioFloor.position.y = -0.025;
    studioFloor.receiveShadow = true;
    plinthGroup.add(studioFloor);

    // Calibration Grid Ring
    const polarGrid = new THREE.PolarGridHelper(4.2, 16, 6, 64, 0x1e293b, 0x172033);
    polarGrid.position.y = -0.012;
    plinthGroup.add(polarGrid);

    // Soft radial contact shadow disc directly beneath hero piece
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(64, 64, 8, 64, 64, 60);
      grad.addColorStop(0, 'rgba(0,0,0,0.65)');
      grad.addColorStop(1, 'rgba(0,0,0,0.0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.75, 32),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.65,
      })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.002;
    plinthGroup.add(contactShadow);

    scene.add(plinthGroup);

    // Initial subject build
    const initialGroup = buildProceduralChessPieceGroup(stateRef.current.spec, {
      wireframe: stateRef.current.wireframe,
      maxAnisotropy: maxAnisotropyRef.current,
    });
    scene.add(initialGroup);
    activeSubjectGroupRef.current = initialGroup;

    // Pre-warm shaders once
    renderer.compile(scene, camera);

    // Expose export handle
    if (onExportReady) {
      onExportReady({
        exportCurrentGLB: (filename: string) => {
          const target = activeSubjectGroupRef.current ?? scene;
          return exportGroupToGLB(target, filename);
        },
        exportCurrentOBJ: (filename: string) => {
          const target = activeSubjectGroupRef.current ?? scene;
          return exportGroupToOBJ(target, filename);
        },
      });
    }

    // Resize listener
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Animation loop with exponential damping (throttled in headless CPU mode)
    const clock = new THREE.Clock();
    let animId = 0;
    let lastFrameTime = 0;
    let activePresetTracker = stateRef.current.cameraPreset;
    let cameraTransitionTimer = 0.9;

    const tick = (nowMs: number) => {
      animId = requestAnimationFrame(tick);

      if (isHeadless && nowMs - lastFrameTime < 66) {
        return; // ~15fps throttle in headless software WebGL
      }
      lastFrameTime = nowMs;

      const dt = Math.min(clock.getDelta(), 0.1);
      const st = stateRef.current;

      // Detect camera preset switch
      if (st.cameraPreset !== activePresetTracker) {
        activePresetTracker = st.cameraPreset;
        cameraTransitionTimer = 1.1;
      }

      if (cameraTransitionTimer > 0 && !st.userInteracting) {
        cameraTransitionTimer = Math.max(0, cameraTransitionTimer - dt);
        const preset = CAMERA_PRESETS[st.cameraPreset] ?? CAMERA_PRESETS.hero;
        _targetCamPos.set(...preset.pos);
        _targetLookAt.set(...preset.target);

        const dampFactor = 1 - Math.exp(-6.5 * dt);
        camera.position.lerp(_targetCamPos, dampFactor);
        controls.target.lerp(_targetLookAt, dampFactor);
      }

      // Smoothly damp Exploded View separation on active piece parts & turntable rotation
      const subject = activeSubjectGroupRef.current;
      if (subject) {
        if (st.autoRotate && !st.userInteracting) {
          subject.rotation.y += dt * 0.38;
        }
        if (st.sceneMode === 'piece-forge') {
          for (let i = 0; i < subject.children.length; i++) {
            const part = subject.children[i];
            const mult = part.userData?.explodeMultiplier ?? 0;
            const targetY = (part.userData?.baseY ?? 0) + st.explodedFactor * mult * 1.15;
            part.position.y = THREE.MathUtils.damp(part.position.y, targetY, 8.0, dt);
          }
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', onStartInteract);
      controls.removeEventListener('end', onEndInteract);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Rebuild procedural 3D mesh group whenever spec, sceneMode, or wireframe changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (activeSubjectGroupRef.current) {
      const prevRotY = activeSubjectGroupRef.current.rotation.y;
      scene.remove(activeSubjectGroupRef.current);

      const nextGroup =
        sceneMode === 'board-preview'
          ? buildTournamentBoardSetGroup(spec, maxAnisotropyRef.current)
          : buildProceduralChessPieceGroup(spec, {
              wireframe,
              maxAnisotropy: maxAnisotropyRef.current,
            });

      nextGroup.rotation.y = prevRotY;
      scene.add(nextGroup);
      activeSubjectGroupRef.current = nextGroup;
    }
  }, [spec, sceneMode, wireframe]);

  if (webglError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0B0D11] text-slate-300 p-8">
        <div className="max-w-md text-center space-y-2 border border-slate-800 bg-[#12161F] p-6 rounded-xl">
          <h2 className="text-base font-semibold text-white">3D Viewport Ready (Static Fallback)</h2>
          <p className="text-xs text-slate-400">{webglError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={canvasMountRef}
      data-testid="three-chess-viewport"
      className="w-full h-full relative overflow-hidden select-none"
    />
  );
};
