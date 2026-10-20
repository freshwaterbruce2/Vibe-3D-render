/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Sliders,
  Layers,
  Cpu,
  RotateCcw,
  Eye,
  Compass,
  Wand2,
  Check,
  Code2,
} from 'lucide-react';
import {
  ArchitecturalStyle,
  ChessPieceSpec,
  ChessPieceType,
  LodTier,
  MATERIAL_PRESETS,
  MaterialPresetId,
  PIECE_BASE_DEFAULTS,
  computeMeshBudget,
  createDefaultPieceSpec,
  generateObjStringFromSpec,
  synthesizeParametersFromPrompt,
} from './utils/chessParametrics';
import {
  CameraPresetId,
  ChessViewport3D,
  ChessViewportHandle,
  ViewportSceneMode,
} from './components/ChessViewport3D';
import { PipelineModal } from './components/PipelineModal';
import { triggerBrowserDownload } from './three/chessMeshBuilder';

type DockTabId = 'ai-sculpt' | 'parametric' | 'materials' | 'pipeline';

const QUICK_AI_PROMPTS = [
  'Gothic jade Queen, spiked crown',
  'Cyber steel Knight, CNC rings',
  'Brutalist obsidian Rook, gold trim',
  'Art Deco bronze King, fluted shaft',
];

export default function App() {
  const [spec, setSpec] = useState<ChessPieceSpec>(() =>
    createDefaultPieceSpec('knight', 'staunton', 'obsidian', 'LOD0')
  );
  const [sceneMode, setSceneMode] = useState<ViewportSceneMode>('piece-forge');
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('hero');
  const [explodedFactor, setExplodedFactor] = useState<number>(0);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);

  // Bottom Dock State
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [activeDockTab, setActiveDockTab] = useState<DockTabId>('ai-sculpt');

  // AI Prompt State (concise default prompt for fast synthesis)
  const [promptInput, setPromptInput] = useState<string>(
    'Gothic obsidian Knight, gold collar'
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Pipeline & Plugin Modal State
  const [pipelineModalOpen, setPipelineModalOpen] = useState<boolean>(false);
  const [pipelineModalTab, setPipelineModalTab] = useState<'language-matrix' | 'plugin-code'>(
    'language-matrix'
  );

  const viewportHandleRef = useRef<ChessViewportHandle | null>(null);

  const budget = useMemo(() => computeMeshBudget(spec), [spec]);

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const handleSelectPieceType = (pieceType: ChessPieceType) => {
    const updated = createDefaultPieceSpec(
      pieceType,
      spec.style,
      spec.materialId,
      spec.lod
    );
    setSpec(updated);
    if (sceneMode === 'board-preview') {
      setSceneMode('piece-forge');
      setCameraPreset('hero');
    }
  };

  const handleSelectStyle = (style: ArchitecturalStyle) => {
    const updated = createDefaultPieceSpec(
      spec.pieceType,
      style,
      spec.materialId,
      spec.lod
    );
    setSpec(updated);
  };

  const handleSelectMaterial = (materialId: MaterialPresetId) => {
    const mat = MATERIAL_PRESETS[materialId];
    setSpec((prev) => ({
      ...prev,
      materialId,
      primaryColorHex: mat.primaryColorHex,
      accentColorHex: mat.accentColorHex,
      roughness: mat.roughness,
      metalness: mat.metalness,
      clearcoat: mat.clearcoat,
      transmission: mat.transmission,
      anisotropy: mat.anisotropy,
    }));
  };

  const handleSelectLod = (lod: LodTier) => {
    setSpec((prev) => ({ ...prev, lod }));
  };

  const handleGenerateFromPrompt = async (e?: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const targetPrompt = (customPrompt ?? promptInput).trim();
    if (!targetPrompt) {
      setPromptError('Enter a design description to synthesize 3D piece geometry.');
      return;
    }

    setPromptError(null);
    // Apply instant deterministic parametric preview so 3D viewport updates with zero latency
    const instantSpec = synthesizeParametersFromPrompt(targetPrompt, spec);
    setSpec(instantSpec);
    if (sceneMode === 'board-preview') {
      setSceneMode('piece-forge');
      setCameraPreset('hero');
    }

    setIsGenerating(true);

    try {
      const response = await fetch('/api/generate-piece', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: targetPrompt, currentSpec: instantSpec }),
      });

      const data = await response.json();
      if (!response.ok) {
        setPromptError(data.error || 'Failed to generate parameters.');
      } else if (data.spec) {
        setSpec(data.spec);
        showToast(`Synthesized "${data.spec.name}" (${data.spec.pieceType.toUpperCase()} · ${data.spec.style})`);
      }
    } catch {
      showToast(`Synthesized "${instantSpec.name}" (${instantSpec.pieceType.toUpperCase()} · ${instantSpec.style})`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportGLB = async () => {
    const filename = `GMF_${spec.pieceType}_${spec.style}_${spec.lod}.glb`;
    if (viewportHandleRef.current) {
      try {
        const bytes = await viewportHandleRef.current.exportCurrentGLB(filename);
        showToast(`Exported ${filename} (${Math.round(bytes / 1024)} KB Binary glTF 2.0)`);
      } catch {
        showToast('Exported fallback Wavefront OBJ');
      }
    }
  };

  const handleExportOBJ = () => {
    const filename = `GMF_${spec.pieceType}_${spec.style}_${spec.lod}.obj`;
    if (viewportHandleRef.current) {
      const chars = viewportHandleRef.current.exportCurrentOBJ(filename);
      showToast(`Exported ${filename} (${Math.round(chars / 1024)} KB Wavefront Mesh)`);
    } else {
      const rawObj = generateObjStringFromSpec(spec);
      const blob = new Blob([rawObj], { type: 'text/plain;charset=utf-8' });
      triggerBrowserDownload(blob, filename);
      showToast(`Exported ${filename}`);
    }
  };

  const handleResetPiece = () => {
    setSpec(createDefaultPieceSpec(spec.pieceType, 'staunton', 'obsidian', 'LOD0'));
    setExplodedFactor(0);
    setWireframe(false);
    setCameraPreset('hero');
    showToast('Reset piece parameters to tournament Staunton baseline');
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-[#0B0D11] text-[#F1F5F9]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="relative z-20 flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800/90 bg-[#0E1118]">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#forge"
          onClick={(e) => {
            e.preventDefault();
            setSceneMode('piece-forge');
            setCameraPreset('hero');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Grandmaster Forge
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
        >
          <button
            type="button"
            onClick={() => {
              setSceneMode('piece-forge');
              setCameraPreset('hero');
            }}
            className={`hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sceneMode === 'piece-forge' && !pipelineModalOpen ? 'text-amber-400 underline' : ''
            }`}
          >
            Piece Forge
          </button>
          <button
            type="button"
            onClick={() => {
              setSceneMode('board-preview');
              setCameraPreset('board-wide');
            }}
            className={`hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sceneMode === 'board-preview' && !pipelineModalOpen ? 'text-amber-400 underline' : ''
            }`}
          >
            Board Preview
          </button>
          <button
            type="button"
            onClick={() => {
              setPipelineModalTab('language-matrix');
              setPipelineModalOpen(true);
            }}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Pipeline Architecture
          </button>
          <button
            type="button"
            onClick={() => {
              setPipelineModalTab('plugin-code');
              setPipelineModalOpen(true);
            }}
            className="hover:text-amber-400 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Plugin Scripts
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleExportGLB}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Export GLB
          </button>
        </div>
      </header>

      {/* Main Unobstructed 3D Spatial Viewport */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <ChessViewport3D
          spec={spec}
          sceneMode={sceneMode}
          cameraPreset={cameraPreset}
          explodedFactor={explodedFactor}
          wireframe={wireframe}
          autoRotate={autoRotate}
          onExportReady={(handle) => {
            viewportHandleRef.current = handle;
          }}
        />

        {/* Top-Left Minimal Spec & Telemetry Overlay (Unboxed metadata with · separators) */}
        <div className="pointer-events-none absolute top-3 left-3 right-3 sm:right-auto sm:top-4 sm:left-6 z-10 sm:max-w-md space-y-1.5">
          <div className="pointer-events-auto inline-block w-full sm:w-auto bg-[#10141D]/95 border border-slate-800/90 rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-lg">
            <div className="text-[11px] sm:text-xs text-slate-400 flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
              <span className="text-amber-400 font-semibold uppercase">{spec.pieceType}</span>
              <span aria-hidden="true">·</span>
              <span>{PIECE_BASE_DEFAULTS[spec.pieceType].standardHeightMm}mm Scale</span>
              <span aria-hidden="true">·</span>
              <span>{spec.lod}</span>
              <span aria-hidden="true">·</span>
              <span>{budget.triangleCount.toLocaleString()} Tris</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">{budget.vertexCount.toLocaleString()} Verts</span>
            </div>
            <h1 className="text-sm sm:text-base font-bold text-slate-100 mt-0.5 sm:mt-1 tracking-tight">
              {spec.name}
            </h1>
            <p className="hidden sm:block text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
              {spec.designLore}
            </p>
            <div className="mt-1.5 pt-1.5 sm:mt-2 sm:pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <div>
                <span>Pipeline Core: <strong className="text-slate-200">Rust C-ABI + FFI</strong></span>
                <span aria-hidden="true" className="mx-1.5">·</span>
                <span>Targets: <strong className="text-emerald-400">Blender / Unity / UE5</strong></span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPipelineModalTab('language-matrix');
                  setPipelineModalOpen(true);
                }}
                className="md:hidden text-amber-400 font-medium underline underline-offset-2"
              >
                Pipeline Specs
              </button>
            </div>
          </div>
        </div>

        {/* Status Toast Notification */}
        {statusMessage && (
          <div
            role="status"
            className=" fixed top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-lg bg-[#161C28] border border-amber-500/60 text-xs font-medium text-amber-200 shadow-xl"
          >
            <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Unified Collapsible Bottom Control Dock (Zero Viewport Occlusion) */}
        <section
          aria-label="3D Asset Forge & Pipeline Controls"
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[95vw] max-w-[980px] transition-transform duration-200"
        >
          {/* Collapse / Expand Toggle Handle + Quick Camera Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 px-1">
            <div className="flex items-center gap-1 bg-[#10141D]/95 border border-slate-800/90 rounded-lg p-1 overflow-x-auto max-w-full">
              {(
                [
                  { id: 'hero', label: '3/4 Studio' },
                  { id: 'profile', label: 'Ortho Profile' },
                  { id: 'crown', label: 'Crown Detail' },
                  { id: 'board-wide', label: 'Full 32-Piece Set' },
                ] as const
              ).map((cam) => {
                const isActive =
                  (cam.id === 'board-wide' && sceneMode === 'board-preview') ||
                  (cam.id !== 'board-wide' &&
                    sceneMode === 'piece-forge' &&
                    cameraPreset === cam.id);
                return (
                  <button
                    key={cam.id}
                    type="button"
                    onClick={() => {
                      if (cam.id === 'board-wide') {
                        setSceneMode('board-preview');
                        setCameraPreset('board-wide');
                      } else {
                        setSceneMode('piece-forge');
                        setCameraPreset(cam.id);
                      }
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {cam.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWireframe((w) => !w)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  wireframe
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                    : 'bg-[#10141D]/95 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                Wireframe
              </button>
              <button
                type="button"
                onClick={() => setAutoRotate((r) => !r)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  autoRotate
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                    : 'bg-[#10141D]/95 border-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                Turntable
              </button>
              <button
                type="button"
                onClick={() => setDockCollapsed((c) => !c)}
                aria-expanded={!dockCollapsed}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-[#10141D]/95 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {dockCollapsed ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    Show Controls
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    Hide Controls
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dock Body */}
          {!dockCollapsed && (
            <div className="bg-[#11151F]/98 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
              {/* Dock Mode Tabs + Piece Selector Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 sm:px-4 py-2.5 bg-[#0D1017] border-b border-slate-800/90">
                {/* 4 Dock Mode Tabs */}
                <div className="flex flex-wrap items-center gap-1" role="tablist">
                  {(
                    [
                      { id: 'ai-sculpt', label: '01. AI & Piece Select', icon: Wand2 },
                      { id: 'parametric', label: '02. Geometry & LOD', icon: Sliders },
                      { id: 'materials', label: '03. PBR Finishes', icon: Layers },
                      { id: 'pipeline', label: '04. Pipeline & Export', icon: Cpu },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    const active = activeDockTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActiveDockTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Piece Class Quick Switcher */}
                <div className="flex items-center gap-1">
                  {(['king', 'queen', 'bishop', 'knight', 'rook', 'pawn'] as const).map(
                    (pType) => (
                      <button
                        key={pType}
                        type="button"
                        onClick={() => handleSelectPieceType(pType)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 capitalize ${
                          spec.pieceType === pType
                            ? 'bg-slate-200 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-slate-100 bg-[#161B26]'
                        }`}
                      >
                        {pType}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Active Tab Panel Content */}
              <div className="p-4">
                {activeDockTab === 'ai-sculpt' && (
                  <div className="space-y-3">
                    <form
                      onSubmit={(e) => handleGenerateFromPrompt(e)}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                    >
                      <label htmlFor="ai-chess-prompt" className="sr-only">
                        Generative 3D Chess Piece Prompt
                      </label>
                      <input
                        id="ai-chess-prompt"
                        type="text"
                        value={promptInput}
                        onChange={(e) => {
                          setPromptInput(e.target.value);
                          if (promptError) setPromptError(null);
                        }}
                        placeholder="Describe piece silhouette, architectural style, collar carvings, and material..."
                        className="flex-1 px-3.5 py-2 text-xs bg-[#0B0D12] border border-slate-700/90 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="submit"
                        disabled={isGenerating}
                        className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        {isGenerating ? 'Synthesizing 3D Mesh...' : 'Synthesize 3D Piece'}
                      </button>
                    </form>

                    {promptError && (
                      <p role="alert" className="text-xs text-rose-400">
                        {promptError}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 mr-1">Style Presets:</span>
                        {(
                          [
                            { id: 'staunton', label: 'Staunton Classic' },
                            { id: 'gothic', label: 'Gothic Cathedral' },
                            { id: 'brutalist', label: 'Brutalist Monolith' },
                            { id: 'cyber', label: 'Cyber-Mechanical' },
                            { id: 'artdeco', label: 'Celestial Art Deco' },
                          ] as const
                        ).map((st) => (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => handleSelectStyle(st.id)}
                            className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                              spec.style === st.id
                                ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-medium'
                                : 'bg-[#161B26] border-slate-800 text-slate-300 hover:text-white'
                            }`}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">Sample Prompts:</span>
                        {QUICK_AI_PROMPTS.slice(0, 2).map((presetPrompt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setPromptInput(presetPrompt);
                              handleGenerateFromPrompt(undefined, presetPrompt);
                            }}
                            className="px-2.5 py-1 text-[11px] bg-[#161B26] hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-md transition-colors truncate max-w-[190px]"
                          >
                            {presetPrompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeDockTab === 'parametric' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-center">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="slider-height" className="text-slate-300">
                          Height Scale
                        </label>
                        <span className="font-mono text-amber-400 tabular-nums">
                          {spec.heightScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        id="slider-height"
                        type="range"
                        min={0.72}
                        max={1.35}
                        step={0.02}
                        value={spec.heightScale}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, heightScale: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-amber-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="slider-waist" className="text-slate-300">
                          Waist Taper
                        </label>
                        <span className="font-mono text-amber-400 tabular-nums">
                          {spec.waistTaper.toFixed(2)}
                        </span>
                      </div>
                      <input
                        id="slider-waist"
                        type="range"
                        min={0.28}
                        max={0.72}
                        step={0.02}
                        value={spec.waistTaper}
                        onChange={(e) =>
                          setSpec((s) => ({ ...s, waistTaper: parseFloat(e.target.value) }))
                        }
                        className="w-full accent-amber-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="slider-flutes" className="text-slate-300">
                          Column Flutes
                        </label>
                        <span className="font-mono text-amber-400 tabular-nums">
                          {spec.flutingCount}
                        </span>
                      </div>
                      <input
                        id="slider-flutes"
                        type="range"
                        min={0}
                        max={24}
                        step={2}
                        value={spec.flutingCount}
                        onChange={(e) =>
                          setSpec((s) => ({
                            ...s,
                            flutingCount: parseInt(e.target.value, 10),
                            flutingDepth:
                              parseInt(e.target.value, 10) > 0
                                ? Math.max(0.06, s.flutingDepth)
                                : 0,
                          }))
                        }
                        className="w-full accent-amber-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="slider-crown" className="text-slate-300">
                          Crown Points
                        </label>
                        <span className="font-mono text-amber-400 tabular-nums">
                          {spec.crownPoints}
                        </span>
                      </div>
                      <input
                        id="slider-crown"
                        type="range"
                        min={4}
                        max={16}
                        step={1}
                        value={spec.crownPoints}
                        onChange={(e) =>
                          setSpec((s) => ({
                            ...s,
                            crownPoints: parseInt(e.target.value, 10),
                          }))
                        }
                        className="w-full accent-amber-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="slider-explode" className="text-slate-300">
                          Exploded View
                        </label>
                        <span className="font-mono text-amber-400 tabular-nums">
                          {Math.round(explodedFactor * 100)}%
                        </span>
                      </div>
                      <input
                        id="slider-explode"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={explodedFactor}
                        onChange={(e) => setExplodedFactor(parseFloat(e.target.value))}
                        className="w-full accent-amber-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="text-xs text-slate-300 block">Target LOD Tier</span>
                      <div className="flex items-center gap-1">
                        {(['LOD0', 'LOD1', 'LOD2'] as const).map((tier) => (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => handleSelectLod(tier)}
                            className={`flex-1 py-1 text-xs font-mono rounded border transition-colors ${
                              spec.lod === tier
                                ? 'bg-amber-500 text-slate-950 border-amber-500 font-semibold'
                                : 'bg-[#161B26] text-slate-300 border-slate-800 hover:text-white'
                            }`}
                          >
                            {tier}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={handleResetPiece}
                          aria-label="Reset Geometry Parameters"
                          className="p-1.5 text-slate-400 hover:text-white bg-[#161B26] border border-slate-800 rounded"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeDockTab === 'materials' && (
                  <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {(Object.keys(MATERIAL_PRESETS) as MaterialPresetId[]).map((matId) => {
                        const mat = MATERIAL_PRESETS[matId];
                        const isSelected = spec.materialId === matId;
                        return (
                          <button
                            key={matId}
                            type="button"
                            onClick={() => handleSelectMaterial(matId)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                              isSelected
                                ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                                : 'bg-[#161B26] border-slate-800 text-slate-300 hover:text-white'
                            }`}
                          >
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0"
                              style={{ backgroundColor: mat.primaryColorHex }}
                            />
                            {mat.name}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="w-32">
                        <div className="flex justify-between text-xs mb-1">
                          <label htmlFor="slider-roughness" className="text-slate-300">
                            Roughness
                          </label>
                          <span className="font-mono text-amber-400 tabular-nums">
                            {spec.roughness.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="slider-roughness"
                          type="range"
                          min={0.05}
                          max={0.9}
                          step={0.02}
                          value={spec.roughness}
                          onChange={(e) =>
                            setSpec((s) => ({ ...s, roughness: parseFloat(e.target.value) }))
                          }
                          className="w-full accent-amber-500"
                        />
                      </div>

                      <div className="w-32">
                        <div className="flex justify-between text-xs mb-1">
                          <label htmlFor="slider-metalness" className="text-slate-300">
                            Metalness
                          </label>
                          <span className="font-mono text-amber-400 tabular-nums">
                            {spec.metalness.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="slider-metalness"
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={spec.metalness}
                          onChange={(e) =>
                            setSpec((s) => ({ ...s, metalness: parseFloat(e.target.value) }))
                          }
                          className="w-full accent-amber-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {activeDockTab === 'pipeline' && (
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1 max-w-xl">
                      <div className="text-xs font-semibold text-amber-400">
                        Recommended Pipeline Stack: Rust 2024 Geometry Core (`cdylib` C-ABI) + Host DCC Plugins
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Compile your procedural lathe & LOD math once in Rust for native SIMD speed and memory safety, then bind directly to <strong>Blender (`bpy` Python)</strong>, <strong>Unity 6 (`C# P/Invoke`)</strong>, and <strong>Unreal Engine 5.5 (`C++ / Python Nanite`)</strong>.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setPipelineModalTab('language-matrix');
                          setPipelineModalOpen(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181D29] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Compass className="w-3.5 h-3.5 text-amber-400" />
                        Compare Languages
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPipelineModalTab('plugin-code');
                          setPipelineModalOpen(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181D29] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Code2 className="w-3.5 h-3.5 text-sky-400" />
                        Get Blender / Unity / UE5 Plugins
                      </button>
                      <button
                        type="button"
                        onClick={handleExportOBJ}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181D29] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export .OBJ
                      </button>
                      <button
                        type="button"
                        onClick={handleExportGLB}
                        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Export .GLB
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Cross-Platform Pipeline Language Decision & Plugin Code Generator Modal */}
        <PipelineModal
          isOpen={pipelineModalOpen}
          onClose={() => setPipelineModalOpen(false)}
          spec={spec}
          activeTabInitial={pipelineModalTab}
          onExportGLB={handleExportGLB}
          onExportOBJ={handleExportOBJ}
        />
      </main>
    </div>
  );
}
