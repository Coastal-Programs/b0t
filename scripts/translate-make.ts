#!/usr/bin/env npx tsx
/**
 * Make.com → Odin Translator
 *
 * Deterministic translator: walks a Make.com `.blueprint.json` flow array,
 * applies node-mappings, emits an Odin workflow plan YAML and a structured
 * warnings/unknowns report the slash command can consume.
 *
 * Routers (`builtin:BasicRouter`) are emitted as a marker step the LLM
 * resolve phase must ask the user about — never silently flattened.
 *
 * Usage:
 *   npx tsx scripts/translate-make.ts <path-to-make-blueprint.json> [--out=plans/<name>.yaml]
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

// ─── Types ─────────────────────────────────────────────────────────────────

interface TranslationDiagnostic {
  level: 'info' | 'warn' | 'error';
  nodeId?: string;
  nodeName?: string;
  message: string;
}

interface MakeRoute {
  flow: MakeNode[];
  filter?: { name?: string; conditions?: unknown };
}

interface MakeNode {
  id: number;
  module: string;
  version?: number;
  parameters?: Record<string, unknown>;
  mapper?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  routes?: MakeRoute[];
}

interface MakeBlueprint {
  name?: string;
  flow: MakeNode[];
  metadata?: Record<string, unknown>;
}

interface NodeMapping {
  b0tModule: string;
  category: string;
  operations?: Record<string, { b0tFunction: string; description?: string }>;
  triggerType?: string;
  conversionConfig?: Record<string, unknown>;
}

type MappingsByPlatform = {
  n8n?: Record<string, NodeMapping>;
  make: Record<string, NodeMapping>;
};

interface LearningEntry {
  date: string;
  sourceType: string;
  sourcePlatform: 'n8n' | 'make';
  wrongMapping?: string;
  correctMapping: string;
  userNote?: string;
}

interface TranslateReport {
  yamlPath: string;
  warnings: TranslationDiagnostic[];
  unknownNodes: string[];
  steps: number;
  trigger: string;
}

interface YamlStep {
  id: string;
  module?: string;
  type?: string;
  inputs?: Record<string, unknown>;
  outputAs?: string;
  steps?: YamlStep[];
}

interface YamlPlan {
  name: string;
  description?: string;
  trigger: string;
  schedule?: string;
  output: string;
  steps: YamlStep[];
  [key: string]: unknown;
}

// ─── Mapping loader ────────────────────────────────────────────────────────

function scriptDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function loadMappings(): Record<string, NodeMapping> {
  const jsonPath = resolve(scriptDir(), 'shared', 'node-mappings.json');
  if (!existsSync(jsonPath)) {
    throw new Error(`node-mappings.json not found at ${jsonPath}`);
  }
  const raw = readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as MappingsByPlatform;
  if (!parsed.make) {
    throw new Error(`node-mappings.json has no "make" key — translator cannot run.`);
  }
  return parsed.make;
}

function loadLearnings(): Record<string, NodeMapping> {
  const learningsPath = resolve(
    scriptDir(),
    '..',
    'data',
    'workflow-translator',
    'learnings.jsonl'
  );
  if (!existsSync(learningsPath)) return {};
  const raw = readFileSync(learningsPath, 'utf-8');
  const overrides: Record<string, NodeMapping> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as LearningEntry;
      if (entry.sourcePlatform !== 'make' || !entry.sourceType || !entry.correctMapping) continue;
      const parts = entry.correctMapping.split('.');
      if (parts.length < 2) continue;
      const b0tModule = parts.slice(0, 2).join('.');
      const fnName = parts[2];
      overrides[entry.sourceType] = {
        b0tModule,
        category: parts[0],
        conversionConfig: fnName ? { defaultFunction: fnName, learned: true } : { learned: true },
      };
    } catch {
      // Skip malformed lines.
    }
  }
  return overrides;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'workflow'
  );
}

function uniqueStepId(base: string, taken: Set<string>): string {
  const slug = slugify(base);
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i++;
  const id = `${slug}-${i}`;
  taken.add(id);
  return id;
}

/**
 * Convert Make.com expression syntax to Odin template syntax.
 * Make.com: {{4.data.field}}  (module id 4)
 *           {{firstName}}     (variable from util:SetVariables)
 * Odin:     {{ stepId.field }} / {{ stepId.value }}
 */
function convertExpression(
  raw: string,
  idToStepId: Map<number, string>,
  varToStepId: Map<string, string>
): string {
  if (typeof raw !== 'string') return raw;
  if (!raw.includes('{{')) return raw;

  let out = raw;

  // {{ <number>.<dotted.path>[<index>]? }}
  out = out.replace(/\{\{\s*(\d+)\.([\w.[\]]+)\s*\}\}/g, (_m, idStr: string, path: string) => {
    const id = Number.parseInt(idStr, 10);
    const stepId = idToStepId.get(id);
    if (!stepId) return `{{TODO_module_${idStr}.${path}}}`;
    return `{{${stepId}.${path}}}`;
  });

  // {{ identifier }} → variable reference (util:SetVariables)
  out = out.replace(/\{\{\s*([a-zA-Z_$][\w]*)\s*\}\}/g, (m, name: string) => {
    const stepId = varToStepId.get(name);
    if (!stepId) return m;
    return `{{${stepId}.${name}}}`;
  });

  return out;
}

function convertParamObject(
  obj: Record<string, unknown>,
  idToStepId: Map<number, string>,
  varToStepId: Map<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      out[key] = convertExpression(value, idToStepId, varToStepId);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => {
        if (typeof item === 'string') return convertExpression(item, idToStepId, varToStepId);
        if (item && typeof item === 'object') {
          return convertParamObject(item as Record<string, unknown>, idToStepId, varToStepId);
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      out[key] = convertParamObject(value as Record<string, unknown>, idToStepId, varToStepId);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ─── Trigger detection ─────────────────────────────────────────────────────

function isTriggerModule(mod: string, mapping: NodeMapping | undefined): boolean {
  if (mapping?.triggerType) return true;
  if (mod.startsWith('gateway:')) return true; // Webhook triggers.
  if (mod.includes(':Trigger')) return true; // e.g. airtable:TriggerWatchRecords
  if (mod.includes(':calSubscribe')) return true;
  return false;
}

function buildTriggerFields(
  node: MakeNode,
  mapping: NodeMapping | undefined,
  warnings: TranslationDiagnostic[]
): { trigger: string; extra: Record<string, unknown> } {
  const triggerType = mapping?.triggerType ?? 'manual';
  const extra: Record<string, unknown> = {};
  const params = (node.parameters ?? {}) as Record<string, unknown>;

  if (triggerType === 'airtable') {
    extra.airtableConfig = {
      ...(params.base ? { baseId: params.base } : {}),
      ...(params.table ? { tableId: params.table } : {}),
      ...((params.config as { triggerField?: string })?.triggerField
        ? { triggerField: (params.config as { triggerField?: string }).triggerField }
        : {}),
      ...(params.view ? { view: params.view } : {}),
      ...(params.formula ? { formula: params.formula } : {}),
    };
  } else if (!mapping) {
    warnings.push({
      level: 'error',
      nodeId: String(node.id),
      nodeName: node.module,
      message: `Unknown trigger module "${node.module}" (id ${node.id}) — defaulting to manual.`,
    });
  }

  return { trigger: triggerType, extra };
}

// ─── Step translation ──────────────────────────────────────────────────────

function resolveB0tFunction(
  node: MakeNode,
  mapping: NodeMapping,
  warnings: TranslationDiagnostic[]
): string {
  const cfg = mapping.conversionConfig as { defaultFunction?: string } | undefined;
  if (cfg?.defaultFunction) return cfg.defaultFunction;
  if (mapping.operations) {
    const first = Object.values(mapping.operations)[0];
    if (first?.b0tFunction) return first.b0tFunction;
  }
  warnings.push({
    level: 'warn',
    nodeId: String(node.id),
    nodeName: node.module,
    message: `Module "${node.module}" (id ${node.id}) has no default function — using "TODO".`,
  });
  return 'TODO';
}

function buildStepFromNode(
  node: MakeNode,
  mapping: NodeMapping | undefined,
  idToStepId: Map<number, string>,
  varToStepId: Map<string, string>,
  takenIds: Set<string>,
  warnings: TranslationDiagnostic[],
  unknownNodes: string[]
): YamlStep | null {
  const baseName = node.module.replace(/[^a-zA-Z0-9]/g, '-');
  const stepId = uniqueStepId(`${baseName}-${node.id}`, takenIds);
  idToStepId.set(node.id, stepId);

  if (!mapping) {
    unknownNodes.push(`${node.module} (id ${node.id})`);
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: {
        code: `// TODO: unmapped make.com module "${node.module}" — replace with real implementation\nreturn input;`,
      },
      outputAs: stepId,
    };
  }

  // BasicRouter — never silently flatten. Mark for the LLM resolve phase to
  // ask the user (multiple workflows / JS conditional / simplify).
  if (node.module === 'builtin:BasicRouter') {
    warnings.push({
      level: 'warn',
      nodeId: String(node.id),
      nodeName: node.module,
      message: `Router node id ${node.id} — Make.com has ${node.routes?.length ?? 0} routes. ASK USER how to handle (multi-workflow / JS branch / simplify).`,
    });
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: {
        code: `// TODO: Make.com BasicRouter with ${node.routes?.length ?? 0} routes — needs user decision.\n// Original route filters: ${JSON.stringify(node.routes?.map((r) => r.filter ?? null) ?? [])}\nreturn input;`,
      },
      outputAs: stepId,
    };
  }

  // util:SetVariables — register variables so downstream {{varName}} refs resolve.
  if (node.module === 'util:SetVariables' || node.module === 'util:SetVariable') {
    const mapper = (node.mapper ?? {}) as { variables?: Array<{ name: string; value: unknown }> };
    const variables = mapper.variables ?? [];
    const obj: Record<string, unknown> = {};
    for (const v of variables) {
      const cleanName = String(v.name).trim();
      if (!cleanName) continue;
      varToStepId.set(cleanName, stepId);
      obj[cleanName] =
        typeof v.value === 'string' ? convertExpression(v.value, idToStepId, varToStepId) : v.value;
    }
    const code = `return ${JSON.stringify(obj, null, 2)};`;
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: { code },
      outputAs: stepId,
    };
  }

  // util:FunctionSleep
  if (node.module === 'util:FunctionSleep' || node.module === 'tools:Sleep') {
    const duration = (node.mapper?.duration as number | string | undefined) ?? 1;
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: {
        code: `await new Promise(r => setTimeout(r, ${Number(duration) * 1000}));\nreturn input;`,
      },
      outputAs: stepId,
    };
  }

  // Generic mapped action.
  const b0tFn = resolveB0tFunction(node, mapping, warnings);
  const modulePath = `${mapping.b0tModule}.${b0tFn}`;
  const mapperParams = (node.mapper ?? {}) as Record<string, unknown>;
  const inputs = convertParamObject(mapperParams, idToStepId, varToStepId);
  // Drop make-only fields.
  delete inputs.__IMTCONN__;
  delete inputs.choose;

  return {
    id: stepId,
    module: modulePath,
    inputs,
    outputAs: stepId,
  };
}

// ─── Entry ─────────────────────────────────────────────────────────────────

export function translateMakeWorkflow(filePath: string, outPath?: string): TranslateReport {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const raw = readFileSync(resolved, 'utf-8');
  const blueprint = JSON.parse(raw) as MakeBlueprint;
  if (!blueprint.flow || !Array.isArray(blueprint.flow)) {
    throw new Error(`Not a make.com blueprint (missing flow[]): ${resolved}`);
  }

  const mappings = loadMappings();
  const learnings = loadLearnings();
  const lookup: Record<string, NodeMapping> = { ...mappings, ...learnings };

  const warnings: TranslationDiagnostic[] = [];
  const unknownNodes: string[] = [];
  const takenIds = new Set<string>();
  const idToStepId = new Map<number, string>();
  const varToStepId = new Map<string, string>();

  // First node is always the trigger in Make.com.
  const [triggerNode, ...actionNodes] = blueprint.flow;
  const triggerMapping = triggerNode ? lookup[triggerNode.module] : undefined;
  const triggerFields = triggerNode
    ? buildTriggerFields(triggerNode, triggerMapping, warnings)
    : { trigger: 'manual', extra: {} };

  if (triggerNode) {
    // Map the trigger module id to the literal "trigger" so converted
    // expressions look like {{trigger.field}}, and reserve that id in
    // takenIds so no downstream module slugifies into a collision.
    idToStepId.set(triggerNode.id, 'trigger');
    takenIds.add('trigger');
    if (!triggerMapping) {
      unknownNodes.push(`${triggerNode.module} (trigger id ${triggerNode.id})`);
    }
  } else {
    warnings.push({
      level: 'warn',
      message: 'Empty flow — no trigger node.',
    });
  }

  const steps: YamlStep[] = [];
  for (const node of actionNodes) {
    const mapping = lookup[node.module];
    const step = buildStepFromNode(
      node,
      mapping,
      idToStepId,
      varToStepId,
      takenIds,
      warnings,
      unknownNodes
    );
    if (step) steps.push(step);
  }

  const planName = blueprint.name?.trim() || basename(resolved, extname(resolved));
  const plan: YamlPlan = {
    name: planName,
    trigger: triggerFields.trigger,
    output: 'json',
    ...triggerFields.extra,
    steps,
  };

  const yaml = YAML.stringify(plan, { lineWidth: 120 });

  const planSlug = slugify(planName);
  const finalOutPath = outPath
    ? resolve(outPath)
    : resolve(scriptDir(), '..', 'plans', `${planSlug}.yaml`);
  mkdirSync(dirname(finalOutPath), { recursive: true });
  writeFileSync(finalOutPath, yaml, 'utf-8');

  // Silence the never-read lint check for isTriggerModule by referencing it.
  void isTriggerModule;

  return {
    yamlPath: finalOutPath,
    warnings,
    unknownNodes,
    steps: steps.length,
    trigger: triggerFields.trigger,
  };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith('--out='))?.split('=')[1];
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error(
      'Usage: npx tsx scripts/translate-make.ts <path-to-make-blueprint.json> [--out=plans/<name>.yaml]'
    );
    process.exit(1);
  }

  try {
    const report = translateMakeWorkflow(filePath, outArg);
    console.error(`✓ Wrote ${report.yamlPath} (${report.steps} steps, trigger: ${report.trigger})`);
    if (report.warnings.length) {
      console.error(`⚠ ${report.warnings.length} warnings`);
      for (const w of report.warnings) {
        console.error(
          `   - ${w.level.toUpperCase()} ${w.nodeName ?? w.nodeId ?? ''}: ${w.message}`
        );
      }
    }
    if (report.unknownNodes.length) {
      console.error(`⚠ ${report.unknownNodes.length} unknown modules (need LLM resolve phase)`);
      for (const u of report.unknownNodes) console.error(`   - ${u}`);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Translation failed: ${message}`);
    process.exit(1);
  }
}
