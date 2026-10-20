import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultPieceSpec,
  computeLatheProfilePoints,
  computeMeshBudget,
  synthesizeParametersFromPrompt,
  generateBlenderPluginScript,
  generateUnityImporterScript,
  generateUnrealInterchangeScript,
  generateRustCorePipelineCode,
  generateObjStringFromSpec,
  PIPELINE_ARCHITECTURES,
} from './chessParametrics.ts';

test('createDefaultPieceSpec creates grounded tournament proportions for all 6 piece classes', () => {
  const pieces = ['king', 'queen', 'bishop', 'knight', 'rook', 'pawn'] as const;
  for (const p of pieces) {
    const spec = createDefaultPieceSpec(p, 'staunton', 'obsidian', 'LOD0');
    assert.equal(spec.pieceType, p);
    assert.ok(spec.heightScale >= 0.7 && spec.heightScale <= 1.35);
    assert.ok(spec.baseRadius >= 0.75 && spec.baseRadius <= 1.25);

    const pts = computeLatheProfilePoints(spec);
    assert.ok(pts.length >= 12, `Expected at least 12 profile points for ${p}`);
    assert.equal(pts[0].y, 0, `Piece ${p} must be grounded at y = 0`);
    assert.ok(pts[pts.length - 1].y > 1.5, `Piece ${p} must have positive height`);
  }
});

test('computeMeshBudget enforces strict polygon reduction across LOD0 > LOD1 > LOD2 and keeps LOD0 under 3,500 tris', () => {
  const knightLod0 = computeMeshBudget(createDefaultPieceSpec('knight', 'staunton', 'obsidian', 'LOD0'));
  assert.ok(
    knightLod0.triangleCount < 3500,
    `Expected Staunton Knight LOD0 (${knightLod0.triangleCount}) to be reduced below 3,500 triangles`
  );

  const lod0 = computeMeshBudget(createDefaultPieceSpec('queen', 'gothic', 'jade', 'LOD0'));
  const lod1 = computeMeshBudget(createDefaultPieceSpec('queen', 'gothic', 'jade', 'LOD1'));
  const lod2 = computeMeshBudget(createDefaultPieceSpec('queen', 'gothic', 'jade', 'LOD2'));

  assert.ok(
    lod0.triangleCount > lod1.triangleCount,
    `LOD0 (${lod0.triangleCount}) should have more triangles than LOD1 (${lod1.triangleCount})`
  );
  assert.ok(
    lod1.triangleCount > lod2.triangleCount,
    `LOD1 (${lod1.triangleCount}) should have more triangles than LOD2 (${lod2.triangleCount})`
  );
  assert.equal(lod0.manifoldValid, true);
  assert.equal(lod0.unityReady, true);
  assert.equal(lod0.unrealNaniteReady, true);
});

test('synthesizeParametersFromPrompt maps natural language prompts to domain-accurate parameters', () => {
  const base = createDefaultPieceSpec('pawn', 'staunton', 'boxwood', 'LOD0');
  const synthesized = synthesizeParametersFromPrompt(
    'Tall Gothic cathedral Queen in translucent emerald jade crystal with ornate spiked crown',
    base
  );

  assert.equal(synthesized.pieceType, 'queen');
  assert.equal(synthesized.style, 'gothic');
  assert.equal(synthesized.materialId, 'jade');
  assert.ok(synthesized.transmission > 0.5, 'Jade material should have optical transmission');
  assert.ok(synthesized.crownPoints >= 12, 'Spiked ornate prompt should increase crown points');
});

test('cross-platform plugin and Rust FFI generators emit valid target code and Wavefront OBJ geometry', () => {
  const spec = createDefaultPieceSpec('knight', 'cyber', 'damascus', 'LOD1');

  const blenderPy = generateBlenderPluginScript(spec);
  assert.ok(blenderPy.includes('import bpy'));
  assert.ok(blenderPy.includes('bmesh.ops.spin'));

  const unityCs = generateUnityImporterScript(spec);
  assert.ok(unityCs.includes('AssetPostprocessor'));
  assert.ok(unityCs.includes('Universal Render Pipeline/Lit'));

  const unrealPy = generateUnrealInterchangeScript(spec);
  assert.ok(unrealPy.includes('nanite_settings'));
  assert.ok(unrealPy.includes('unreal.AssetImportTask'));

  const rustRs = generateRustCorePipelineCode(spec);
  assert.ok(rustRs.includes('pub extern "C" fn gmf_evaluate_lathe_mesh'));

  const objData = generateObjStringFromSpec(spec);
  assert.ok(objData.includes('o GMF_knight_LOD1'));
  assert.ok(objData.includes('\nv '));
  assert.ok(objData.includes('\nf '));

  const recommended = PIPELINE_ARCHITECTURES.find((a) => a.recommended);
  assert.ok(recommended);
  assert.equal(recommended.id, 'rust-ffi');
});
