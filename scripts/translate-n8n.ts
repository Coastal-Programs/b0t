#!/usr/bin/env npx tsx
/**
 * N8N → Odin Translator
 *
 * Deterministic translator: walks an N8N workflow JSON, applies node-mappings,
 * emits an Odin workflow plan YAML and a structured warnings/unknowns report
 * that the slash command can consume.
 *
 * No LLM. No DB. The LLM-driven slash command only intervenes for the gaps
 * this translator can't resolve.
 *
 * Usage:
 *   npx tsx scripts/translate-n8n.ts <path-to-n8n-json> [--out=plans/<name>.yaml]
 *
 * Output:
 *   - Writes plans/<name>.yaml (or --out path)
 *   - Prints a JSON report to stdout (last line):
 *     { yamlPath, warnings: [...], unknownNodes: [...] }
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

interface N8NNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  webhookId?: string;
  disabled?: boolean;
}

interface N8NConnectionTarget {
  node: string;
  type: string;
  index: number;
}

interface N8NWorkflow {
  name: string;
  nodes: N8NNode[];
  connections: Record<
    string,
    { main?: N8NConnectionTarget[][]; ai_languageModel?: N8NConnectionTarget[][] }
  >;
  active?: boolean;
  id?: string;
}

interface NodeMapping {
  b0tModule: string;
  category: string;
  operations?: Record<string, { b0tFunction: string; description?: string }>;
  triggerType?: string;
  conversionConfig?: Record<string, unknown>;
}

type MappingsByPlatform = {
  n8n: Record<string, NodeMapping>;
  make?: Record<string, NodeMapping>;
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

function loadMappings(): MappingsByPlatform {
  const jsonPath = resolve(scriptDir(), 'shared', 'node-mappings.json');
  if (!existsSync(jsonPath)) {
    throw new Error(`node-mappings.json not found at ${jsonPath}`);
  }
  const raw = readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && parsed.n8n) {
    return parsed as MappingsByPlatform;
  }
  // Legacy flat shape — treat as n8n.
  return { n8n: parsed as Record<string, NodeMapping> };
}

function loadLearnings(platform: 'n8n' | 'make'): Record<string, NodeMapping> {
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
      if (entry.sourcePlatform !== platform || !entry.sourceType || !entry.correctMapping) continue;
      // correctMapping is "category.module.function" — split out best-effort.
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
      // Skip malformed lines — append-only log shouldn't crash translation.
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

function unwrapRl(value: unknown): unknown {
  if (value && typeof value === 'object' && (value as { __rl?: boolean }).__rl) {
    return (value as { value: unknown }).value;
  }
  return value;
}

/**
 * Convert N8N expression syntax to Odin template syntax.
 * N8N: ={{ $json.field }} or ={{ $('Node Name').item.json.field }}
 * Odin: {{ stepRef.field }}
 *
 * Rough heuristic — produces best-effort output. Unresolved references are
 * preserved with a comment marker the LLM phase can pick up.
 */
function convertExpression(raw: string, nameToOutputAs: Map<string, string>): string {
  if (typeof raw !== 'string') return raw;
  if (!raw.includes('{{')) return raw;
  // Strip leading "=" used by n8n to mark dynamic strings.
  let out = raw.startsWith('=') ? raw.slice(1) : raw;

  // ={{ $('NodeName').item.json.field }} → {{ outputAs.field }}
  out = out.replace(
    /\{\{\s*\$\(['"]([^'"]+)['"]\)\.item\.json\.([\w.]+)\s*\}\}/g,
    (_m, nodeName: string, field: string) => {
      const outputAs = nameToOutputAs.get(nodeName);
      return `{{${outputAs ?? slugify(nodeName)}.${field}}}`;
    }
  );

  // ={{ $json.field }} → {{ trigger.field }} (no upstream context — best effort)
  out = out.replace(
    /\{\{\s*\$json\.([\w.]+)\s*\}\}/g,
    (_m, field: string) => `{{trigger.${field}}}`
  );

  // ={{ $node["Foo"].json.bar }} → {{ outputAs.bar }}
  out = out.replace(
    /\{\{\s*\$node\[['"]([^'"]+)['"]\]\.json\.([\w.]+)\s*\}\}/g,
    (_m, nodeName: string, field: string) => {
      const outputAs = nameToOutputAs.get(nodeName);
      return `{{${outputAs ?? slugify(nodeName)}.${field}}}`;
    }
  );

  return out;
}

function convertParams(
  params: Record<string, unknown>,
  nameToOutputAs: Map<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(params)) {
    const value = unwrapRl(rawValue);
    if (typeof value === 'string') {
      out[key] = convertExpression(value, nameToOutputAs);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'string' ? convertExpression(item, nameToOutputAs) : item
      );
    } else if (value && typeof value === 'object') {
      out[key] = convertParams(value as Record<string, unknown>, nameToOutputAs);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ─── Trigger detection ─────────────────────────────────────────────────────

const TRIGGER_TYPE_KEYWORDS = ['trigger', 'webhook'];

function findTriggerNode(nodes: N8NNode[]): N8NNode | undefined {
  return nodes.find((n) => {
    const t = n.type.toLowerCase();
    return TRIGGER_TYPE_KEYWORDS.some((kw) => t.includes(kw));
  });
}

function buildTriggerYamlFields(
  node: N8NNode,
  mapping: NodeMapping | undefined,
  warnings: TranslationDiagnostic[]
): { trigger: string; extra: Record<string, unknown> } {
  const triggerType = mapping?.triggerType ?? 'manual';
  const extra: Record<string, unknown> = {};

  if (triggerType === 'cron') {
    const interval = (node.parameters as { rule?: { interval?: Array<Record<string, unknown>> } })
      .rule?.interval?.[0];
    if (interval) {
      // N8N cron config — convert basic cases.
      const field = interval.field as string | undefined;
      const value = (interval[`${field}Interval`] ?? 1) as number;
      if (field === 'minutes') extra.schedule = `*/${value} * * * *`;
      else if (field === 'hours') extra.schedule = `0 */${value} * * *`;
      else if (field === 'days') extra.schedule = `0 0 */${value} * *`;
      else extra.schedule = '0 * * * *'; // fallback hourly
    } else {
      extra.schedule = '0 * * * *';
    }
  } else if (triggerType === 'gmail') {
    const pollMode = (node.parameters as { pollTimes?: { item?: Array<{ mode?: string }> } })
      .pollTimes?.item?.[0]?.mode;
    extra.gmailPollInterval = pollMode === 'everyMinute' ? 60 : 300;
  } else if (triggerType === 'outlook') {
    extra.outlookPollInterval = 60;
  } else if (triggerType === 'airtable') {
    const baseId = unwrapRl((node.parameters as Record<string, unknown>).baseId);
    const tableId = unwrapRl((node.parameters as Record<string, unknown>).tableId);
    const triggerField = (node.parameters as { triggerField?: string }).triggerField;
    extra.airtableConfig = {
      ...(baseId ? { baseId } : {}),
      ...(tableId ? { tableId } : {}),
      ...(triggerField ? { triggerField } : {}),
    };
  } else if (triggerType === 'webhook') {
    // No extra config — Odin webhook trigger registers automatically.
  } else if (!mapping) {
    warnings.push({
      level: 'error',
      nodeId: node.id,
      nodeName: node.name,
      message: `Unknown trigger node type "${node.type}" (node "${node.name}") — defaulting to manual`,
    });
  }

  return { trigger: triggerType, extra };
}

// ─── Step translation ──────────────────────────────────────────────────────

function resolveB0tFunction(
  node: N8NNode,
  mapping: NodeMapping,
  warnings: TranslationDiagnostic[]
): string {
  const operation = (node.parameters.operation ?? node.parameters.resource) as string | undefined;
  if (mapping.operations && operation) {
    const op = mapping.operations[operation];
    if (op?.b0tFunction) return op.b0tFunction;
    warnings.push({
      level: 'warn',
      nodeId: node.id,
      nodeName: node.name,
      message: `Node "${node.name}" (${node.type}): operation "${operation}" has no mapping — using "execute" placeholder`,
    });
  }
  const cfg = mapping.conversionConfig as { defaultFunction?: string } | undefined;
  if (cfg?.defaultFunction) return cfg.defaultFunction;
  if (operation) return operation;
  // Generic fallback the LLM resolve phase will replace.
  warnings.push({
    level: 'warn',
    nodeId: node.id,
    nodeName: node.name,
    message: `Node "${node.name}" (${node.type}): no operation field and no defaultFunction in mapping — emitted "TODO" placeholder.`,
  });
  return 'TODO';
}

function buildStepFromNode(
  node: N8NNode,
  mapping: NodeMapping | undefined,
  nameToOutputAs: Map<string, string>,
  takenIds: Set<string>,
  warnings: TranslationDiagnostic[],
  unknownNodes: string[]
): YamlStep | null {
  const stepId = uniqueStepId(node.name, takenIds);

  // Pre-register so downstream {{ stepId.* }} references resolve.
  nameToOutputAs.set(node.name, stepId);

  if (!mapping) {
    unknownNodes.push(`${node.type} (node "${node.name}")`);
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: {
        code: `// TODO: unmapped n8n node type "${node.type}" — replace with real implementation\nreturn input;`,
      },
      outputAs: stepId,
    };
  }

  // textClassifier → ai.ai-sdk.generateJSON with enum schema.
  if (node.type === '@n8n/n8n-nodes-langchain.textClassifier') {
    const categories =
      (
        node.parameters as {
          categories?: { categories?: Array<{ category: string; description?: string }> };
        }
      ).categories?.categories ?? [];
    const inputText = (node.parameters as { inputText?: string }).inputText ?? '';
    const enumValues = categories.map((c) => c.category);
    const descriptionLines = categories
      .map((c) => `- ${c.category}: ${c.description ?? ''}`)
      .join('\n');
    return {
      id: stepId,
      module: 'ai.ai-sdk.generateJSON',
      inputs: {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        prompt: `Classify the following input:\n${convertExpression(
          inputText,
          nameToOutputAs
        )}\n\nCategories:\n${descriptionLines}\n\nReturn ONLY the category name.`,
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: enumValues },
          },
          required: ['category'],
        },
      },
      outputAs: stepId,
    };
  }

  // anthropic / openAi chat → ai.ai-sdk.generateText
  if (
    node.type === '@n8n/n8n-nodes-langchain.anthropic' ||
    node.type === '@n8n/n8n-nodes-langchain.openAi' ||
    node.type === '@n8n/n8n-nodes-langchain.lmChatAnthropic' ||
    node.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi'
  ) {
    const cfg = (mapping.conversionConfig ?? {}) as { provider?: string };
    const provider = cfg.provider ?? 'anthropic';
    const prompt =
      (node.parameters as { text?: string; prompt?: string; userMessage?: string }).text ??
      (node.parameters as { prompt?: string }).prompt ??
      (node.parameters as { userMessage?: string }).userMessage ??
      '';
    return {
      id: stepId,
      module: 'ai.ai-sdk.generateText',
      inputs: {
        provider,
        prompt: convertExpression(prompt, nameToOutputAs),
      },
      outputAs: stepId,
    };
  }

  // code / javascript
  if (node.type === 'n8n-nodes-base.code') {
    const code = (node.parameters as { jsCode?: string }).jsCode ?? 'return input;';
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: {
        code: convertExpression(code, nameToOutputAs),
      },
      outputAs: stepId,
    };
  }

  // IF / Switch nodes — Odin is sequential, so emit a JS step that records the
  // branch decision. The LLM resolve phase will likely transform these further.
  if (node.type === 'n8n-nodes-base.if' || node.type === 'n8n-nodes-base.switch') {
    warnings.push({
      level: 'warn',
      nodeId: node.id,
      nodeName: node.name,
      message: `Branching node "${node.name}" (${node.type}) — Odin is sequential. Emitted as utilities.javascript.execute; review and convert to conditional steps if needed.`,
    });
    return {
      id: stepId,
      module: 'utilities.javascript.execute',
      inputs: {
        code: `// TODO: branching node "${node.name}" — original n8n type ${node.type}\n// Conditions: ${JSON.stringify(node.parameters.conditions ?? {})}\nreturn input;`,
      },
      outputAs: stepId,
    };
  }

  // HTTP request
  if (node.type === 'n8n-nodes-base.httpRequest') {
    const params = node.parameters as Record<string, unknown>;
    return {
      id: stepId,
      module: 'utilities.http.request',
      inputs: {
        url: convertExpression(String(params.url ?? ''), nameToOutputAs),
        method: (params.method as string) ?? 'GET',
        ...(params.sendHeaders && params.headerParameters
          ? {
              headers: convertParams(
                params.headerParameters as Record<string, unknown>,
                nameToOutputAs
              ),
            }
          : {}),
        ...(params.sendBody && params.bodyParameters
          ? {
              body: convertParams(params.bodyParameters as Record<string, unknown>, nameToOutputAs),
            }
          : {}),
      },
      outputAs: stepId,
    };
  }

  // Generic mapped action node.
  const b0tFn = resolveB0tFunction(node, mapping, warnings);
  const modulePath = `${mapping.b0tModule}.${b0tFn}`;
  const inputs = convertParams(node.parameters, nameToOutputAs);
  // Drop n8n-only orchestration keys.
  delete inputs.operation;
  delete inputs.resource;
  delete inputs.authentication;
  delete inputs.options;
  delete inputs.additionalFields;

  return {
    id: stepId,
    module: modulePath,
    inputs,
    outputAs: stepId,
  };
}

// ─── Connection walk (topological-ish order) ───────────────────────────────

function orderNodes(workflow: N8NWorkflow, triggerName: string | undefined): N8NNode[] {
  const nameToNode = new Map<string, N8NNode>();
  for (const n of workflow.nodes) nameToNode.set(n.name, n);

  const visited = new Set<string>();
  const ordered: N8NNode[] = [];

  function walk(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const node = nameToNode.get(name);
    if (!node) return;
    ordered.push(node);
    const conn = workflow.connections[name];
    if (!conn?.main) return;
    for (const branch of conn.main) {
      for (const target of branch ?? []) {
        walk(target.node);
      }
    }
  }

  if (triggerName) walk(triggerName);

  // Append disconnected nodes deterministically by name.
  const remaining = workflow.nodes
    .filter((n) => !visited.has(n.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  ordered.push(...remaining);
  return ordered;
}

// ─── Entry ─────────────────────────────────────────────────────────────────

export function translateN8nWorkflow(filePath: string, outPath?: string): TranslateReport {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const raw = readFileSync(resolved, 'utf-8');
  const workflow = JSON.parse(raw) as N8NWorkflow;
  if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
    throw new Error(`Not an n8n workflow (missing nodes[]): ${resolved}`);
  }

  const mappings = loadMappings();
  const learnings = loadLearnings('n8n');
  const lookup: Record<string, NodeMapping> = { ...mappings.n8n, ...learnings };

  const warnings: TranslationDiagnostic[] = [];
  const unknownNodes: string[] = [];
  const takenIds = new Set<string>();
  const nameToOutputAs = new Map<string, string>();

  const triggerNode = findTriggerNode(workflow.nodes);
  const triggerMapping = triggerNode ? lookup[triggerNode.type] : undefined;
  const triggerFields = triggerNode
    ? buildTriggerYamlFields(triggerNode, triggerMapping, warnings)
    : { trigger: 'manual', extra: {} };

  if (!triggerNode) {
    warnings.push({
      level: 'warn',
      message: 'No trigger node detected — defaulting to manual trigger.',
    });
  } else if (!triggerMapping) {
    unknownNodes.push(`${triggerNode.type} (trigger node "${triggerNode.name}")`);
  }

  // Reserve the trigger's name so any {{ $('Trigger').item.json.x }} converts
  // to {{trigger.x}} rather than to a step-id slug. Also claim the literal
  // "trigger" id so a downstream node literally named "Trigger" doesn't
  // slugify into a collision.
  if (triggerNode) {
    nameToOutputAs.set(triggerNode.name, 'trigger');
    takenIds.add('trigger');
  }

  const orderedNodes = orderNodes(workflow, triggerNode?.name);

  const steps: YamlStep[] = [];
  for (const node of orderedNodes) {
    if (node === triggerNode) continue; // Triggers live in YAML top-level, not steps.
    if (node.disabled) {
      warnings.push({
        level: 'warn',
        nodeId: node.id,
        nodeName: node.name,
        message: `Node "${node.name}" is disabled — skipped.`,
      });
      continue;
    }
    const mapping = lookup[node.type];
    const step = buildStepFromNode(node, mapping, nameToOutputAs, takenIds, warnings, unknownNodes);
    if (step) steps.push(step);
  }

  const planName = workflow.name?.trim() || basename(resolved, extname(resolved));
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
      'Usage: npx tsx scripts/translate-n8n.ts <path-to-n8n-json> [--out=plans/<name>.yaml]'
    );
    process.exit(1);
  }

  try {
    const report = translateN8nWorkflow(filePath, outArg);
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
      console.error(`⚠ ${report.unknownNodes.length} unknown nodes (need LLM resolve phase)`);
      for (const u of report.unknownNodes) console.error(`   - ${u}`);
    }
    // Last line of stdout is the machine-readable report.
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Translation failed: ${message}`);
    process.exit(1);
  }
}
