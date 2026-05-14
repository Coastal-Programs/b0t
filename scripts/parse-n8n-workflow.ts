#!/usr/bin/env npx tsx
/**
 * N8N Workflow Parser — Layer 0
 *
 * Reads a raw N8N workflow JSON and outputs a structured summary.
 * No AI needed. Mechanical extraction of nodes, connections, expressions,
 * data flow, and credentials.
 *
 * Usage: npx tsx scripts/parse-n8n-workflow.ts <path-to-n8n-json>
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── Types ─────────────────────────────────────────────────────────────────

interface N8NNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, any>;
  credentials?: Record<string, { id: string; name: string }>;
  webhookId?: string;
  disabled?: boolean;
}

interface N8NConnection {
  node: string;
  type: string;
  index: number;
}

interface N8NWorkflow {
  name: string;
  nodes: N8NNode[];
  connections: Record<string, { main: N8NConnection[][] }>;
  pinData?: Record<string, any[]>;
  active: boolean;
  settings?: Record<string, any>;
  meta?: Record<string, any>;
  id?: string;
  tags?: string[];
}

// ─── Known node type mappings (Layer 1 — knowledge base) ──────────────────
// Load external mappings from shared JSON, then overlay hardcoded overrides.

type NodeMapping = {
  b0tModule: string;
  category: string;
  operations?: Record<string, { b0tFunction: string; description: string }>;
  triggerType?: string;
};

function loadExternalMappings(): Record<string, NodeMapping> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const jsonPath = resolve(scriptDir, 'shared', 'node-mappings.json');
  if (!existsSync(jsonPath)) {
    console.warn(
      `[parse-n8n-workflow] External mappings not found at ${jsonPath} — using hardcoded table only`
    );
    return {};
  }
  try {
    const raw = readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // New schema is { n8n: {...}, make: {...} }. Pull the n8n half.
    // Fall back to flat shape for older copies of this file.
    if (parsed && typeof parsed === 'object' && parsed.n8n && typeof parsed.n8n === 'object') {
      return parsed.n8n as Record<string, NodeMapping>;
    }
    return parsed as Record<string, NodeMapping>;
  } catch (err: any) {
    console.warn(
      `[parse-n8n-workflow] Failed to parse ${jsonPath}: ${err.message} — using hardcoded table only`
    );
    return {};
  }
}

const HARDCODED_MAPPINGS: Record<string, NodeMapping> = {
  // Triggers
  'n8n-nodes-base.airtableTrigger': {
    b0tModule: 'data.airtable',
    category: 'trigger',
    triggerType: 'airtable',
  },
  'n8n-nodes-base.gmailTrigger': {
    b0tModule: 'communication.gmail',
    category: 'trigger',
    triggerType: 'gmail',
  },
  'n8n-nodes-base.microsoftOutlookTrigger': {
    b0tModule: 'communication.outlook',
    category: 'trigger',
    triggerType: 'outlook',
  },
  'n8n-nodes-base.telegramTrigger': {
    b0tModule: 'communication.telegram',
    category: 'trigger',
    triggerType: 'telegram',
  },
  'n8n-nodes-base.webhookTrigger': {
    b0tModule: 'webhook',
    category: 'trigger',
    triggerType: 'webhook',
  },
  'n8n-nodes-base.webhook': {
    b0tModule: 'webhook',
    category: 'trigger',
    triggerType: 'webhook',
  },
  'n8n-nodes-base.scheduleTrigger': {
    b0tModule: 'cron',
    category: 'trigger',
    triggerType: 'cron',
  },
  'n8n-nodes-base.executeWorkflowTrigger': {
    b0tModule: 'webhook',
    category: 'trigger',
    triggerType: 'webhook',
  },

  // Communication
  'n8n-nodes-base.gmail': {
    b0tModule: 'communication.gmail',
    category: 'communication',
    operations: {
      sendEmail: {
        b0tFunction: 'sendEmail',
        description: 'Send email via Gmail',
      },
      addLabels: {
        b0tFunction: 'addLabels',
        description: 'Add labels to message',
      },
      removeLabels: {
        b0tFunction: 'removeLabels',
        description: 'Remove labels from message',
      },
      markAsRead: {
        b0tFunction: 'markAsRead',
        description: 'Mark message as read',
      },
      getAll: {
        b0tFunction: 'fetchEmails',
        description: 'Fetch emails',
      },
      reply: {
        b0tFunction: 'sendEmail',
        description: 'Reply to email (maps to sendEmail with inReplyTo)',
      },
    },
  },
  'n8n-nodes-base.microsoftOutlook': {
    b0tModule: 'communication.outlook',
    category: 'communication',
    operations: {
      sendEmail: {
        b0tFunction: 'sendEmail',
        description: 'Send email via Outlook',
      },
      reply: {
        b0tFunction: 'replyToEmail',
        description: 'Reply to email',
      },
      getAll: {
        b0tFunction: 'fetchEmails',
        description: 'Fetch emails',
      },
    },
  },
  'n8n-nodes-base.slack': {
    b0tModule: 'communication.slack',
    category: 'communication',
    operations: {
      sendMessage: {
        b0tFunction: 'postMessage',
        description: 'Send message to Slack channel',
      },
    },
  },
  'n8n-nodes-base.telegram': {
    b0tModule: 'communication.telegram',
    category: 'communication',
    operations: {
      sendMessage: {
        b0tFunction: 'sendMessage',
        description: 'Send message via Telegram',
      },
      downloadFile: {
        b0tFunction: 'downloadFile',
        description: 'Download file from Telegram',
      },
      file: {
        b0tFunction: 'downloadFile',
        description: 'Download file from Telegram',
      },
    },
  },

  // Data
  'n8n-nodes-base.airtable': {
    b0tModule: 'data.airtable',
    category: 'data',
    operations: {
      create: {
        b0tFunction: 'createRecord',
        description: 'Create Airtable record',
      },
      update: {
        b0tFunction: 'updateRecord',
        description: 'Update Airtable record',
      },
      get: { b0tFunction: 'getRecord', description: 'Get Airtable record' },
      getAll: {
        b0tFunction: 'selectRecords',
        description: 'List Airtable records',
      },
      search: {
        b0tFunction: 'findRecord',
        description: 'Search Airtable records',
      },
      delete: {
        b0tFunction: 'deleteRecord',
        description: 'Delete Airtable record',
      },
    },
  },
  'n8n-nodes-base.googleSheets': {
    b0tModule: 'data.google-sheets',
    category: 'data',
    operations: {
      append: {
        b0tFunction: 'addRow',
        description: 'Append row to sheet',
      },
      read: { b0tFunction: 'getRows', description: 'Read rows from sheet' },
      update: {
        b0tFunction: 'updateRow',
        description: 'Update row in sheet',
      },
      appendOrUpdate: {
        b0tFunction: 'addRow',
        description: 'Append or update row in sheet',
      },
    },
  },
  'n8n-nodes-base.googleDrive': {
    b0tModule: 'data.google-drive',
    category: 'data',
    operations: {
      upload: {
        b0tFunction: 'uploadFile',
        description: 'Upload file to Google Drive',
      },
      download: {
        b0tFunction: 'downloadFile',
        description: 'Download file from Google Drive',
      },
      list: {
        b0tFunction: 'listFiles',
        description: 'List files in Google Drive',
      },
    },
  },
  'n8n-nodes-base.supabase': {
    b0tModule: 'data.supabase',
    category: 'data',
    operations: {
      create: {
        b0tFunction: 'insert',
        description: 'Insert row into Supabase table',
      },
      getAll: {
        b0tFunction: 'select',
        description: 'Select rows from Supabase table',
      },
      update: {
        b0tFunction: 'update',
        description: 'Update row in Supabase table',
      },
    },
  },

  // Control flow
  'n8n-nodes-base.if': {
    b0tModule: 'control-flow',
    category: 'logic',
  },
  'n8n-nodes-base.switch': {
    b0tModule: 'control-flow',
    category: 'logic',
  },
  'n8n-nodes-base.wait': {
    b0tModule: 'utilities.delay',
    category: 'utility',
  },
  'n8n-nodes-base.code': {
    b0tModule: 'utilities.javascript',
    category: 'utility',
    operations: {
      execute: {
        b0tFunction: 'execute',
        description: 'Execute JavaScript code',
      },
    },
  },
  'n8n-nodes-base.set': {
    b0tModule: 'utilities.javascript',
    category: 'utility',
  },
  'n8n-nodes-base.httpRequest': {
    b0tModule: 'utilities.http',
    category: 'utility',
    operations: {
      request: {
        b0tFunction: 'httpRequest',
        description: 'Make HTTP request',
      },
    },
  },
  'n8n-nodes-base.merge': {
    b0tModule: 'utilities.javascript',
    category: 'utility',
  },
  'n8n-nodes-base.filter': {
    b0tModule: 'utilities.javascript',
    category: 'utility',
  },
  'n8n-nodes-base.noOp': {
    b0tModule: 'SKIP',
    category: 'utility',
  },
  'n8n-nodes-base.limit': {
    b0tModule: 'LIMIT',
    category: 'utility',
  },
  'n8n-nodes-base.splitInBatches': {
    b0tModule: 'LOOP',
    category: 'control-flow',
  },
  'n8n-nodes-base.aggregate': {
    b0tModule: 'utilities.javascript',
    category: 'utility',
  },
  'n8n-nodes-base.html': {
    b0tModule: 'utilities.javascript',
    category: 'utility',
  },
  'n8n-nodes-base.stickyNote': {
    b0tModule: 'SKIP',
    category: 'utility',
  },

  // AI
  'n8n-nodes-base.openAi': {
    b0tModule: 'ai.ai-sdk',
    category: 'ai',
    operations: {
      generateText: {
        b0tFunction: 'generateText',
        description: 'Generate text with AI',
      },
      generateJSON: {
        b0tFunction: 'generateJSON',
        description: 'Generate structured JSON with AI',
      },
    },
  },
  '@n8n/n8n-nodes-langchain.openAi': {
    b0tModule: 'ai.ai-sdk',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.textClassifier': {
    b0tModule: 'ai.ai-sdk',
    category: 'ai',
  },
  'n8n-nodes-base.perplexity': {
    b0tModule: 'ai.ai-sdk',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.agent': {
    b0tModule: 'ai.ai-agent',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.toolWorkflow': {
    b0tModule: 'SUB_NODE',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.toolCode': {
    b0tModule: 'SUB_NODE',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.memoryBufferWindow': {
    b0tModule: 'SUB_NODE',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.lmChatOpenRouter': {
    b0tModule: 'SUB_NODE',
    category: 'ai',
  },
  '@n8n/n8n-nodes-langchain.lmChatAnthropic': {
    b0tModule: 'SUB_NODE',
    category: 'ai',
  },
};

// Merge: external JSON as base, hardcoded overrides on top
const NODE_MAPPINGS: Record<string, NodeMapping> = {
  ...loadExternalMappings(),
  ...HARDCODED_MAPPINGS,
};

// ─── Expression Extractor ─────────────────────────────────────────────────

interface ExtractedExpression {
  path: string; // where in the node config this expression lives
  raw: string; // the raw N8N expression
  referencesNode?: string; // which node it references (if any)
  referencesField?: string; // which field it reads
  type: 'self' | 'named-node' | 'input' | 'env' | 'inline-js' | 'unknown';
}

/**
 * Clean up a field reference trail:
 * - "fields['First Name']" → "fields.First Name"
 * - ".split(' ')[0]" gets trimmed (JS operation, not a field)
 * - trailing whitespace removed
 */
function cleanFieldRef(raw: string): string {
  if (!raw) return '';
  // Strip leading dots
  let cleaned = raw.replace(/^\./, '');
  // Strip JS method calls BEFORE bracket conversion (catches .split(' ')[0] etc.)
  // Match .method( and everything after
  cleaned = cleaned.replace(
    /\.(split|map|filter|join|reduce|slice|substring|indexOf|trim|replace|replaceAll|toLowerCase|toUpperCase|includes|startsWith|endsWith|toString|parseInt|parseFloat)\s*\(.*$/,
    ''
  );
  // Convert bracket notation to readable: ['First Name'] → .First Name
  cleaned = cleaned.replace(/\[['"]([^'"]*)['"]\]/g, '.$1');
  // Strip numeric bracket access [0], [1] etc.
  cleaned = cleaned.replace(/\[\d+\]/g, '');
  // Strip leading dots after conversion
  cleaned = cleaned.replace(/^\./, '');
  // Trim trailing ternary/conditional expressions
  cleaned = cleaned.replace(/\s*\?.*$/, '');
  // Strip trailing dots
  cleaned = cleaned.replace(/\.$/, '');
  return cleaned.trim();
}

function extractExpressions(obj: any, path: string = ''): ExtractedExpression[] {
  const expressions: ExtractedExpression[] = [];

  if (typeof obj === 'string') {
    // Match N8N expression patterns: ={{ ... }} or {{ ... }}
    // Use greedy match with balanced-brace awareness for nested brackets
    const exprRegex = /=?\{\{([\s\S]+?)\}\}/g;
    let match;
    while ((match = exprRegex.exec(obj)) !== null) {
      const inner = match[1].trim();
      const expr: ExtractedExpression = {
        path,
        raw: match[0],
        type: 'unknown',
      };

      // $('NodeName').item.json.field — handle bracket notation with spaces
      const namedNodeMatch = inner.match(/\$\(['"](.+?)['"]\)\.item\.json\.?([\s\S]*)/);
      if (namedNodeMatch) {
        expr.type = 'named-node';
        expr.referencesNode = namedNodeMatch[1];
        expr.referencesField = cleanFieldRef(namedNodeMatch[2]) || '(entire output)';
        expressions.push(expr);
        continue;
      }

      // $json reference — any form ($json.x, $json['x'], $json.x['y'].z, etc.)
      if (inner.includes('$json')) {
        expr.type = 'self';
        // Extract everything after $json
        const afterJson = inner.replace(/.*\$json\.?/, '');
        expr.referencesField = cleanFieldRef(afterJson) || '(entire output)';
        expressions.push(expr);
        continue;
      }

      // $input
      if (inner.includes('$input')) {
        expr.type = 'input';
        expressions.push(expr);
        continue;
      }

      // $env
      if (inner.includes('$env')) {
        expr.type = 'env';
        expressions.push(expr);
        continue;
      }

      // Contains JS operations (.split, .map, .filter, etc.)
      if (inner.match(/\.(split|map|filter|join|reduce|slice|substring|indexOf)\(/)) {
        expr.type = 'inline-js';
        expressions.push(expr);
        continue;
      }

      expressions.push(expr);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      expressions.push(...extractExpressions(item, `${path}[${i}]`));
    });
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      expressions.push(...extractExpressions(value, path ? `${path}.${key}` : key));
    }
  }

  return expressions;
}

// ─── IF/Switch Condition Extractor ────────────────────────────────────────

interface ExtractedCondition {
  field: string;
  operator: string;
  value?: string;
  raw: string;
}

function extractConditions(params: Record<string, any>): ExtractedCondition[] {
  const conditions: ExtractedCondition[] = [];

  if (params.conditions?.conditions) {
    for (const cond of params.conditions.conditions) {
      const leftValue = typeof cond.leftValue === 'string' ? cond.leftValue : 'unknown';
      const rightValue = typeof cond.rightValue === 'string' ? cond.rightValue : '';
      const op = cond.operator?.operation || 'unknown';

      conditions.push({
        field: leftValue,
        operator: op,
        value: rightValue || undefined,
        raw: `${leftValue} ${op} ${rightValue || ''}`.trim(),
      });
    }
  }

  return conditions;
}

// ─── Pin Data (Sample Data) Extractor ─────────────────────────────────────

interface PinDataSummary {
  nodeName: string;
  fieldNames: string[];
  sampleValues: Record<string, any>;
  itemCount: number;
}

function extractPinData(pinData: Record<string, any[]> | undefined): PinDataSummary[] {
  if (!pinData) return [];

  return Object.entries(pinData).map(([nodeName, items]) => {
    const firstItem = items[0]?.json || {};
    const flatFields = flattenFields(firstItem);
    return {
      nodeName,
      fieldNames: Object.keys(flatFields),
      sampleValues: flatFields,
      itemCount: items.length,
    };
  });
}

function flattenFields(obj: Record<string, any>, prefix: string = ''): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenFields(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

// ─── Email Content Summarizer ─────────────────────────────────────────────

function summarizeEmailContent(html: string): {
  hasSignature: boolean;
  dynamicFields: string[];
  links: { text: string; url: string }[];
  textPreview: string;
} {
  // Extract dynamic field references from the email
  const dynamicFields: string[] = [];
  const fieldRegex = /\{\{\s*\$json\.fields\[['"](.+?)['"]\]|\.fields\.(\w+)/g;
  let match;
  while ((match = fieldRegex.exec(html)) !== null) {
    const field = match[1] || match[2];
    if (field && !dynamicFields.includes(field)) {
      dynamicFields.push(field);
    }
  }

  // Extract links (non-image ones)
  const links: { text: string; url: string }[] = [];
  const linkRegex = /href="([^"]+)"[^>]*>([^<]*)</g;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const text = match[2].trim();
    if (
      text &&
      !url.startsWith('mailto:') &&
      !url.includes('hubspot') &&
      !url.includes('gstatic')
    ) {
      links.push({ text: text.substring(0, 80), url: url.substring(0, 120) });
    }
  }

  // Check for signature
  const hasSignature =
    html.includes('Signature') || html.includes('signature') || html.includes('cellpadding');

  // Strip HTML for preview
  const textOnly = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const textPreview = textOnly.substring(0, 200) + '...';

  return { hasSignature, dynamicFields, links, textPreview };
}

// ─── Credential Extractor ─────────────────────────────────────────────────

interface ExtractedCredential {
  nodeName: string;
  credentialType: string;
  credentialName: string;
  credentialId: string;
}

function extractCredentials(nodes: N8NNode[]): ExtractedCredential[] {
  const creds: ExtractedCredential[] = [];
  for (const node of nodes) {
    if (node.credentials) {
      for (const [type, info] of Object.entries(node.credentials)) {
        creds.push({
          nodeName: node.name,
          credentialType: type,
          credentialName: info.name,
          credentialId: info.id,
        });
      }
    }
  }
  return creds;
}

// ─── Connection Graph Builder ─────────────────────────────────────────────

interface ConnectionEdge {
  from: string;
  to: string;
  branch: number;
  branchLabel?: string;
}

function buildConnectionGraph(
  connections: N8NWorkflow['connections'],
  nodes: N8NNode[]
): ConnectionEdge[] {
  const edges: ConnectionEdge[] = [];

  for (const [fromNode, outputs] of Object.entries(connections)) {
    if (!outputs.main) continue;
    outputs.main.forEach((branch, branchIndex) => {
      for (const conn of branch) {
        // Try to label IF/Switch branches
        const sourceNode = nodes.find((n) => n.name === fromNode);
        let branchLabel: string | undefined;
        if (
          sourceNode?.type === 'n8n-nodes-base.if' ||
          sourceNode?.type === 'n8n-nodes-base.switch'
        ) {
          branchLabel =
            branchIndex === 0 ? 'TRUE' : branchIndex === 1 ? 'FALSE' : `Branch ${branchIndex}`;
        }

        edges.push({
          from: fromNode,
          to: conn.node,
          branch: branchIndex,
          branchLabel,
        });
      }
    });
  }

  return edges;
}

// ─── AI Prompt Extractor ──────────────────────────────────────────────────

const AI_NODE_TYPES = new Set([
  '@n8n/n8n-nodes-langchain.openAi',
  '@n8n/n8n-nodes-langchain.agent',
  '@n8n/n8n-nodes-langchain.textClassifier',
  '@n8n/n8n-nodes-langchain.chainSummarization',
  '@n8n/n8n-nodes-langchain.lmChatOpenRouter',
  'n8n-nodes-base.openAi',
  'n8n-nodes-base.perplexity',
]);

const TOOL_NODE_TYPES = new Set(['@n8n/n8n-nodes-langchain.toolWorkflow']);

function extractAIPrompts(node: N8NNode): ExtractedPrompt[] {
  const prompts: ExtractedPrompt[] = [];
  const params = node.parameters;

  // Agent system message (options.systemMessage)
  if (params.options?.systemMessage) {
    const msg = String(params.options.systemMessage).replace(/^=/, '');
    prompts.push({ role: 'system', content: msg });
  }

  // Agent/AI text input (the user message)
  if (params.text) {
    const text = String(params.text).replace(/^=/, '');
    prompts.push({ role: 'user', content: text });
  }

  // OpenAI-style messages array (messages.values[])
  if (params.messages?.values) {
    for (const msg of params.messages.values) {
      if (msg.content) {
        const content = String(msg.content).replace(/^=/, '');
        const role = msg.role || (prompts.length === 0 ? 'system' : 'user');
        prompts.push({ role, content });
      }
    }
  }

  // Perplexity messages (messages.message[])
  if (params.messages?.message) {
    for (const msg of params.messages.message) {
      if (msg.content) {
        const content = String(msg.content).replace(/^=/, '');
        const role = msg.role || 'user';
        prompts.push({ role, content });
      }
    }
  }

  // Text classifier categories — keep structured (branch mapping is in formatMarkdown)
  if (params.categories?.values) {
    const catList = params.categories.values.map(
      (c: any) => `${c.category}: ${String(c.description || '').substring(0, 150)}`
    );
    prompts.push({
      role: 'categories',
      content: catList.join('\n'),
    });
    if (params.instructions) {
      prompts.push({
        role: 'system',
        content: String(params.instructions).replace(/^=/, ''),
      });
    }
  }

  // Tool workflow descriptions
  if (TOOL_NODE_TYPES.has(node.type) && params.description) {
    prompts.push({
      role: 'tool-description',
      content: String(params.description).replace(/^=/, ''),
    });
  }

  return prompts;
}

// ─── Code Block Extractor ─────────────────────────────────────────────────

function extractCodeBlocks(node: N8NNode): ExtractedCode[] {
  const blocks: ExtractedCode[] = [];
  const params = node.parameters;

  // n8n-nodes-base.code jsCode
  if (params.jsCode) {
    const code = String(params.jsCode);
    const firstLine =
      code
        .split('\n')
        .find((l) => l.trim() && !l.trim().startsWith('//'))
        ?.trim() || '';
    const commentLine =
      code
        .split('\n')
        .find((l) => l.trim().startsWith('//'))
        ?.trim() || '';
    blocks.push({
      language: 'javascript',
      code,
      summary: commentLine || firstLine.substring(0, 100),
    });
  }

  // Inline JSON body with code (HTTP request nodes)
  if (params.jsonBody && typeof params.jsonBody === 'string' && params.jsonBody.length > 200) {
    blocks.push({
      language: 'json-body',
      code: params.jsonBody,
      summary: `HTTP request body (${params.jsonBody.length} chars)`,
    });
  }

  return blocks;
}

// ─── Main Parser ──────────────────────────────────────────────────────────

interface ExtractedPrompt {
  role: string; // "system", "user", "assistant", "tool-description"
  content: string; // full text, no truncation
}

interface ExtractedCode {
  language: string;
  code: string;
  summary: string; // first line or brief description
}

interface ParsedNode {
  id: string;
  name: string;
  n8nType: string;
  operation?: string;
  mapping: {
    known: boolean;
    b0tModule?: string;
    b0tFunction?: string;
    triggerType?: string;
    category?: string;
    skip?: boolean;
  };
  keyParams: Record<string, any>;
  conditions?: ExtractedCondition[];
  emailSummary?: ReturnType<typeof summarizeEmailContent>;
  aiPrompts?: ExtractedPrompt[];
  codeBlocks?: ExtractedCode[];
  expressions: ExtractedExpression[];
  credentials: string[];
  disabled: boolean;
}

interface ParsedWorkflow {
  name: string;
  n8nId?: string;
  totalNodes: number;
  active: boolean;

  trigger: {
    nodeName: string;
    n8nType: string;
    b0tTriggerType: string;
    config: Record<string, any>;
    outputFields?: string[];
  } | null;

  nodes: ParsedNode[];
  flow: ConnectionEdge[];
  flowSummary: string; // human-readable flow
  credentials: ExtractedCredential[];
  pinData: PinDataSummary[];
  unknownNodes: string[];
  warnings: string[];
}

function parseb0tWorkflow(filePath: string, data: any): ParsedWorkflow {
  const warnings: string[] = [];
  const steps = data.config?.steps || [];

  // ── Trigger ──
  let trigger: ParsedWorkflow['trigger'] = null;
  if (data.trigger) {
    trigger = {
      nodeName: '(trigger)',
      n8nType: `b0t:${data.trigger.type}`,
      b0tTriggerType: data.trigger.type,
      config: data.trigger.config || {},
      outputFields: undefined,
    };
  }

  // ── Parse steps as nodes ──
  const parsedNodes: ParsedNode[] = [];
  for (const step of steps) {
    const expressions = extractExpressions(step.inputs || {});

    // Summarize code in JS execute steps
    let codeSummary: string | undefined;
    if (step.module === 'utilities.javascript.execute' && step.inputs?.code) {
      const code = step.inputs.code as string;
      codeSummary = code.length > 200 ? code.substring(0, 200) + '...' : code;
    }

    // Summarize email content
    let emailSummary: ReturnType<typeof summarizeEmailContent> | undefined;
    if (step.inputs) {
      for (const value of Object.values(step.inputs)) {
        if (typeof value === 'string' && (value.includes('<!DOCTYPE') || value.includes('<html'))) {
          emailSummary = summarizeEmailContent(value);
          break;
        }
      }
    }

    // Build key params (skip long code blocks)
    const keyParams: Record<string, any> = {};
    if (step.inputs) {
      for (const [key, value] of Object.entries(step.inputs)) {
        if (key === 'code' && typeof value === 'string' && value.length > 100) {
          keyParams[key] = `[JS CODE ${value.length} chars — see codeSummary]`;
        } else if (
          typeof value === 'string' &&
          (value.includes('<!DOCTYPE') || value.includes('<html'))
        ) {
          keyParams[key] = '[HTML EMAIL — see emailSummary]';
        } else {
          keyParams[key] = value;
        }
      }
    }

    const moduleParts = (step.module || '').split('.');
    parsedNodes.push({
      id: step.id,
      name: step.id,
      n8nType: `b0t:${step.module}`,
      operation: moduleParts[2] || undefined,
      mapping: {
        known: true,
        b0tModule: moduleParts.slice(0, 2).join('.'),
        b0tFunction: moduleParts[2] || undefined,
        category: moduleParts[0] || 'unknown',
      },
      keyParams,
      conditions: step.when
        ? [{ field: step.when, operator: 'when-guard', raw: step.when }]
        : undefined,
      emailSummary,
      expressions,
      credentials: [],
      disabled: false,
    });
  }

  // ── Build sequential flow ──
  const flow: ConnectionEdge[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    flow.push({
      from: steps[i].id,
      to: steps[i + 1].id,
      branch: 0,
    });
  }

  // ── Flow summary ──
  const flowLines = steps.map((s: any, i: number) => `${'  '.repeat(0)}→ ${s.id} [${s.module}]`);
  const flowSummary = (trigger ? `→ (trigger: ${data.trigger.type})\n` : '') + flowLines.join('\n');

  return {
    name: data.name,
    n8nId: undefined,
    totalNodes: steps.length,
    active: false,
    trigger,
    nodes: parsedNodes,
    flow,
    flowSummary,
    credentials: [],
    pinData: [],
    unknownNodes: [],
    warnings,
  };
}

function parseN8NWorkflow(filePath: string): ParsedWorkflow {
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  // Detect format: b0t has config.steps, N8N has nodes[]
  if (data.config?.steps && !data.nodes) {
    return parseb0tWorkflow(filePath, data);
  }

  const workflow: N8NWorkflow = data;
  const warnings: string[] = [];

  // ── Find trigger node ──
  const triggerNode = workflow.nodes.find(
    (n) => n.type.toLowerCase().includes('trigger') || n.type === 'n8n-nodes-base.webhook'
  );

  let trigger: ParsedWorkflow['trigger'] = null;
  if (triggerNode) {
    const mapping = NODE_MAPPINGS[triggerNode.type];
    const config: Record<string, any> = {};

    // Extract trigger-specific config
    if (triggerNode.parameters.pollTimes) {
      const pollMode = triggerNode.parameters.pollTimes.item?.[0]?.mode || 'unknown';
      config.pollingMode = pollMode;
      config.pollingInterval =
        pollMode === 'everyMinute'
          ? 60
          : triggerNode.parameters.pollTimes.item?.[0]?.value || 'custom';
    }
    if (triggerNode.parameters.baseId) {
      config.baseId = triggerNode.parameters.baseId.value || triggerNode.parameters.baseId;
    }
    if (triggerNode.parameters.tableId) {
      config.tableId = triggerNode.parameters.tableId.value || triggerNode.parameters.tableId;
    }
    if (triggerNode.parameters.triggerField) {
      config.triggerField = triggerNode.parameters.triggerField;
    }
    if (triggerNode.parameters.authentication) {
      config.authType = triggerNode.parameters.authentication;
    }

    // Get output fields from pinData if available
    const pinEntry = workflow.pinData?.[triggerNode.name];
    const outputFields = pinEntry?.[0]?.json
      ? Object.keys(flattenFields(pinEntry[0].json))
      : undefined;

    trigger = {
      nodeName: triggerNode.name,
      n8nType: triggerNode.type,
      b0tTriggerType: mapping?.triggerType || 'UNKNOWN',
      config,
      outputFields,
    };

    if (!mapping) {
      warnings.push(`UNKNOWN TRIGGER TYPE: ${triggerNode.type} — needs manual mapping`);
    }
  } else {
    warnings.push('NO TRIGGER NODE FOUND — workflow may be a sub-workflow');
  }

  // ── Parse all nodes ──
  const parsedNodes: ParsedNode[] = [];
  const unknownNodes: string[] = [];

  for (const node of workflow.nodes) {
    const mapping = NODE_MAPPINGS[node.type];
    const operation = node.parameters.operation || node.parameters.resource || undefined;

    // Determine b0t function from operation
    let b0tFunction: string | undefined;
    if (mapping?.operations && operation) {
      b0tFunction = mapping.operations[operation]?.b0tFunction;
      if (!b0tFunction && operation) {
        warnings.push(
          `Node "${node.name}" (${node.type}): operation "${operation}" not in mapping table`
        );
      }
    }

    // Extract key parameters (skip bulk schema data, HTML, etc.)
    const keyParams: Record<string, any> = {};
    for (const [key, value] of Object.entries(node.parameters)) {
      // Skip massive schema arrays and HTML bodies
      if (key === 'schema' || key === 'columns') {
        if (value?.schema) {
          keyParams[`${key}_fields`] = value.schema
            .filter((s: any) => !s.removed)
            .map((s: any) => `${s.id} (${s.type})`);
        } else if (value?.value) {
          keyParams[`${key}_values`] = value.value;
        }
        continue;
      }
      if (typeof value === 'string' && (value.includes('<!DOCTYPE') || value.includes('<html'))) {
        keyParams[key] = '[HTML EMAIL — see emailSummary]';
        continue;
      }
      // Unwrap __rl values
      if (value && typeof value === 'object' && value.__rl) {
        keyParams[key] = value.value;
        if (value.cachedResultName) {
          keyParams[`${key}_name`] = value.cachedResultName;
        }
        continue;
      }
      keyParams[key] = value;
    }

    // Extract conditions for IF/Switch nodes
    const conditions =
      node.type === 'n8n-nodes-base.if' || node.type === 'n8n-nodes-base.switch'
        ? extractConditions(node.parameters)
        : undefined;

    // Summarize email content if present
    let emailSummary: ReturnType<typeof summarizeEmailContent> | undefined;
    for (const value of Object.values(node.parameters)) {
      if (typeof value === 'string' && (value.includes('<!DOCTYPE') || value.includes('<html'))) {
        emailSummary = summarizeEmailContent(value);
        break;
      }
    }

    // Extract AI prompts
    const aiPrompts =
      AI_NODE_TYPES.has(node.type) || TOOL_NODE_TYPES.has(node.type)
        ? extractAIPrompts(node)
        : undefined;

    // Extract code blocks
    const codeBlocks =
      node.type === 'n8n-nodes-base.code' || node.parameters.jsCode
        ? extractCodeBlocks(node)
        : undefined;

    // Extract expressions from all parameters
    const expressions = extractExpressions(node.parameters);

    // Track unknown nodes
    if (!mapping) {
      unknownNodes.push(`${node.type} (used as: "${node.name}")`);
    }

    parsedNodes.push({
      id: node.id,
      name: node.name,
      n8nType: node.type,
      operation,
      mapping: {
        known: !!mapping,
        b0tModule: mapping?.b0tModule,
        b0tFunction,
        triggerType: mapping?.triggerType,
        category: mapping?.category,
        skip: mapping?.b0tModule === 'SKIP',
      },
      keyParams,
      conditions,
      emailSummary,
      aiPrompts: aiPrompts?.length ? aiPrompts : undefined,
      codeBlocks: codeBlocks?.length ? codeBlocks : undefined,
      expressions,
      credentials: node.credentials ? Object.keys(node.credentials) : [],
      disabled: !!node.disabled,
    });
  }

  // ── Build connection graph ──
  const flow = buildConnectionGraph(workflow.connections, workflow.nodes);

  // ── Build human-readable flow summary ──
  const flowSummary = buildFlowSummary(triggerNode?.name || '?', flow, workflow.nodes);

  return {
    name: workflow.name,
    n8nId: workflow.id,
    totalNodes: workflow.nodes.length,
    active: workflow.active,
    trigger,
    nodes: parsedNodes,
    flow,
    flowSummary,
    credentials: extractCredentials(workflow.nodes),
    pinData: extractPinData(workflow.pinData),
    unknownNodes,
    warnings,
  };
}

function buildFlowSummary(triggerName: string, edges: ConnectionEdge[], nodes: N8NNode[]): string {
  // Build adjacency list
  const adj: Record<string, { to: string; branch?: string }[]> = {};
  for (const edge of edges) {
    if (!adj[edge.from]) adj[edge.from] = [];
    adj[edge.from].push({
      to: edge.to,
      branch: edge.branchLabel,
    });
  }

  // Walk from trigger
  const visited = new Set<string>();
  const lines: string[] = [];

  function walk(nodeName: string, indent: number = 0) {
    if (visited.has(nodeName)) {
      lines.push(`${'  '.repeat(indent)}→ (loop back to ${nodeName})`);
      return;
    }
    visited.add(nodeName);

    const node = nodes.find((n) => n.name === nodeName);
    const typeShort = node?.type.replace('n8n-nodes-base.', '') || '?';
    lines.push(`${'  '.repeat(indent)}→ ${nodeName} [${typeShort}]`);

    const children = adj[nodeName] || [];
    for (const child of children) {
      if (child.branch) {
        lines.push(`${'  '.repeat(indent + 1)}(${child.branch}):`);
        walk(child.to, indent + 2);
      } else {
        walk(child.to, indent + 1);
      }
    }
  }

  walk(triggerName);

  // Find disconnected nodes
  const connectedNodes = new Set(visited);
  for (const node of nodes) {
    if (!connectedNodes.has(node.name)) {
      lines.push(`\n[DISCONNECTED] ${node.name} [${node.type.replace('n8n-nodes-base.', '')}]`);
    }
  }

  return lines.join('\n');
}

// ─── Output Formatter ─────────────────────────────────────────────────────

function formatOutput(parsed: ParsedWorkflow): string {
  const lines: string[] = [];

  lines.push('═'.repeat(70));
  lines.push(`WORKFLOW: ${parsed.name}`);
  lines.push(`Nodes: ${parsed.totalNodes} | Active: ${parsed.active}`);
  lines.push('═'.repeat(70));

  // ── Trigger ──
  lines.push('\n── TRIGGER ──────────────────────────────────────────');
  if (parsed.trigger) {
    lines.push(`Type: ${parsed.trigger.n8nType}`);
    lines.push(`b0t trigger: ${parsed.trigger.b0tTriggerType}`);
    lines.push(`Config: ${JSON.stringify(parsed.trigger.config, null, 2)}`);
    if (parsed.trigger.outputFields) {
      lines.push(`Output fields: ${parsed.trigger.outputFields.join(', ')}`);
    }
  } else {
    lines.push('NO TRIGGER FOUND');
  }

  // ── Flow ──
  lines.push('\n── FLOW ─────────────────────────────────────────────');
  lines.push(parsed.flowSummary);

  // ── Nodes ──
  lines.push('\n── NODES ────────────────────────────────────────────');
  for (const node of parsed.nodes) {
    if (node.mapping.triggerType) continue; // already shown above

    lines.push(`\n  [${node.name}]`);
    lines.push(`  N8N type: ${node.n8nType}`);
    lines.push(
      `  b0t: ${node.mapping.known ? `${node.mapping.b0tModule}.${node.mapping.b0tFunction || node.operation || '?'}` : '⚠ UNKNOWN'}`
    );
    if (node.operation) lines.push(`  Operation: ${node.operation}`);
    if (node.mapping.skip) lines.push(`  → SKIP (no-op node)`);
    if (node.disabled) lines.push(`  → DISABLED`);

    // Key params (condensed)
    const paramEntries = Object.entries(node.keyParams).filter(
      ([_, v]) => v !== undefined && v !== '' && v !== null
    );
    if (paramEntries.length > 0) {
      lines.push(`  Params:`);
      for (const [key, value] of paramEntries) {
        const display =
          typeof value === 'object'
            ? JSON.stringify(value).substring(0, 120)
            : String(value).substring(0, 120);
        lines.push(`    ${key}: ${display}`);
      }
    }

    // Conditions (IF/Switch)
    if (node.conditions?.length) {
      lines.push(`  Conditions:`);
      for (const cond of node.conditions) {
        lines.push(`    ${cond.raw}`);
      }
    }

    // AI Prompts (full content, never truncated)
    if (node.aiPrompts?.length) {
      lines.push(`  AI Prompts:`);
      for (const prompt of node.aiPrompts) {
        lines.push(`    [${prompt.role}]:`);
        // Indent each line of the prompt
        const promptLines = prompt.content.split('\n');
        for (const pl of promptLines) {
          lines.push(`      ${pl}`);
        }
      }
    }

    // Code blocks (full content)
    if (node.codeBlocks?.length) {
      lines.push(`  Code:`);
      for (const block of node.codeBlocks) {
        lines.push(`    Language: ${block.language}`);
        lines.push(`    Summary: ${block.summary}`);
        lines.push(`    ┌─────────────────────────────────────`);
        const codeLines = block.code.split('\n');
        for (const cl of codeLines) {
          lines.push(`    │ ${cl}`);
        }
        lines.push(`    └─────────────────────────────────────`);
      }
    }

    // Email summary
    if (node.emailSummary) {
      lines.push(`  Email content:`);
      lines.push(`    Dynamic fields: ${node.emailSummary.dynamicFields.join(', ')}`);
      lines.push(`    Has signature: ${node.emailSummary.hasSignature}`);
      if (node.emailSummary.links.length > 0) {
        lines.push(`    Links:`);
        for (const link of node.emailSummary.links) {
          lines.push(`      "${link.text}" → ${link.url}`);
        }
      }
      lines.push(`    Preview: ${node.emailSummary.textPreview}`);
    }

    // Expressions
    if (node.expressions.length > 0) {
      lines.push(`  Expressions:`);
      for (const expr of node.expressions) {
        if (expr.type === 'named-node') {
          lines.push(
            `    ${expr.path}: references "${expr.referencesNode}" → ${expr.referencesField}`
          );
        } else if (expr.type === 'self') {
          lines.push(`    ${expr.path}: reads $json.${expr.referencesField}`);
        } else if (expr.type === 'inline-js') {
          lines.push(`    ${expr.path}: inline JS → ${expr.raw.substring(0, 80)}`);
        } else {
          lines.push(`    ${expr.path}: ${expr.raw.substring(0, 80)}`);
        }
      }
    }

    // Credentials
    if (node.credentials.length > 0) {
      lines.push(`  Credentials: ${node.credentials.join(', ')}`);
    }
  }

  // ── Credentials Summary ──
  lines.push('\n── CREDENTIALS ──────────────────────────────────────');
  const credTypes = new Map<string, string[]>();
  for (const cred of parsed.credentials) {
    if (!credTypes.has(cred.credentialType)) {
      credTypes.set(cred.credentialType, []);
    }
    credTypes.get(cred.credentialType)!.push(cred.nodeName);
  }
  for (const [type, users] of credTypes) {
    lines.push(`  ${type}: used by ${users.join(', ')}`);
  }

  // ── Pin Data (Sample Data) ──
  if (parsed.pinData.length > 0) {
    lines.push('\n── SAMPLE DATA (from pin data) ──────────────────────');
    for (const pin of parsed.pinData) {
      lines.push(`  ${pin.nodeName} (${pin.itemCount} items):`);
      for (const [field, value] of Object.entries(pin.sampleValues)) {
        const display = String(value).substring(0, 80);
        lines.push(`    ${field}: ${display}`);
      }
    }
  }

  // ── Warnings ──
  if (parsed.warnings.length > 0 || parsed.unknownNodes.length > 0) {
    lines.push('\n── WARNINGS ─────────────────────────────────────────');
    for (const w of parsed.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
    for (const u of parsed.unknownNodes) {
      lines.push(`  ⚠ UNKNOWN NODE: ${u}`);
    }
  }

  lines.push('\n' + '═'.repeat(70));
  return lines.join('\n');
}

// ─── Markdown Formatter (v2 — structured for AI consumption) ─────────────
//
// Output is organized by WHAT YOU NEED TO KNOW, in the order you need it:
//   1. WORKFLOW BRIEF — plain English summary
//   2. TRIGGER — what starts it and what data comes in
//   3. SERVICES & CREDENTIALS — the "shopping list" of integrations needed
//   4. FLOW DIAGRAM — connection graph
//   5. BUSINESS LOGIC — AI prompts, classifier branches, IF/Switch conditions
//   6. DATA PIPELINE — per-step inputs/outputs, expression mappings
//   7. CODE BLOCKS — full JavaScript from code nodes
//   8. EMAIL TEMPLATES — template content with dynamic fields
//   9. STEP REFERENCE — per-node config (action nodes only, no duplication)
//  10. SAMPLE DATA — pin data / test data
//  11. UNKNOWNS & WARNINGS — unmapped nodes, missing info

function formatMarkdown(parsed: ParsedWorkflow): string {
  const lines: string[] = [];

  // ── Categorize nodes ──
  const triggerNodes = parsed.nodes.filter((n) => n.mapping.triggerType);
  const aiNodes = parsed.nodes.filter(
    (n) => !n.mapping.triggerType && (n.aiPrompts?.length || AI_NODE_TYPES.has(n.n8nType))
  );
  const conditionNodes = parsed.nodes.filter(
    (n) =>
      !n.mapping.triggerType &&
      (n.conditions?.length ||
        n.n8nType === 'n8n-nodes-base.if' ||
        n.n8nType === 'n8n-nodes-base.switch')
  );
  const codeNodes = parsed.nodes.filter((n) => !n.mapping.triggerType && n.codeBlocks?.length);
  const emailNodes = parsed.nodes.filter((n) => !n.mapping.triggerType && n.emailSummary);
  const actionNodes = parsed.nodes.filter(
    (n) =>
      !n.mapping.triggerType &&
      !n.aiPrompts?.length &&
      !n.codeBlocks?.length &&
      !n.emailSummary &&
      !n.conditions?.length &&
      !AI_NODE_TYPES.has(n.n8nType) &&
      n.n8nType !== 'n8n-nodes-base.if' &&
      n.n8nType !== 'n8n-nodes-base.switch'
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. WORKFLOW BRIEF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  lines.push(`# ${parsed.name}`);
  lines.push(`**${parsed.totalNodes} nodes** | **Active:** ${parsed.active}\n`);

  // Auto-generate a brief from the structure
  const services = new Set<string>();
  for (const node of parsed.nodes) {
    if (node.mapping.b0tModule && node.mapping.b0tModule !== 'SKIP') {
      const svc = node.mapping.b0tModule.split('.')[1] || node.mapping.b0tModule;
      if (!['javascript', 'delay', 'http', 'control-flow'].includes(svc)) {
        services.add(svc);
      }
    }
    // Also capture unknown service names
    if (!node.mapping.known) {
      const shortType = node.n8nType
        .replace('n8n-nodes-base.', '')
        .replace('@n8n/n8n-nodes-langchain.', '');
      services.add(shortType);
    }
  }

  const triggerDesc = parsed.trigger
    ? `Triggered by **${parsed.trigger.b0tTriggerType}**`
    : 'No trigger detected';
  const serviceList = [...services].join(', ');
  lines.push(`> ${triggerDesc}. Services: ${serviceList || 'none detected'}.`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. TRIGGER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  lines.push(`\n---\n\n## Trigger`);
  if (parsed.trigger) {
    lines.push(`- **N8N type:** \`${parsed.trigger.n8nType}\``);
    lines.push(`- **b0t trigger type:** \`${parsed.trigger.b0tTriggerType}\``);
    if (Object.keys(parsed.trigger.config).length > 0) {
      lines.push(`- **Config:**`);
      for (const [k, v] of Object.entries(parsed.trigger.config)) {
        lines.push(`  - ${k}: \`${typeof v === 'object' ? JSON.stringify(v) : v}\``);
      }
    }
    if (parsed.trigger.outputFields?.length) {
      lines.push(`- **Data shape (fields available to all steps):**`);
      lines.push(`  \`${parsed.trigger.outputFields.join('`, `')}\``);
    }
  } else {
    lines.push('**No trigger found** — this may be a sub-workflow or manually triggered.');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. SERVICES & CREDENTIALS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  lines.push(`\n---\n\n## Services & Credentials`);
  if (parsed.credentials.length > 0) {
    lines.push(`| Service | Credential Type | Used By |`);
    lines.push(`|---------|----------------|---------|`);
    const credMap = new Map<string, { type: string; nodes: string[] }>();
    for (const cred of parsed.credentials) {
      const key = cred.credentialType;
      if (!credMap.has(key)) credMap.set(key, { type: key, nodes: [] });
      credMap.get(key)!.nodes.push(cred.nodeName);
    }
    for (const [type, info] of credMap) {
      // Derive a human-friendly service name from credential type
      const svcName = type
        .replace('OAuth2Api', '')
        .replace('OAuth2', '')
        .replace('Api', '')
        .replace('TokenApi', '')
        .replace(/([A-Z])/g, ' $1')
        .trim();
      lines.push(`| ${svcName} | \`${type}\` | ${info.nodes.join(', ')} |`);
    }
  } else {
    lines.push('No credentials detected.');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. FLOW DIAGRAM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  lines.push(`\n---\n\n## Flow Diagram`);
  lines.push('```');
  lines.push(parsed.flowSummary);
  lines.push('```');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. BUSINESS LOGIC
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const hasBusinessLogic = aiNodes.length > 0 || conditionNodes.length > 0;
  if (hasBusinessLogic) {
    lines.push(`\n---\n\n## Business Logic`);

    // AI nodes with full prompts
    for (const node of aiNodes) {
      lines.push(`\n### AI: ${node.name}`);
      lines.push(`- **N8N type:** \`${node.n8nType}\``);
      lines.push(`- **b0t module:** \`${node.mapping.b0tModule || 'UNKNOWN'}\``);

      // Model info
      const model = node.keyParams.modelId || node.keyParams.model || node.keyParams.modelId_name;
      if (model) {
        lines.push(`- **Model:** \`${model}\``);
      }

      // Credentials
      if (node.credentials.length) {
        lines.push(`- **Credentials:** ${node.credentials.join(', ')}`);
      }

      // Text classifier categories with branch mapping
      if (node.n8nType.includes('textClassifier')) {
        const categories = node.keyParams.categories;
        if (categories?.categories) {
          lines.push(`\n**Categories (branch → action):**`);
          const cats = categories.categories;
          for (let i = 0; i < cats.length; i++) {
            const cat = cats[i];
            // Find what branch i connects to from the flow
            const branchTargets = parsed.flow
              .filter((e) => e.from === node.name && e.branch === i)
              .map((e) => e.to);
            const targetStr = branchTargets.length ? ` → ${branchTargets.join(', ')}` : '';
            lines.push(`| Branch ${i} | **${cat.category}**${targetStr} |`);
            if (cat.description) {
              lines.push(`|  | ${String(cat.description).substring(0, 200)} |`);
            }
          }
        }

        // Input text for classifier
        if (node.keyParams.inputText) {
          lines.push(`\n**Classifier input:**`);
          lines.push('```');
          lines.push(String(node.keyParams.inputText).replace(/^=/, ''));
          lines.push('```');
        }
      }

      // Full prompts — NEVER truncated
      if (node.aiPrompts?.length) {
        for (const prompt of node.aiPrompts) {
          lines.push(`\n**${prompt.role.toUpperCase()} PROMPT** (${prompt.content.length} chars):`);
          lines.push('```');
          lines.push(prompt.content);
          lines.push('```');
        }
      }

      // Data flowing INTO this AI node
      if (node.expressions.length > 0) {
        lines.push(`\n**Inputs (data flow):**`);
        const seen = new Set<string>();
        for (const expr of node.expressions) {
          let line: string;
          if (expr.type === 'named-node') {
            line = `- \`${expr.referencesNode}\` → \`${expr.referencesField}\``;
          } else if (expr.type === 'self') {
            line = `- previous step → \`${expr.referencesField}\``;
          } else if (expr.type === 'inline-js') {
            line = `- JS expression: \`${expr.raw.substring(0, 100)}\``;
          } else {
            line = `- \`${expr.raw.substring(0, 100)}\``;
          }
          if (!seen.has(line)) {
            seen.add(line);
            lines.push(line);
          }
        }
      }
    }

    // IF / Switch conditions
    for (const node of conditionNodes) {
      lines.push(`\n### Condition: ${node.name}`);
      lines.push(`- **Type:** \`${node.n8nType}\``);

      if (node.conditions?.length) {
        lines.push(`\n**Conditions:**`);
        for (const cond of node.conditions) {
          lines.push(`- \`${cond.raw}\``);
        }
      }

      // Branch targets
      const branches = parsed.flow.filter((e) => e.from === node.name);
      if (branches.length > 0) {
        lines.push(`\n**Branches:**`);
        const branchGroups = new Map<number, string[]>();
        for (const b of branches) {
          if (!branchGroups.has(b.branch)) branchGroups.set(b.branch, []);
          branchGroups.get(b.branch)!.push(b.to);
        }
        for (const [idx, targets] of branchGroups) {
          const label =
            node.n8nType === 'n8n-nodes-base.if' ? (idx === 0 ? 'TRUE' : 'FALSE') : `Branch ${idx}`;
          lines.push(`- **${label}** → ${targets.join(', ')}`);
        }
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. DATA PIPELINE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const nodesWithDataFlow = parsed.nodes.filter(
    (n) => !n.mapping.triggerType && n.expressions.length > 0
  );
  if (nodesWithDataFlow.length > 0) {
    lines.push(`\n---\n\n## Data Pipeline`);
    lines.push(`How data flows between steps. N8N expressions on the left, source on the right.\n`);

    for (const node of nodesWithDataFlow) {
      // Skip AI nodes already covered in Business Logic — but only if they have no unique expression info
      if (aiNodes.includes(node)) continue;

      lines.push(`**${node.name}:**`);
      const seen = new Set<string>();
      for (const expr of node.expressions) {
        let line: string;
        if (expr.type === 'named-node') {
          line = `- \`${expr.path}\` ← **${expr.referencesNode}**.\`${expr.referencesField}\``;
        } else if (expr.type === 'self') {
          line = `- \`${expr.path}\` ← previous.\`${expr.referencesField}\``;
        } else if (expr.type === 'inline-js') {
          line = `- \`${expr.path}\` ← JS: \`${expr.raw.substring(0, 100)}\``;
        } else {
          line = `- \`${expr.path}\` ← \`${expr.raw.substring(0, 100)}\``;
        }
        if (!seen.has(line)) {
          seen.add(line);
          lines.push(line);
        }
      }
      lines.push('');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. CODE BLOCKS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (codeNodes.length > 0) {
    lines.push(`\n---\n\n## Code Blocks`);
    for (const node of codeNodes) {
      lines.push(`\n### ${node.name}`);

      // Brief description of what the code does (first comment or first line)
      for (const block of node.codeBlocks!) {
        if (block.summary) {
          lines.push(`> ${block.summary}`);
        }
        lines.push(`\n\`\`\`javascript`);
        lines.push(block.code);
        lines.push('```');
      }

      // What data this code node receives
      if (node.expressions.length > 0) {
        lines.push(`\n**Receives data from:**`);
        const seen = new Set<string>();
        for (const expr of node.expressions) {
          let src: string;
          if (expr.type === 'named-node') {
            src = `- **${expr.referencesNode}**.\`${expr.referencesField}\``;
          } else if (expr.type === 'self') {
            src = `- previous step → \`${expr.referencesField}\``;
          } else {
            src = `- \`${expr.raw.substring(0, 80)}\``;
          }
          if (!seen.has(src)) {
            seen.add(src);
            lines.push(src);
          }
        }
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. EMAIL TEMPLATES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (emailNodes.length > 0) {
    lines.push(`\n---\n\n## Email Templates`);
    for (const node of emailNodes) {
      lines.push(`\n### ${node.name}`);
      lines.push(`- **Service:** \`${node.mapping.b0tModule || node.n8nType}\``);
      if (node.credentials.length) {
        lines.push(`- **Credentials:** ${node.credentials.join(', ')}`);
      }

      // To / Subject
      if (node.keyParams.toRecipients || node.keyParams.sendTo) {
        lines.push(`- **To:** \`${node.keyParams.toRecipients || node.keyParams.sendTo}\``);
      }
      if (node.keyParams.subject) {
        lines.push(`- **Subject:** \`${node.keyParams.subject}\``);
      }

      const summary = node.emailSummary!;
      lines.push(`- **Dynamic fields:** ${summary.dynamicFields.join(', ')}`);
      if (summary.hasSignature) lines.push(`- **Has signature block:** yes`);
      if (summary.links.length > 0) {
        lines.push(`- **Links:**`);
        for (const link of summary.links) {
          lines.push(`  - "${link.text}" → \`${link.url}\``);
        }
      }
      if (summary.textPreview) {
        lines.push(`\n**Email body preview:**`);
        lines.push(`> ${summary.textPreview}`);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP REFERENCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Only action nodes — AI, code, email, conditions already covered above
  if (actionNodes.length > 0) {
    lines.push(`\n---\n\n## Step Reference`);
    lines.push(
      `Action nodes not covered above. Each shows N8N type, b0t mapping, and key params.\n`
    );

    for (const node of actionNodes) {
      if (node.mapping.skip) continue;
      lines.push(`**${node.name}**`);
      const b0tPath = node.mapping.known
        ? `\`${node.mapping.b0tModule}.${node.mapping.b0tFunction || node.operation || '?'}\``
        : 'UNKNOWN';
      lines.push(`- N8N: \`${node.n8nType}\` → b0t: ${b0tPath}`);
      if (node.credentials.length) {
        lines.push(`- Credentials: ${node.credentials.join(', ')}`);
      }

      // Key params — skip noise
      const skipKeys = new Set([
        'options',
        'additionalFields',
        'messages',
        'categories',
        'inputText',
        'jsCode',
      ]);
      const paramEntries = Object.entries(node.keyParams).filter(
        ([k, v]) => v !== undefined && v !== '' && v !== null && !skipKeys.has(k)
      );
      if (paramEntries.length > 0) {
        for (const [key, value] of paramEntries) {
          const display =
            typeof value === 'object'
              ? JSON.stringify(value).substring(0, 200)
              : String(value).substring(0, 200);
          lines.push(`- ${key}: \`${display}\``);
        }
      }
      lines.push('');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 10. SAMPLE DATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (parsed.pinData.length > 0) {
    lines.push(`\n---\n\n## Sample Data`);
    lines.push(
      `Real values from test runs (pin data). Use these to understand field names and shapes.\n`
    );

    for (const pin of parsed.pinData) {
      lines.push(`**${pin.nodeName}** (${pin.itemCount} items):`);
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      for (const [field, value] of Object.entries(pin.sampleValues)) {
        lines.push(`| ${field} | ${String(value).substring(0, 80)} |`);
      }
      lines.push('');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 11. UNKNOWNS & WARNINGS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (parsed.warnings.length > 0 || parsed.unknownNodes.length > 0) {
    lines.push(`\n---\n\n## Unknowns & Warnings`);
    lines.push(`These need manual attention before conversion.\n`);

    if (parsed.unknownNodes.length > 0) {
      lines.push(`**Unknown node types (no b0t mapping):**`);
      for (const u of parsed.unknownNodes) {
        lines.push(`- ${u}`);
      }
    }
    if (parsed.warnings.length > 0) {
      lines.push(`\n**Warnings:**`);
      for (const w of parsed.warnings) {
        lines.push(`- ${w}`);
      }
    }
  }

  return lines.join('\n');
}

// ─── YAML Formatter ───────────────────────────────────────────────────────

function formatYAML(parsed: ParsedWorkflow): string {
  const lines: string[] = [];

  lines.push(`workflow: "${parsed.name}"`);
  lines.push(`nodes: ${parsed.totalNodes}`);
  lines.push(`active: ${parsed.active}`);

  // Trigger
  if (parsed.trigger) {
    lines.push(`trigger:`);
    lines.push(`  n8nType: ${parsed.trigger.n8nType}`);
    lines.push(`  b0tType: ${parsed.trigger.b0tTriggerType}`);
    if (Object.keys(parsed.trigger.config).length > 0) {
      lines.push(`  config:`);
      for (const [k, v] of Object.entries(parsed.trigger.config)) {
        lines.push(`    ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
    if (parsed.trigger.outputFields) {
      lines.push(`  outputFields: [${parsed.trigger.outputFields.join(', ')}]`);
    }
  }

  // Flow
  lines.push(`flow: |`);
  for (const line of parsed.flowSummary.split('\n')) {
    lines.push(`  ${line}`);
  }

  // Nodes
  lines.push(`nodes:`);
  for (const node of parsed.nodes) {
    if (node.mapping.triggerType) continue;

    lines.push(`  - name: "${node.name}"`);
    lines.push(`    n8nType: ${node.n8nType}`);
    lines.push(
      `    b0t: ${node.mapping.known ? `${node.mapping.b0tModule}.${node.mapping.b0tFunction || node.operation || '?'}` : 'UNKNOWN'}`
    );
    if (node.operation) lines.push(`    operation: ${node.operation}`);
    if (node.credentials.length) lines.push(`    credentials: [${node.credentials.join(', ')}]`);
    if (node.disabled) lines.push(`    disabled: true`);

    // Key params (concise)
    const skipKeys = new Set(['options', 'additionalFields']);
    const paramEntries = Object.entries(node.keyParams).filter(
      ([k, v]) => v !== undefined && v !== '' && v !== null && !skipKeys.has(k)
    );
    if (paramEntries.length > 0) {
      lines.push(`    params:`);
      for (const [key, value] of paramEntries) {
        if (typeof value === 'object') {
          lines.push(`      ${key}: ${JSON.stringify(value).substring(0, 150)}`);
        } else {
          const strVal = String(value);
          if (strVal.length > 150) {
            lines.push(`      ${key}: "${strVal.substring(0, 150)}..." # ${strVal.length} chars`);
          } else {
            lines.push(`      ${key}: "${strVal}"`);
          }
        }
      }
    }

    // Conditions
    if (node.conditions?.length) {
      lines.push(`    conditions:`);
      for (const cond of node.conditions) {
        lines.push(`      - "${cond.raw}"`);
      }
    }

    // AI Prompts
    if (node.aiPrompts?.length) {
      lines.push(`    prompts:`);
      for (const prompt of node.aiPrompts) {
        lines.push(`      ${prompt.role}: | # ${prompt.content.length} chars`);
        for (const pl of prompt.content.split('\n')) {
          lines.push(`        ${pl}`);
        }
      }
    }

    // Code blocks
    if (node.codeBlocks?.length) {
      lines.push(`    code:`);
      for (const block of node.codeBlocks) {
        lines.push(`      language: ${block.language}`);
        lines.push(`      summary: "${block.summary}"`);
        lines.push(`      source: | # ${block.code.length} chars`);
        for (const cl of block.code.split('\n')) {
          lines.push(`        ${cl}`);
        }
      }
    }

    // Email summary
    if (node.emailSummary) {
      lines.push(`    email:`);
      lines.push(`      dynamicFields: [${node.emailSummary.dynamicFields.join(', ')}]`);
      lines.push(`      hasSignature: ${node.emailSummary.hasSignature}`);
      if (node.emailSummary.links.length > 0) {
        lines.push(`      links:`);
        for (const link of node.emailSummary.links) {
          lines.push(`        - text: "${link.text}"`);
          lines.push(`          url: "${link.url}"`);
        }
      }
    }

    // Data flow
    if (node.expressions.length > 0) {
      lines.push(`    dataFlow:`);
      for (const expr of node.expressions) {
        if (expr.type === 'named-node') {
          lines.push(`      - from: "${expr.referencesNode}"`);
          lines.push(`        field: ${expr.referencesField}`);
          lines.push(`        into: ${expr.path}`);
        } else if (expr.type === 'self') {
          lines.push(`      - input: ${expr.referencesField}`);
          lines.push(`        into: ${expr.path}`);
        } else if (expr.type === 'inline-js') {
          lines.push(`      - js: "${expr.raw.substring(0, 80)}"`);
          lines.push(`        into: ${expr.path}`);
        }
      }
    }
  }

  // Credentials
  lines.push(`credentials:`);
  const credTypes = new Map<string, string[]>();
  for (const cred of parsed.credentials) {
    if (!credTypes.has(cred.credentialType)) credTypes.set(cred.credentialType, []);
    credTypes.get(cred.credentialType)!.push(cred.nodeName);
  }
  for (const [type, users] of credTypes) {
    lines.push(`  ${type}: [${users.join(', ')}]`);
  }

  // Warnings
  if (parsed.warnings.length > 0 || parsed.unknownNodes.length > 0) {
    lines.push(`warnings:`);
    for (const w of parsed.warnings) lines.push(`  - "${w}"`);
    for (const u of parsed.unknownNodes) lines.push(`  - "UNKNOWN: ${u}"`);
  }

  return lines.join('\n');
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const formatFlag = args.find((a) => a.startsWith('--format='))?.split('=')[1] || 'text';
const filePath = args.find((a) => !a.startsWith('--'));

if (!filePath) {
  console.error(
    'Usage: npx tsx scripts/parse-n8n-workflow.ts <path-to-n8n-json> [--format=text|markdown|yaml]'
  );
  process.exit(1);
}

const resolved = resolve(filePath);
console.log(`Parsing: ${resolved} (format: ${formatFlag})\n`);

try {
  const parsed = parseN8NWorkflow(resolved);

  switch (formatFlag) {
    case 'markdown':
    case 'md':
      console.log(formatMarkdown(parsed));
      break;
    case 'yaml':
    case 'yml':
      console.log(formatYAML(parsed));
      break;
    case 'text':
    default:
      console.log(formatOutput(parsed));
      break;
  }
} catch (err: any) {
  console.error(`Failed to parse: ${err.message}`);
  process.exit(1);
}
