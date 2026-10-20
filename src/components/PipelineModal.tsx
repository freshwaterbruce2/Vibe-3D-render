import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Terminal,
  Cpu,
  Layers,
  ShieldCheck,
  X,
  FileCode,
  Box,
} from 'lucide-react';
import {
  ChessPieceSpec,
  PIPELINE_ARCHITECTURES,
  PipelineLanguageId,
  TargetEngineId,
  computeMeshBudget,
  generateBlenderPluginScript,
  generateUnityImporterScript,
  generateUnrealInterchangeScript,
  generateRustCorePipelineCode,
} from '../utils/chessParametrics';
import { triggerBrowserDownload } from '../three/chessMeshBuilder';

interface PipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  spec: ChessPieceSpec;
  activeTabInitial?: 'language-matrix' | 'plugin-code';
  onExportGLB: () => void;
  onExportOBJ: () => void;
}

export const PipelineModal: React.FC<PipelineModalProps> = ({
  isOpen,
  onClose,
  spec,
  activeTabInitial = 'language-matrix',
  onExportGLB,
  onExportOBJ,
}) => {
  const [modalSection, setModalSection] = useState<'language-matrix' | 'plugin-code'>(
    activeTabInitial
  );
  const [selectedArch, setSelectedArch] = useState<PipelineLanguageId>('rust-ffi');
  const [selectedEngine, setSelectedEngine] = useState<TargetEngineId>('blender');
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setModalSection(activeTabInitial);
    }
  }, [isOpen, activeTabInitial]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const budget = computeMeshBudget(spec);
  const activeArch =
    PIPELINE_ARCHITECTURES.find((a) => a.id === selectedArch) ?? PIPELINE_ARCHITECTURES[0];

  const getCodeAndFilename = (): { code: string; filename: string; langLabel: string } => {
    switch (selectedEngine) {
      case 'blender':
        return {
          code: generateBlenderPluginScript(spec),
          filename: `gmf_blender_${spec.pieceType}_${spec.lod}.py`,
          langLabel: 'Python 3.11 (Blender 4.x bpy + bmesh)',
        };
      case 'unity':
        return {
          code: generateUnityImporterScript(spec),
          filename: `GrandmasterForge_${spec.pieceType}_Postprocessor.cs`,
          langLabel: 'C# (.NET Standard 2.1 / Unity 6 AssetPostprocessor)',
        };
      case 'unreal':
        return {
          code: generateUnrealInterchangeScript(spec),
          filename: `import_gmf_${spec.pieceType}_nanite.py`,
          langLabel: 'Python / C++ Bridge (Unreal Engine 5.5 Nanite Pipeline)',
        };
      case 'rust-core':
        return {
          code: generateRustCorePipelineCode(spec),
          filename: `lib_gmf_${spec.pieceType}_core.rs`,
          langLabel: 'Rust 2024 (cdylib C-ABI FFI Shared Kernel)',
        };
    }
  };

  const { code, filename, langLabel } = getCodeAndFilename();

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback copy
    }
  };

  const handleDownloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    triggerBrowserDownload(blob, filename);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pipeline-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex flex-col w-full max-w-5xl max-h-[88vh] bg-[#12161F] border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-[#0E1118]">
          <div>
            <h2
              id="pipeline-modal-title"
              className="text-base sm:text-lg font-bold text-slate-100 tracking-tight"
            >
              3D Pipeline Language Architecture & Custom DCC Plugins
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Target Asset: <span className="text-amber-400 font-medium">{spec.name}</span> ·{' '}
              <span className="font-mono tabular-nums">{budget.triangleCount.toLocaleString()} tris</span> ·{' '}
              <span className="font-mono tabular-nums">{spec.lod}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center bg-[#181D29] p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setModalSection('language-matrix')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  modalSection === 'language-matrix'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                01. Pipeline Language Decision
              </button>
              <button
                type="button"
                onClick={() => setModalSection('plugin-code')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  modalSection === 'plugin-code'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                02. Custom Plugin Generator
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Pipeline Modal"
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/70 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {modalSection === 'language-matrix' ? (
            <>
              {/* Executive Architecture Recommendation Banner */}
              <div className="p-4 sm:p-5 rounded-xl bg-[#171C28] border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm sm:text-base font-semibold text-amber-400">
                    Why Extending Existing Tools (Blender + Unity + Unreal) with a Hybrid Rust + Python/C#/C++ Pipeline Wins
                  </h3>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    Zero Engine Lock-In · Single Geometry Source of Truth
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Building a standalone 3D DCC from scratch requires replicating decades of UV unwrapping, subdivision modifiers, and FBX/glTF/USD exporters. Instead, the optimal production architecture separates the pipeline into two layers: a <strong>high-performance core geometry kernel in Rust (compiled to a C-ABI shared library & WebAssembly)</strong> paired with <strong>thin host-native plugins</strong> (<strong>Python bpy</strong> for Blender, <strong>C# AssetPostprocessor</strong> for Unity, and <strong>C++/Python Interchange</strong> for Unreal Engine 5).
                </p>
              </div>

              {/* Language Architecture Selector Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {PIPELINE_ARCHITECTURES.map((arch) => {
                  const isSelected = arch.id === selectedArch;
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      onClick={() => setSelectedArch(arch.id)}
                      className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between ${
                        isSelected
                          ? 'bg-[#1B2230] border-amber-500/80 shadow-lg'
                          : 'bg-[#141822] border-slate-800/90 hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-amber-400">
                            {arch.recommended ? 'RECOMMENDED ARCHITECTURE' : 'ALTERNATIVE STACK'}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-slate-100 leading-snug">
                          {arch.title}
                        </h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {arch.tagline}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-500 block">Throughput</span>
                          <span className="font-mono text-slate-200 tabular-nums">
                            {arch.meshEvalThroughput}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Portability</span>
                          <span className="font-mono text-emerald-400 tabular-nums">
                            {arch.crossPlatformScore.split(' ')[0]}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Detailed Breakdown of Selected Language Architecture */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-5 rounded-xl bg-[#141822] border border-slate-800">
                <div className="lg:col-span-7 space-y-4">
                  <div>
                    <h4 className="text-base font-semibold text-white">
                      {activeArch.title}
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Core Kernel: <span className="text-slate-200 font-mono">{activeArch.coreLanguage}</span> · Host Bindings: <span className="text-slate-200 font-mono">{activeArch.pluginBindings}</span>
                    </p>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    {activeArch.rationale}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-emerald-400">
                        Engineering Advantages
                      </h5>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {activeArch.pros.map((pro, i) => (
                          <li key={i} className="leading-relaxed">
                            · {pro}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <h5 className="text-xs font-semibold text-amber-400">
                        Integration Trade-offs
                      </h5>
                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {activeArch.tradeoffs.map((con, i) => (
                          <li key={i} className="leading-relaxed">
                            · {con}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Host Role Mapping Table */}
                <div className="lg:col-span-5 flex flex-col justify-between bg-[#0E1118] p-4 rounded-lg border border-slate-800/90 space-y-4">
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-slate-200">
                      Recommended Language Per Pipeline Stage
                    </h5>
                    <div className="space-y-2.5 text-xs">
                      <div className="p-2.5 rounded bg-[#151924] border border-slate-800/70">
                        <div className="flex justify-between font-medium text-slate-100">
                          <span>1. Core Mesh & LOD Kernel</span>
                          <span className="font-mono text-amber-400">Rust (C-ABI / WASM)</span>
                        </div>
                        <p className="text-slate-400 mt-1">
                          Evaluates axisymmetric lathe profiles, fluting booleans, and MikkTSpace tangents at 1.4M tris/sec.
                        </p>
                      </div>
                      <div className="p-2.5 rounded bg-[#151924] border border-slate-800/70">
                        <div className="flex justify-between font-medium text-slate-100">
                          <span>2. Blender 4.x Refinement Plugin</span>
                          <span className="font-mono text-sky-400">Python 3.11 (bpy + PyO3)</span>
                        </div>
                        <p className="text-slate-400 mt-1">
                          Native access to `bmesh`, Subdivision Surface modifiers, and Principled BSDF shader nodes.
                        </p>
                      </div>
                      <div className="p-2.5 rounded bg-[#151924] border border-slate-800/70">
                        <div className="flex justify-between font-medium text-slate-100">
                          <span>3. Unity 6 Editor Integration</span>
                          <span className="font-mono text-emerald-400">C# (AssetPostprocessor)</span>
                        </div>
                        <p className="text-slate-400 mt-1">
                          Automates URP/HDRP material binding, convex MeshColliders, and 3-tier LODGroup prefabs.
                        </p>
                      </div>
                      <div className="p-2.5 rounded bg-[#151924] border border-slate-800/70">
                        <div className="flex justify-between font-medium text-slate-100">
                          <span>4. Unreal Engine 5.5 Pipeline</span>
                          <span className="font-mono text-purple-400">C++ / Python Interchange</span>
                        </div>
                        <p className="text-slate-400 mt-1">
                          Enables Nanite virtualized geometry, Lumen distance fields, and Material Instance Constants.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setModalSection('plugin-code')}
                    className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                  >
                    Inspect & Download Generated Plugin Code →
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Section 2: Custom Plugin & Script Generator */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { id: 'blender', label: 'Blender 4.x Python Add-on (.py)' },
                      { id: 'unity', label: 'Unity 6 C# Postprocessor (.cs)' },
                      { id: 'unreal', label: 'Unreal 5.5 Nanite Script (.py)' },
                      { id: 'rust-core', label: 'Rust C-ABI Kernel (lib.rs)' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSelectedEngine(tab.id)}
                      className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                        selectedEngine === tab.id
                          ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                          : 'bg-[#161B26] border-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#181D29] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied Script' : 'Copy Code'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCode}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    Download {filename}
                  </button>
                </div>
              </div>

              <div className="rounded-xl overflow-hidden border border-slate-800 bg-[#0B0D12]">
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#121620] border-b border-slate-800 text-xs text-slate-400 font-mono">
                  <span>{filename}</span>
                  <span>{langLabel}</span>
                </div>
                <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-[420px] leading-relaxed">
                  <code>{code}</code>
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer with Direct 3D Mesh Exports */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 border-t border-slate-800 bg-[#0E1118]">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>Manifold Check: <strong className="text-emerald-400">Watertight</strong></span>
            <span>·</span>
            <span>UV Pack: <strong className="text-slate-200 tabular-nums">{budget.uvUtilizationPct}%</strong></span>
            <span>·</span>
            <span>VRAM Footprint: <strong className="text-slate-200 tabular-nums">{budget.estimatedVramKb} KB</strong></span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onExportOBJ}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#181D29] hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export Wavefront (.OBJ)
            </button>
            <button
              type="button"
              onClick={onExportGLB}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Box className="w-3.5 h-3.5" />
              Export Binary glTF 2.0 (.GLB)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
