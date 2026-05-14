/**
 * Converts a workflow JSON config into a Mermaid flowchart string.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkflowInput {
  name: string;
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
  config: {
    steps: unknown[];
    returnValue?: string;
  };
}

interface ActionStep {
  type?: 'action';
  id: string;
  module: string;
  inputs?: Record<string, unknown>;
  outputAs?: string;
  when?: string;
  optional?: boolean;
}

interface ConditionStep {
  type: 'condition';
  id: string;
  condition: string;
  then: Step[];
  else?: Step[];
}

interface ForEachStep {
  type: 'forEach';
  id: string;
  array: string;
  itemAs: string;
  indexAs?: string;
  maxIterations?: number;
  steps: Step[];
}

interface WhileStep {
  type: 'while';
  id: string;
  condition: string;
  maxIterations?: number;
  steps: Step[];
}

type Step = ActionStep | ConditionStep | ForEachStep | WhileStep;

// ── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_ICONS: Record<string, string> = {
  manual: '▶️',
  cron: '⏰',
  webhook: '🔗',
  gmail: '📧',
  outlook: '📧',
  telegram: '✈️',
  discord: '🎮',
  chat: '💬',
  'chat-input': '💬',
  airtable: '📊',
};

const CATEGORY_ICONS: Record<string, string> = {
  ai: '🤖',
  communication: '📧',
  data: '📦',
  social: '🌐',
  utilities: '📝',
  web: '🌐',
  leads: '🔍',
};

const CATEGORY_CLASS: Record<string, string> = {
  ai: 'ai',
  communication: 'communication',
  data: 'data',
  social: 'social',
  utilities: 'utilities',
  web: 'data',
  leads: 'data',
};

const FUNCTION_LABELS: Record<string, string> = {
  generateText: 'Generate Text',
  generateJSON: 'Generate JSON',
  generateObject: 'Generate Object',
  runAgent: 'Run Agent',
  sendEmail: 'Send Email',
  sendMessage: 'Send Message',
  addLabels: 'Add Labels',
  removeLabels: 'Remove Labels',
  markAsRead: 'Mark as Read',
  execute: 'Run Script',
  uploadFileFromParams: 'Upload File',
  searchEmails: 'Search Emails',
  getEmail: 'Get Email',
  listEmails: 'List Emails',
  httpRequest: 'HTTP Request',
  scrape: 'Scrape Page',
  search: 'Web Search',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize a string for use as a mermaid node ID.
 * Mermaid IDs must be alphanumeric with underscores/hyphens.
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Escape text for use inside mermaid node labels (quoted strings).
 * Replaces double quotes and other problematic characters.
 */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/[[\]{}()#&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convert a camelCase or PascalCase function name to a spaced label.
 * e.g. "generateText" → "Generate Text", "uploadFileFromParams" → "Upload File From Params"
 */
function camelToTitle(str: string): string {
  return str
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/**
 * Converts a module path like `ai.ai-sdk.generateText` to a human-readable label.
 * e.g. "Generate Text", "Send Email", "Run Script"
 */
export function moduleToLabel(modulePath: string): string {
  const parts = modulePath.split('.');
  const functionName = parts[parts.length - 1] ?? modulePath;
  return FUNCTION_LABELS[functionName] ?? camelToTitle(functionName);
}

function getStepType(step: unknown): string {
  const s = step as Record<string, unknown>;
  if (typeof s.type === 'string') return s.type;
  if (s.module) return 'action';
  return 'action';
}

function getCategoryFromModule(modulePath: string): string {
  const category = modulePath.split('.')[0] ?? 'utilities';
  return category;
}

function getCategoryClass(modulePath: string): string {
  const category = getCategoryFromModule(modulePath);
  return CATEGORY_CLASS[category] ?? 'utilities';
}

function getCategoryIcon(modulePath: string): string {
  const category = getCategoryFromModule(modulePath);
  return CATEGORY_ICONS[category] ?? '⚙️';
}

// ── Mermaid Generation ───────────────────────────────────────────────────────

interface MermaidContext {
  nodes: string[];
  edges: string[];
  subgraphs: string[];
  counter: number;
}

function nextId(ctx: MermaidContext, prefix: string): string {
  ctx.counter++;
  return `${prefix}_${ctx.counter}`;
}

/**
 * Process a list of steps and return the first and last node IDs for connection.
 * Returns [firstNodeId, lastNodeId] or null if empty.
 */
function processSteps(
  ctx: MermaidContext,
  steps: unknown[],
  prevNodeId: string | null
): string | null {
  let lastNodeId = prevNodeId;

  for (const rawStep of steps) {
    const step = rawStep as Record<string, unknown>;
    const type = getStepType(step);

    if (type === 'condition') {
      lastNodeId = processConditionStep(ctx, step as unknown as ConditionStep, lastNodeId);
    } else if (type === 'forEach') {
      lastNodeId = processForEachStep(ctx, step as unknown as ForEachStep, lastNodeId);
    } else if (type === 'while') {
      lastNodeId = processWhileStep(ctx, step as unknown as WhileStep, lastNodeId);
    } else {
      lastNodeId = processActionStep(ctx, step as unknown as ActionStep, lastNodeId);
    }
  }

  return lastNodeId;
}

function processActionStep(
  ctx: MermaidContext,
  step: ActionStep,
  prevNodeId: string | null
): string {
  const nodeId = sanitizeId(step.id || nextId(ctx, 'step'));
  const modulePath = step.module || 'utilities.unknown.unknown';
  const icon = getCategoryIcon(modulePath);
  const label = moduleToLabel(modulePath);
  const optionalTag = step.optional ? ' (optional)' : '';
  const cls = getCategoryClass(modulePath);

  if (step.when) {
    // Steps with `when` get a dashed border style
    ctx.nodes.push(
      `    ${nodeId}["${icon} ${escapeLabel(label + optionalTag)}"]:::${cls}_conditional`
    );
  } else {
    ctx.nodes.push(`    ${nodeId}["${icon} ${escapeLabel(label + optionalTag)}"]:::${cls}`);
  }

  if (prevNodeId) {
    if (step.when) {
      const conditionLabel = escapeLabel(truncate(step.when, 30));
      ctx.edges.push(`    ${prevNodeId} -.->|"${conditionLabel}"| ${nodeId}`);
    } else {
      ctx.edges.push(`    ${prevNodeId} --> ${nodeId}`);
    }
  }

  return nodeId;
}

function processConditionStep(
  ctx: MermaidContext,
  step: ConditionStep,
  prevNodeId: string | null
): string {
  const nodeId = sanitizeId(step.id || nextId(ctx, 'cond'));
  const conditionLabel = escapeLabel(truncate(step.condition, 40));
  const mergeId = nextId(ctx, 'merge');

  // Diamond node for condition
  ctx.nodes.push(`    ${nodeId}{{"${conditionLabel}"}}:::condition`);

  if (prevNodeId) {
    ctx.edges.push(`    ${prevNodeId} --> ${nodeId}`);
  }

  // Then branch
  if (step.then && step.then.length > 0) {
    const thenLast = processSteps(ctx, step.then, null);
    // Connect condition to first then step
    const thenFirst = sanitizeId((step.then[0] as Step).id);
    ctx.edges.push(`    ${nodeId} -->|"Yes"| ${thenFirst}`);
    if (thenLast) {
      ctx.edges.push(`    ${thenLast} --> ${mergeId}`);
    }
  } else {
    ctx.edges.push(`    ${nodeId} -->|"Yes"| ${mergeId}`);
  }

  // Else branch
  if (step.else && step.else.length > 0) {
    const elseLast = processSteps(ctx, step.else, null);
    const elseFirst = sanitizeId((step.else[0] as Step).id);
    ctx.edges.push(`    ${nodeId} -->|"No"| ${elseFirst}`);
    if (elseLast) {
      ctx.edges.push(`    ${elseLast} --> ${mergeId}`);
    }
  } else {
    ctx.edges.push(`    ${nodeId} -->|"No"| ${mergeId}`);
  }

  // Invisible merge point
  ctx.nodes.push(`    ${mergeId}((" ")):::merge`);

  return mergeId;
}

function processForEachStep(
  ctx: MermaidContext,
  step: ForEachStep,
  prevNodeId: string | null
): string {
  const nodeId = sanitizeId(step.id || nextId(ctx, 'foreach'));
  const arrayLabel = escapeLabel(truncate(step.array, 30));
  const endId = nextId(ctx, 'end_loop');

  ctx.subgraphs.push(`    subgraph ${nodeId}_sub["🔄 forEach: ${arrayLabel}"]`);

  if (step.steps && step.steps.length > 0) {
    const innerLast = processSteps(ctx, step.steps, null);
    // Connect inner steps within subgraph
    const innerFirst = sanitizeId((step.steps[0] as Step).id);
    if (prevNodeId) {
      ctx.edges.push(`    ${prevNodeId} --> ${innerFirst}`);
    }
    if (innerLast) {
      ctx.edges.push(`    ${innerLast} --> ${endId}`);
    }
  }

  ctx.subgraphs.push('    end');
  ctx.nodes.push(`    ${endId}((" ")):::merge`);

  return endId;
}

function processWhileStep(ctx: MermaidContext, step: WhileStep, prevNodeId: string | null): string {
  const nodeId = sanitizeId(step.id || nextId(ctx, 'while'));
  const condLabel = escapeLabel(truncate(step.condition, 30));
  const endId = nextId(ctx, 'end_while');

  ctx.subgraphs.push(`    subgraph ${nodeId}_sub["🔁 while: ${condLabel}"]`);

  if (step.steps && step.steps.length > 0) {
    const innerLast = processSteps(ctx, step.steps, null);
    const innerFirst = sanitizeId((step.steps[0] as Step).id);
    if (prevNodeId) {
      ctx.edges.push(`    ${prevNodeId} --> ${innerFirst}`);
    }
    if (innerLast) {
      ctx.edges.push(`    ${innerLast} --> ${endId}`);
    }
  }

  ctx.subgraphs.push('    end');
  ctx.nodes.push(`    ${endId}((" ")):::merge`);

  return endId;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

// ── Main Export ──────────────────────────────────────────────────────────────

/**
 * Convert a workflow JSON config into a Mermaid flowchart string.
 */
export function workflowToMermaid(workflow: WorkflowInput): string {
  const triggerType = workflow.trigger?.type ?? 'manual';
  const triggerIcon = TRIGGER_ICONS[triggerType] ?? '▶️';
  const triggerLabel = `${triggerType.charAt(0).toUpperCase()}${triggerType.slice(1)}`;
  const steps = (workflow.config?.steps ?? []) as unknown[];

  const ctx: MermaidContext = {
    nodes: [],
    edges: [],
    subgraphs: [],
    counter: 0,
  };

  // Trigger node
  const triggerId = 'trigger';
  ctx.nodes.push(
    `    ${triggerId}["${triggerIcon} ${escapeLabel(triggerLabel)} Trigger"]:::trigger`
  );

  // Output node
  const outputId = 'output';

  // Process all steps
  const lastNodeId = processSteps(ctx, steps, triggerId);

  // Output node
  ctx.nodes.push(`    ${outputId}(["📤 Output"]):::output`);

  if (lastNodeId) {
    ctx.edges.push(`    ${lastNodeId} --> ${outputId}`);
  } else {
    // Empty workflow: trigger → output directly
    ctx.edges.push(`    ${triggerId} --> ${outputId}`);
  }

  // Assemble mermaid
  const lines: string[] = ['graph TD'];

  // Nodes
  lines.push(...ctx.nodes);
  lines.push('');

  // Subgraphs (forEach/while wrappers)
  if (ctx.subgraphs.length > 0) {
    lines.push(...ctx.subgraphs);
    lines.push('');
  }

  // Edges
  lines.push(...ctx.edges);
  lines.push('');

  // Class definitions
  lines.push('    classDef trigger fill:#3b82f6,stroke:#2563eb,color:#fff');
  lines.push('    classDef ai fill:#8b5cf6,stroke:#7c3aed,color:#fff');
  lines.push(
    '    classDef ai_conditional fill:#8b5cf6,stroke:#7c3aed,color:#fff,stroke-dasharray:5 5'
  );
  lines.push('    classDef communication fill:#3b82f6,stroke:#2563eb,color:#fff');
  lines.push(
    '    classDef communication_conditional fill:#3b82f6,stroke:#2563eb,color:#fff,stroke-dasharray:5 5'
  );
  lines.push('    classDef data fill:#22c55e,stroke:#16a34a,color:#fff');
  lines.push(
    '    classDef data_conditional fill:#22c55e,stroke:#16a34a,color:#fff,stroke-dasharray:5 5'
  );
  lines.push('    classDef social fill:#f97316,stroke:#ea580c,color:#fff');
  lines.push(
    '    classDef social_conditional fill:#f97316,stroke:#ea580c,color:#fff,stroke-dasharray:5 5'
  );
  lines.push('    classDef utilities fill:#71717a,stroke:#52525b,color:#fff');
  lines.push(
    '    classDef utilities_conditional fill:#71717a,stroke:#52525b,color:#fff,stroke-dasharray:5 5'
  );
  lines.push('    classDef condition fill:#eab308,stroke:#ca8a04,color:#fff');
  lines.push('    classDef output fill:#22c55e,stroke:#16a34a,color:#fff');
  lines.push('    classDef merge fill:none,stroke:none');

  return lines.join('\n');
}

/**
 * Wraps the mermaid flowchart in a markdown code block for direct use in chat.
 */
export function workflowToMermaidMarkdown(workflow: WorkflowInput): string {
  return `\`\`\`mermaid\n${workflowToMermaid(workflow)}\n\`\`\``;
}
