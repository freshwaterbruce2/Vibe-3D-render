import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import {
  ChessPieceSpec,
  ChessPieceType,
  computeLatheProfilePoints,
  createDefaultPieceSpec,
} from '../utils/chessParametrics';

const grainTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generates a procedural tileable micro-grain bump/roughness CanvasTexture
 * with zero external network dependencies, cached by materialId.
 */
export function createProceduralGrainTexture(
  materialId: ChessPieceSpec['materialId'],
  maxAnisotropy = 4
): THREE.CanvasTexture {
  const cached = grainTextureCache.get(materialId);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 128, 128);

    // Deterministic pseudo-random pattern based on coordinates
    for (let y = 0; y < 128; y += 2) {
      for (let x = 0; x < 128; x += 4) {
        const wave =
          materialId === 'damascus'
            ? Math.sin(y * 0.18 + Math.sin(x * 0.08) * 3.0) * 38
            : materialId === 'boxwood'
            ? Math.sin(x * 0.25 + Math.cos(y * 0.04) * 2.0) * 24
            : Math.sin((x + y) * 0.12) * 14;
        const val = Math.max(40, Math.min(220, Math.round(128 + wave)));
        ctx.fillStyle = `rgb(${val},${val},${val})`;
        ctx.fillRect(x, y, 4, 2);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  grainTextureCache.set(materialId, texture);
  return texture;
}

/**
 * Builds a multi-part procedural 3D chess piece Group (5-9 distinct sub-meshes)
 * with varied PBR materials, bottom-center grounding at y = 0, and exploded-view
 * layer metadata (`userData.baseY`, `userData.explodeMultiplier`).
 */
export function buildProceduralChessPieceGroup(
  spec: ChessPieceSpec,
  options?: {
    wireframe?: boolean;
    maxAnisotropy?: number;
    isWhiteSide?: boolean;
    sharedPrimaryMat?: THREE.Material;
    sharedAccentMat?: THREE.Material;
  }
): THREE.Group {
  const group = new THREE.Group();
  group.name = `GMF_${spec.pieceType}_${spec.style}_${spec.lod}`;

  const radialSegments =
    spec.lod === 'LOD0' ? 32 : spec.lod === 'LOD1' ? 20 : 12;
  const profilePts = computeLatheProfilePoints(spec);
  const maxY = profilePts[profilePts.length - 1]?.y ?? 2.5;
  const topRadius = profilePts[profilePts.length - 1]?.r ?? 0.55;

  let primaryMat: THREE.Material;
  let accentMat: THREE.Material;

  if (options?.sharedPrimaryMat && options?.sharedAccentMat) {
    primaryMat = options.sharedPrimaryMat;
    accentMat = options.sharedAccentMat;
  } else {
    const grainMap = createProceduralGrainTexture(
      spec.materialId,
      options?.maxAnisotropy ?? 4
    );

    let primaryColor = new THREE.Color(spec.primaryColorHex);
    let accentColor = new THREE.Color(spec.accentColorHex);

    if (options?.isWhiteSide !== undefined) {
      if (options.isWhiteSide) {
        primaryColor = new THREE.Color('#E8DCC8');
        accentColor = new THREE.Color('#D97706');
      } else {
        primaryColor = new THREE.Color('#1B1F27');
        accentColor = new THREE.Color('#F59E0B');
      }
    }

    if (spec.transmission > 0.05) {
      primaryMat = new THREE.MeshPhysicalMaterial({
        color: primaryColor,
        roughness: spec.roughness,
        metalness: spec.metalness,
        clearcoat: spec.clearcoat,
        transmission: spec.transmission,
        thickness: 1.0,
        ior: 1.52,
        bumpMap: grainMap,
        bumpScale: 0.01,
        wireframe: Boolean(options?.wireframe),
      });
    } else {
      primaryMat = new THREE.MeshStandardMaterial({
        color: primaryColor,
        roughness: spec.roughness,
        metalness: spec.metalness,
        bumpMap: grainMap,
        bumpScale: 0.012,
        wireframe: Boolean(options?.wireframe),
      });
    }

    const accentRoughness =
      spec.roughness > 0.4
        ? Math.max(0.08, spec.roughness - 0.28)
        : Math.min(0.85, spec.roughness + 0.28);

    accentMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: accentRoughness,
      metalness: Math.min(1.0, spec.metalness + 0.45),
      wireframe: Boolean(options?.wireframe),
    });
  }

  // Split lathe points by section so Pedestal, Shaft, and Capital are distinct parts for Exploded View
  const pedestalPts = profilePts
    .filter((p) => p.section === 'pedestal' || p.section === 'collar')
    .map((p) => new THREE.Vector2(p.r, p.y));

  const shaftPts = profilePts
    .filter((p) => p.section === 'collar' || p.section === 'shaft')
    .map((p) => new THREE.Vector2(p.r, p.y));

  const capitalPts = profilePts
    .filter((p) => p.section === 'capital')
    .map((p) => new THREE.Vector2(p.r, p.y));

  // Part 1: Pedestal Base
  if (pedestalPts.length >= 2) {
    const pedGeo = new THREE.LatheGeometry(pedestalPts, radialSegments);
    pedGeo.computeVertexNormals();
    const pedMesh = new THREE.Mesh(pedGeo, primaryMat);
    pedMesh.name = 'Part_01_Pedestal';
    pedMesh.castShadow = true;
    pedMesh.receiveShadow = true;
    pedMesh.userData = { baseY: 0, explodeMultiplier: 0.0 };
    group.add(pedMesh);
  }

  // Part 2: Metallic Engraved Collar Torus Rings
  const collarGroup = new THREE.Group();
  collarGroup.name = 'Part_02_CollarRings';
  const ringCount = Math.max(1, Math.min(5, spec.collarRings));
  const collarBaseY = maxY * 0.22;
  for (let i = 0; i < ringCount; i++) {
    const ringR = spec.baseRadius * (0.76 - i * 0.04);
    const torusGeo = new THREE.TorusGeometry(
      ringR,
      0.032 + spec.bevelChamfer * 0.25,
      6,
      radialSegments
    );
    const torusMesh = new THREE.Mesh(torusGeo, accentMat);
    torusMesh.rotation.x = Math.PI / 2;
    torusMesh.position.y = collarBaseY + i * 0.075;
    torusMesh.castShadow = true;
    collarGroup.add(torusMesh);
  }
  collarGroup.userData = { baseY: 0, explodeMultiplier: 0.35 };
  group.add(collarGroup);

  // Part 3: Main Column / Shaft + Optional Vertical Fluting Ribs
  const shaftGroup = new THREE.Group();
  shaftGroup.name = 'Part_03_ColumnShaft';
  if (shaftPts.length >= 2) {
    // Close top/bottom caps cleanly
    const ptsWithCaps = [
      new THREE.Vector2(0.001, shaftPts[0].y),
      ...shaftPts,
      new THREE.Vector2(0.001, shaftPts[shaftPts.length - 1].y),
    ];
    const shaftGeo = new THREE.LatheGeometry(ptsWithCaps, radialSegments);
    shaftGeo.computeVertexNormals();
    const shaftMesh = new THREE.Mesh(shaftGeo, primaryMat);
    shaftMesh.castShadow = true;
    shaftMesh.receiveShadow = true;
    shaftGroup.add(shaftMesh);
  }

  if (spec.flutingCount > 0 && spec.flutingDepth > 0.01) {
    const fluteCount = Math.min(24, spec.flutingCount);
    const shaftBottom = maxY * 0.3;
    const shaftTop = maxY * 0.68;
    const fluteHeight = shaftTop - shaftBottom;
    const midRadius = spec.baseRadius * spec.waistTaper * 1.04;
    const ribGeo = new THREE.CylinderGeometry(
      spec.flutingDepth * 0.38,
      spec.flutingDepth * 0.52,
      fluteHeight,
      8
    );

    for (let f = 0; f < fluteCount; f++) {
      const angle = (f / fluteCount) * Math.PI * 2;
      const ribMesh = new THREE.Mesh(
        ribGeo,
        spec.style === 'cyber' || spec.style === 'artdeco' ? accentMat : primaryMat
      );
      ribMesh.position.set(
        Math.cos(angle) * midRadius,
        shaftBottom + fluteHeight * 0.5,
        Math.sin(angle) * midRadius
      );
      shaftGroup.add(ribMesh);
    }
  }
  shaftGroup.userData = { baseY: 0, explodeMultiplier: 0.75 };
  group.add(shaftGroup);

  // Part 4: Upper Capital Bolster
  const capitalGroup = new THREE.Group();
  capitalGroup.name = 'Part_04_CapitalBolster';
  if (capitalPts.length >= 2) {
    const capGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.001, capitalPts[0].y),
        ...capitalPts,
        new THREE.Vector2(0.001, capitalPts[capitalPts.length - 1].y),
      ],
      radialSegments
    );
    capGeo.computeVertexNormals();
    const capMesh = new THREE.Mesh(capGeo, accentMat);
    capMesh.castShadow = true;
    capitalGroup.add(capMesh);
  }
  capitalGroup.userData = { baseY: 0, explodeMultiplier: 1.15 };
  group.add(capitalGroup);

  // Part 5: Piece-Specific Sculpted Head & Finial Crown
  const headGroup = buildPieceHeadGeometry(
    spec,
    maxY,
    topRadius,
    radialSegments,
    primaryMat,
    accentMat
  );
  headGroup.name = 'Part_05_CrownFinial';
  headGroup.userData = { baseY: 0, explodeMultiplier: 1.65 };
  group.add(headGroup);

  return group;
}

function buildPieceHeadGeometry(
  spec: ChessPieceSpec,
  topY: number,
  topRadius: number,
  radialSegments: number,
  primaryMat: THREE.Material,
  accentMat: THREE.Material
): THREE.Group {
  const headGroup = new THREE.Group();
  const scale = spec.finialScale;
  const r = topRadius * scale;

  switch (spec.pieceType) {
    case 'king': {
      // Flared Imperial Crown Cup
      const crownGeo = new THREE.CylinderGeometry(
        r * 1.18,
        r * 0.78,
        0.55 * scale,
        radialSegments
      );
      const crownMesh = new THREE.Mesh(crownGeo, primaryMat);
      crownMesh.position.y = topY + 0.26 * scale;
      crownMesh.castShadow = true;
      headGroup.add(crownMesh);

      // Crown Jewels / Spires around perimeter
      const spireCount = Math.max(4, spec.crownPoints);
      const spireGeo = new THREE.ConeGeometry(0.065 * scale, 0.24 * scale, 8);
      for (let i = 0; i < spireCount; i++) {
        const theta = (i / spireCount) * Math.PI * 2;
        const spire = new THREE.Mesh(spireGeo, accentMat);
        spire.position.set(
          Math.cos(theta) * r * 1.08,
          topY + 0.62 * scale,
          Math.sin(theta) * r * 1.08
        );
        headGroup.add(spire);
      }

      // Sovereign Cross Finial (ExtrudeGeometry with Bevel)
      const crossShape = new THREE.Shape();
      const cw = 0.08 * scale;
      const ch = 0.28 * scale;
      crossShape.moveTo(-cw, -ch);
      crossShape.lineTo(cw, -ch);
      crossShape.lineTo(cw, -cw);
      crossShape.lineTo(ch * 0.85, -cw);
      crossShape.lineTo(ch * 0.85, cw);
      crossShape.lineTo(cw, cw);
      crossShape.lineTo(cw, ch);
      crossShape.lineTo(-cw, ch);
      crossShape.lineTo(-cw, cw);
      crossShape.lineTo(-ch * 0.85, cw);
      crossShape.lineTo(-ch * 0.85, -cw);
      crossShape.lineTo(-cw, -cw);
      crossShape.closePath();

      const crossGeo = new THREE.ExtrudeGeometry(crossShape, {
        depth: 0.09 * scale,
        bevelEnabled: true,
        bevelThickness: 0.02 * scale,
        bevelSize: 0.018 * scale,
        bevelSegments: 3,
      });
      crossGeo.center();
      const crossMesh = new THREE.Mesh(crossGeo, accentMat);
      crossMesh.position.y = topY + 0.88 * scale;
      crossMesh.castShadow = true;
      headGroup.add(crossMesh);
      break;
    }

    case 'queen': {
      // Domed Inner Tiara Cushion
      const domeGeo = new THREE.SphereGeometry(
        r * 0.92,
        radialSegments,
        Math.max(12, Math.floor(radialSegments / 2))
      );
      const domeMesh = new THREE.Mesh(domeGeo, primaryMat);
      domeMesh.position.y = topY + 0.18 * scale;
      domeMesh.scale.set(1, 0.78, 1);
      headGroup.add(domeMesh);

      // Coronet Spikes + Pearl Tips
      const points = Math.max(5, spec.crownPoints);
      const spikeGeo = new THREE.ConeGeometry(0.075 * scale, 0.36 * scale, 10);
      const pearlGeo = new THREE.SphereGeometry(0.042 * scale, 12, 12);

      for (let i = 0; i < points; i++) {
        const theta = (i / points) * Math.PI * 2;
        const rad = r * 0.94;
        const spike = new THREE.Mesh(spikeGeo, accentMat);
        spike.position.set(
          Math.cos(theta) * rad,
          topY + 0.35 * scale,
          Math.sin(theta) * rad
        );
        spike.rotation.z = -Math.cos(theta) * 0.22;
        spike.rotation.x = Math.sin(theta) * 0.22;
        headGroup.add(spike);

        const pearl = new THREE.Mesh(pearlGeo, primaryMat);
        pearl.position.set(
          Math.cos(theta) * (rad * 1.08),
          topY + 0.54 * scale,
          Math.sin(theta) * (rad * 1.08)
        );
        headGroup.add(pearl);
      }

      // Sovereign Top Finial Pearl
      const topOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.11 * scale, 16, 16),
        accentMat
      );
      topOrb.position.y = topY + 0.58 * scale;
      headGroup.add(topOrb);
      break;
    }

    case 'bishop': {
      // Mitre Head with sculpted gothic taper
      const mitrePts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const mr = Math.sin(t * Math.PI) * r * 0.95 * (1 - t * 0.25);
        mitrePts.push(new THREE.Vector2(Math.max(0.01, mr), t * 0.68 * scale));
      }
      const mitreGeo = new THREE.LatheGeometry(mitrePts, radialSegments);
      const mitreMesh = new THREE.Mesh(mitreGeo, primaryMat);
      mitreMesh.position.y = topY - 0.04;
      mitreMesh.castShadow = true;
      headGroup.add(mitreMesh);

      // Diagonal Mitre Sash / Engraving Band
      const bandGeo = new THREE.TorusGeometry(r * 0.74, 0.035 * scale, 10, radialSegments);
      const bandMesh = new THREE.Mesh(bandGeo, accentMat);
      bandMesh.position.y = topY + 0.32 * scale;
      bandMesh.rotation.x = Math.PI / 2 + 0.42;
      headGroup.add(bandMesh);

      // Top Finial Orb
      const finialOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.095 * scale, 16, 16),
        accentMat
      );
      finialOrb.position.y = topY + 0.68 * scale;
      headGroup.add(finialOrb);
      break;
    }

    case 'knight': {
      // Sculpted Multi-Part Warhorse Bust (ExtrudeGeometry Silhouette + Armored Mane + Ears)
      const horseShape = new THREE.Shape();
      const s = 0.55 * scale;
      horseShape.moveTo(-0.55 * s, 0);
      horseShape.bezierCurveTo(-0.72 * s, 0.45 * s, -0.68 * s, 1.15 * s, -0.25 * s, 1.55 * s); // Arched back mane
      horseShape.lineTo(-0.18 * s, 1.82 * s); // Alert ear tip
      horseShape.lineTo(0.02 * s, 1.62 * s);  // Forehead crest
      horseShape.lineTo(0.68 * s, 1.12 * s);  // Muzzle bridge
      horseShape.lineTo(0.58 * s, 0.78 * s);  // Nostril / jaw tip
      horseShape.lineTo(0.18 * s, 0.85 * s);  // Jawline
      horseShape.bezierCurveTo(0.32 * s, 0.48 * s, 0.45 * s, 0.22 * s, 0.48 * s, 0); // Chest
      horseShape.closePath();

      const extrudeSettings = {
        steps: 2,
        depth: 0.38 * scale,
        bevelEnabled: true,
        bevelThickness: 0.08 * scale,
        bevelSize: 0.06 * scale,
        bevelSegments: spec.lod === 'LOD0' ? 5 : 2,
      };
      const knightGeo = new THREE.ExtrudeGeometry(horseShape, extrudeSettings);
      knightGeo.translate(0, 0, -0.19 * scale);
      knightGeo.computeVertexNormals();

      const knightMesh = new THREE.Mesh(knightGeo, primaryMat);
      knightMesh.position.y = topY - 0.05;
      knightMesh.castShadow = true;
      headGroup.add(knightMesh);

      // Armored Mane Plates along spine
      const plateCount = Math.max(4, Math.min(8, spec.crownPoints));
      const plateGeo = new THREE.BoxGeometry(0.12 * scale, 0.14 * scale, 0.44 * scale);
      for (let i = 0; i < plateCount; i++) {
        const t = i / (plateCount - 1);
        const plate = new THREE.Mesh(plateGeo, accentMat);
        plate.position.set(
          (-0.34 + t * 0.12) * scale,
          topY + (0.14 + t * 0.65) * scale,
          0
        );
        plate.rotation.z = -0.35 + t * 0.5;
        headGroup.add(plate);
      }
      break;
    }

    case 'rook': {
      // Turret Parapet Drum
      const drumGeo = new THREE.CylinderGeometry(
        r * 1.12,
        r * 0.96,
        0.44 * scale,
        radialSegments
      );
      const drumMesh = new THREE.Mesh(drumGeo, primaryMat);
      drumMesh.position.y = topY + 0.2 * scale;
      drumMesh.castShadow = true;
      headGroup.add(drumMesh);

      // Castellated Merlon Battlements around top rim
      const merlonCount = Math.max(4, Math.min(12, spec.crownPoints));
      const merlonGeo = new THREE.BoxGeometry(
        0.18 * scale,
        0.22 * scale,
        0.14 * scale
      );
      for (let i = 0; i < merlonCount; i++) {
        const theta = (i / merlonCount) * Math.PI * 2;
        const merlon = new THREE.Mesh(merlonGeo, accentMat);
        merlon.position.set(
          Math.cos(theta) * r * 0.98,
          topY + 0.48 * scale,
          Math.sin(theta) * r * 0.98
        );
        merlon.rotation.y = -theta + Math.PI / 2;
        merlon.castShadow = true;
        headGroup.add(merlon);
      }
      break;
    }

    case 'pawn':
    default: {
      // Classic Tournament Pawn Sphere + Collar Ring
      const orbGeo = new THREE.SphereGeometry(
        r * 0.92,
        radialSegments,
        Math.max(16, Math.floor(radialSegments / 2))
      );
      const orbMesh = new THREE.Mesh(orbGeo, primaryMat);
      orbMesh.position.y = topY + r * 0.82;
      orbMesh.castShadow = true;
      headGroup.add(orbMesh);

      const topCapGeo = new THREE.SphereGeometry(0.07 * scale, 12, 12);
      const topCap = new THREE.Mesh(topCapGeo, accentMat);
      topCap.position.y = topY + r * 1.72;
      headGroup.add(topCap);
      break;
    }
  }

  return headGroup;
}

/**
 * Builds a complete 32-piece tournament chessboard scene group using the active
 * architectural style & material settings so users can inspect full-set scale harmony.
 */
export function buildTournamentBoardSetGroup(
  activeSpec: ChessPieceSpec,
  maxAnisotropy = 4
): THREE.Group {
  const boardGroup = new THREE.Group();
  boardGroup.name = 'GMF_Tournament_Board_Preview';

  const tileSize = 1.65;
  const boardSpan = tileSize * 8;

  // Border Frame
  const frameGeo = new THREE.BoxGeometry(boardSpan + 1.2, 0.36, boardSpan + 1.2);
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e1b18,
    roughness: 0.35,
    metalness: 0.15,
    clearcoat: 0.6,
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.y = -0.19;
  frameMesh.receiveShadow = true;
  boardGroup.add(frameMesh);

  // Instanced 64 Squares (32 Light + 32 Dark)
  const tileGeo = new THREE.BoxGeometry(tileSize * 0.98, 0.08, tileSize * 0.98);
  const lightTileMat = new THREE.MeshPhysicalMaterial({
    color: 0xd6cfc2,
    roughness: 0.25,
    metalness: 0.05,
    clearcoat: 0.5,
  });
  const darkTileMat = new THREE.MeshPhysicalMaterial({
    color: 0x222630,
    roughness: 0.22,
    metalness: 0.2,
    clearcoat: 0.7,
  });

  const lightTiles = new THREE.InstancedMesh(tileGeo, lightTileMat, 32);
  const darkTiles = new THREE.InstancedMesh(tileGeo, darkTileMat, 32);
  lightTiles.receiveShadow = true;
  darkTiles.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let lIdx = 0;
  let dIdx = 0;
  const startOffset = -boardSpan / 2 + tileSize / 2;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      dummy.position.set(
        startOffset + col * tileSize,
        -0.02,
        startOffset + row * tileSize
      );
      dummy.updateMatrix();
      if ((row + col) % 2 === 0) {
        lightTiles.setMatrixAt(lIdx++, dummy.matrix);
      } else {
        darkTiles.setMatrixAt(dIdx++, dummy.matrix);
      }
    }
  }
  lightTiles.instanceMatrix.needsUpdate = true;
  darkTiles.instanceMatrix.needsUpdate = true;
  lightTiles.computeBoundingSphere();
  darkTiles.computeBoundingSphere();
  boardGroup.add(lightTiles, darkTiles);

  // Place Representative Back Rank + Pawns for both sides using LOD2 for smooth framerate
  const backRankOrder: ChessPieceType[] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ];

  const whiteSetMat = new THREE.MeshStandardMaterial({
    color: 0xe8dcc8,
    roughness: 0.28,
    metalness: 0.15,
  });
  const blackSetMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f27,
    roughness: 0.22,
    metalness: 0.35,
  });
  const goldAccentMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.25,
    metalness: 0.8,
  });

  const pieceCache = new Map<string, THREE.Group>();
  const getTemplatePiece = (type: ChessPieceType, isWhite: boolean) => {
    const key = `${type}_${isWhite ? 'W' : 'B'}`;
    if (!pieceCache.has(key)) {
      const pieceSpec: ChessPieceSpec = {
        ...createDefaultPieceSpec(type, activeSpec.style, activeSpec.materialId, 'LOD2'),
        flutingCount: 0,
        collarRings: 1,
      };
      const built = buildProceduralChessPieceGroup(pieceSpec, {
        maxAnisotropy,
        isWhiteSide: isWhite,
        sharedPrimaryMat: isWhite ? whiteSetMat : blackSetMat,
        sharedAccentMat: goldAccentMat,
      });
      built.scale.setScalar(0.56);
      pieceCache.set(key, built);
    }
    return pieceCache.get(key)!.clone();
  };

  for (let col = 0; col < 8; col++) {
    const x = startOffset + col * tileSize;

    // White Back Rank (row 7) & White Pawns (row 6)
    const wBack = getTemplatePiece(backRankOrder[col], true);
    wBack.position.set(x, 0.02, startOffset + 7 * tileSize);
    wBack.rotation.y = -Math.PI / 2;
    boardGroup.add(wBack);

    const wPawn = getTemplatePiece('pawn', true);
    wPawn.position.set(x, 0.02, startOffset + 6 * tileSize);
    boardGroup.add(wPawn);

    // Black Back Rank (row 0) & Black Pawns (row 1)
    const bBack = getTemplatePiece(backRankOrder[col], false);
    bBack.position.set(x, 0.02, startOffset + 0 * tileSize);
    bBack.rotation.y = Math.PI / 2;
    boardGroup.add(bBack);

    const bPawn = getTemplatePiece('pawn', false);
    bPawn.position.set(x, 0.02, startOffset + 1 * tileSize);
    boardGroup.add(bPawn);
  }

  return boardGroup;
}

/**
 * Exports a Three.js Object3D hierarchy directly to a downloadable binary `.glb`
 * file for immediate drag-and-drop into Blender, Unity, or Unreal Engine 5.
 */
export function exportGroupToGLB(
  object3d: THREE.Object3D,
  filename: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      object3d,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          triggerBrowserDownload(blob, filename.endsWith('.glb') ? filename : `${filename}.glb`);
          resolve(result.byteLength);
        } else {
          const jsonStr = JSON.stringify(result, null, 2);
          const blob = new Blob([jsonStr], { type: 'model/gltf+json' });
          triggerBrowserDownload(blob, filename.replace(/\.glb$/, '.gltf'));
          resolve(jsonStr.length);
        }
      },
      (err) => reject(err),
      { binary: true }
    );
  });
}

/**
 * Exports a Three.js Object3D hierarchy directly to a Wavefront `.obj` mesh file.
 */
export function exportGroupToOBJ(object3d: THREE.Object3D, filename: string): number {
  const exporter = new OBJExporter();
  const objText = exporter.parse(object3d);
  const blob = new Blob([objText], { type: 'text/plain;charset=utf-8' });
  triggerBrowserDownload(blob, filename.endsWith('.obj') ? filename : `${filename}.obj`);
  return objText.length;
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
