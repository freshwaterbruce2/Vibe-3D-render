import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  ChessPieceSpec,
  createDefaultPieceSpec,
  synthesizeParametersFromPrompt,
} from './src/utils/chessParametrics.ts';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  app.post('/api/generate-piece', async (req, res) => {
    const { prompt, currentSpec } = req.body as {
      prompt?: string;
      currentSpec?: ChessPieceSpec;
    };

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'Please provide a descriptive design prompt.' });
      return;
    }

    const baseSpec =
      currentSpec ?? createDefaultPieceSpec('knight', 'staunton', 'obsidian', 'LOD0');
    const fallbackSpec = synthesizeParametersFromPrompt(prompt, baseSpec);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.json({
        spec: fallbackSpec,
        source: 'parametric-engine',
        pipelineRecommendation:
          'Synthesized via deterministic parametric kernel. Ready for GLB/OBJ export and Blender/Unity/Unreal plugin generation.',
      });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Design a 3D chess piece spec for: "${prompt.slice(0, 120)}".`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are a Senior 3D Technical Artist specializing in procedural chess piece design for Blender, Unity, and Unreal Engine 5. Output strictly valid JSON matching the schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pieceType: {
                type: Type.STRING,
                description: 'One of: king, queen, bishop, knight, rook, pawn',
              },
              style: {
                type: Type.STRING,
                description: 'One of: staunton, gothic, brutalist, cyber, artdeco',
              },
              materialId: {
                type: Type.STRING,
                description: 'One of: boxwood, obsidian, damascus, jade, bronze',
              },
              name: {
                type: Type.STRING,
                description: 'Concise title-case asset name (max 38 chars)',
              },
              designLore: {
                type: Type.STRING,
                description: '1-2 sentence technical art description of the silhouette, carvings, and surface finish',
              },
              heightScale: {
                type: Type.NUMBER,
                description: 'Normalized height multiplier between 0.72 and 1.35',
              },
              baseRadius: {
                type: Type.NUMBER,
                description: 'Pedestal radius between 0.78 and 1.24',
              },
              waistTaper: {
                type: Type.NUMBER,
                description: 'Column waist ratio between 0.28 and 0.72',
              },
              collarRings: {
                type: Type.INTEGER,
                description: 'Turned collar ring count between 1 and 5',
              },
              flutingCount: {
                type: Type.INTEGER,
                description: 'Vertical column flute grooves between 0 and 24 (even integer)',
              },
              flutingDepth: {
                type: Type.NUMBER,
                description: 'Depth of vertical fluting between 0.0 and 0.16',
              },
              crownPoints: {
                type: Type.INTEGER,
                description: 'Crown or battlement radial points between 4 and 16',
              },
              bevelChamfer: {
                type: Type.NUMBER,
                description: 'Edge bevel chamfer width between 0.01 and 0.11',
              },
              finialScale: {
                type: Type.NUMBER,
                description: 'Top finial/head scale between 0.65 and 1.45',
              },
              primaryColorHex: {
                type: Type.STRING,
                description: 'Hex color string like #181B22 or #E5C697',
              },
              accentColorHex: {
                type: Type.STRING,
                description: 'Hex color string for collar/crown trim like #F59E0B',
              },
              roughness: {
                type: Type.NUMBER,
                description: 'PBR surface roughness between 0.08 and 0.85',
              },
              metalness: {
                type: Type.NUMBER,
                description: 'PBR metalness between 0.0 and 1.0',
              },
              clearcoat: {
                type: Type.NUMBER,
                description: 'PBR clearcoat weight between 0.0 and 1.0',
              },
              transmission: {
                type: Type.NUMBER,
                description: 'Optical glass/crystal transmission between 0.0 and 0.88',
              },
              anisotropy: {
                type: Type.NUMBER,
                description: 'Brushed metal anisotropy between 0.0 and 0.95',
              },
            },
            required: [
              'pieceType',
              'style',
              'materialId',
              'name',
              'designLore',
              'heightScale',
              'baseRadius',
              'waistTaper',
              'collarRings',
              'flutingCount',
              'flutingDepth',
              'crownPoints',
              'bevelChamfer',
              'finialScale',
              'primaryColorHex',
              'accentColorHex',
              'roughness',
              'metalness',
              'clearcoat',
              'transmission',
              'anisotropy',
            ],
          },
        },
      });

      const rawText = response.text;
      if (!rawText) {
        res.json({ spec: fallbackSpec, source: 'parametric-engine' });
        return;
      }

      const parsed = JSON.parse(rawText);
      const validPieces = ['king', 'queen', 'bishop', 'knight', 'rook', 'pawn'];
      const validStyles = ['staunton', 'gothic', 'brutalist', 'cyber', 'artdeco'];
      const validMaterials = ['boxwood', 'obsidian', 'damascus', 'jade', 'bronze'];

      const mergedSpec: ChessPieceSpec = {
        ...fallbackSpec,
        pieceType: validPieces.includes(parsed.pieceType) ? parsed.pieceType : fallbackSpec.pieceType,
        style: validStyles.includes(parsed.style) ? parsed.style : fallbackSpec.style,
        materialId: validMaterials.includes(parsed.materialId) ? parsed.materialId : fallbackSpec.materialId,
        lod: baseSpec.lod,
        name: parsed.name || fallbackSpec.name,
        designLore: parsed.designLore || fallbackSpec.designLore,
        heightScale: Math.max(0.7, Math.min(1.35, Number(parsed.heightScale) || fallbackSpec.heightScale)),
        baseRadius: Math.max(0.75, Math.min(1.25, Number(parsed.baseRadius) || fallbackSpec.baseRadius)),
        waistTaper: Math.max(0.25, Math.min(0.75, Number(parsed.waistTaper) || fallbackSpec.waistTaper)),
        collarRings: Math.max(1, Math.min(5, Math.round(Number(parsed.collarRings) || fallbackSpec.collarRings))),
        flutingCount: Math.max(0, Math.min(24, Math.round(Number(parsed.flutingCount) ?? fallbackSpec.flutingCount))),
        flutingDepth: Math.max(0, Math.min(0.18, Number(parsed.flutingDepth) ?? fallbackSpec.flutingDepth)),
        crownPoints: Math.max(3, Math.min(16, Math.round(Number(parsed.crownPoints) || fallbackSpec.crownPoints))),
        bevelChamfer: Math.max(0.01, Math.min(0.12, Number(parsed.bevelChamfer) || fallbackSpec.bevelChamfer)),
        finialScale: Math.max(0.5, Math.min(1.5, Number(parsed.finialScale) || fallbackSpec.finialScale)),
        primaryColorHex: /^#[0-9A-Fa-f]{6}$/.test(parsed.primaryColorHex)
          ? parsed.primaryColorHex
          : fallbackSpec.primaryColorHex,
        accentColorHex: /^#[0-9A-Fa-f]{6}$/.test(parsed.accentColorHex)
          ? parsed.accentColorHex
          : fallbackSpec.accentColorHex,
        roughness: Math.max(0.05, Math.min(0.9, Number(parsed.roughness) ?? fallbackSpec.roughness)),
        metalness: Math.max(0.0, Math.min(1.0, Number(parsed.metalness) ?? fallbackSpec.metalness)),
        clearcoat: Math.max(0.0, Math.min(1.0, Number(parsed.clearcoat) ?? fallbackSpec.clearcoat)),
        transmission: Math.max(0.0, Math.min(0.9, Number(parsed.transmission) ?? fallbackSpec.transmission)),
        anisotropy: Math.max(0.0, Math.min(1.0, Number(parsed.anisotropy) ?? fallbackSpec.anisotropy)),
      };

      res.json({
        spec: mergedSpec,
        source: 'gemini-3.8-flash',
      });
    } catch (error) {
      console.warn('Gemini generation fallback triggered:', error);
      res.json({
        spec: fallbackSpec,
        source: 'parametric-engine',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Grandmaster Forge server listening on http://localhost:${PORT}`);
  });
}

startServer();
