import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * GET /api/memory/workflow-mappings
 *
 * Read-only view of scripts/shared/node-mappings.json — the source of truth
 * for N8N / Make.com → Odin module mappings.
 *
 * Query params:
 *   platform: 'n8n' | 'make' | 'all' (default 'all')
 *
 * Response shape matches the old /workflow-knowledge endpoint enough for the
 * MindMap dialog UI to render without changes.
 */

interface Mapping {
  b0tModule: string;
  category: string;
  triggerType?: string;
  conversionConfig?: Record<string, unknown>;
}

type MappingsFile = {
  n8n?: Record<string, Mapping>;
  make?: Record<string, Mapping>;
};

function loadMappingsFile(): MappingsFile {
  const jsonPath = resolve(process.cwd(), 'scripts', 'shared', 'node-mappings.json');
  const raw = readFileSync(jsonPath, 'utf-8');
  return JSON.parse(raw) as MappingsFile;
}

export async function GET(req: NextRequest) {
  try {
    const platform = req.nextUrl.searchParams.get('platform') ?? 'all';
    const file = loadMappingsFile();

    const platforms: Array<'n8n' | 'make'> =
      platform === 'all' ? ['n8n', 'make'] : [platform as 'n8n' | 'make'];

    const mappings: Array<{
      id: string;
      sourcePlatform: string;
      sourceIdentifier: string;
      identifierType: string;
      b0tModulePath: string;
      confidenceScore: number;
      usageCount: number;
      createdAt: string;
      updatedAt: string;
    }> = [];

    for (const p of platforms) {
      const entries = file[p] ?? {};
      for (const [sourceIdentifier, m] of Object.entries(entries)) {
        const cfg = (m.conversionConfig ?? {}) as { defaultFunction?: string };
        const fn = cfg.defaultFunction ?? '';
        const b0tModulePath = fn ? `${m.b0tModule}.${fn}` : m.b0tModule;
        mappings.push({
          id: `${p}:${sourceIdentifier}`,
          sourcePlatform: p,
          sourceIdentifier,
          identifierType: m.triggerType ? 'trigger' : 'node_type',
          b0tModulePath,
          confidenceScore: 1,
          usageCount: 1,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        });
      }
    }

    return Response.json({ mappings, patterns: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
