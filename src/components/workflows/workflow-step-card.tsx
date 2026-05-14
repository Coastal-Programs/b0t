'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Settings } from 'lucide-react';

interface WorkflowStepCardProps {
  step: {
    id: string;
    module?: string;
    name?: string;
    type?: 'action' | 'condition' | 'forEach' | 'while';
    inputs?: Record<string, unknown>;
    outputAs?: string;
    when?: string;
    optional?: boolean;
    condition?: string;
    then?: unknown[];
    else?: unknown[];
    array?: string;
  };
  stepIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  hasConfigurableSettings: boolean;
  isConfiguring: boolean;
  onToggleConfigure: () => void;
  children?: React.ReactNode;
}

export function getModuleCategory(module: string): { label: string; color: string } {
  const category = module.split('.')[0];
  switch (category) {
    case 'ai':
      return { label: 'AI', color: 'bg-violet-500/20 text-violet-400' };
    case 'communication':
      return { label: 'Communication', color: 'bg-blue-500/20 text-blue-400' };
    case 'data':
      return { label: 'Data', color: 'bg-green-500/20 text-green-400' };
    case 'social':
      return { label: 'Social', color: 'bg-orange-500/20 text-orange-400' };
    case 'utilities':
      return { label: 'Utilities', color: 'bg-zinc-500/20 text-zinc-400' };
    case 'productivity':
      return { label: 'Productivity', color: 'bg-cyan-500/20 text-cyan-400' };
    case 'devtools':
      return { label: 'DevTools', color: 'bg-red-500/20 text-red-400' };
    default:
      return { label: category, color: 'bg-zinc-500/20 text-zinc-400' };
  }
}

function camelCaseToTitleCase(str: string): string {
  const spaced = str.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function kebabToTitleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const GENERIC_FUNCTION_NAMES = new Set([
  'execute',
  'run',
  'call',
  'invoke',
  'process',
  'handle',
  'start',
  'do',
  'generatejson',
  'generatetext',
  'generateobject',
  'runagent',
  'chat',
]);

export function generateStepName(step: {
  id: string;
  module?: string;
  name?: string;
  type?: string;
}): string {
  // 1. If explicit name exists, use it
  if (step.name) {
    return step.name;
  }

  // 2. Try the module's last segment
  if (step.module) {
    const lastSegment = step.module.split('.').pop() || step.module;

    // If the function name is generic, fall back to the step ID
    if (GENERIC_FUNCTION_NAMES.has(lastSegment.toLowerCase())) {
      return kebabToTitleCase(step.id);
    }

    // Otherwise use the module function name
    return camelCaseToTitleCase(lastSegment);
  }

  // 3. Control flow types
  if (step.type === 'condition') return 'Condition';
  if (step.type === 'forEach') return 'For Each Loop';
  if (step.type === 'while') return 'While Loop';

  // 4. Final fallback: use the step ID
  return kebabToTitleCase(step.id);
}

export function humanizeCondition(when: string): string {
  // Split on && to get individual conditions
  const parts = when.split('&&').map((p) => p.trim());

  const humanized = parts
    .map((part) => {
      // Extract variable name and value from patterns like {{var.field}} === 'value'
      const match = part.match(/\{\{([^}]+)\}\}\s*(===|!==|>|<|>=|<=)\s*(.+)/);
      if (!match) return null;

      const [, varPath, operator, rawValue] = match;
      const value = rawValue.replace(/^['"]|['"]$/g, '').trim();
      const fieldName = varPath.split('.').pop() || varPath;

      // Convert camelCase/snake_case field name to readable words
      const readable = fieldName
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase();

      if (value === 'true') {
        return operator === '===' ? readable : `not ${readable}`;
      }
      if (value === 'false') {
        return operator === '===' ? `not ${readable}` : readable;
      }
      if (value === 'null') {
        return operator === '!==' ? `has ${readable}` : `no ${readable}`;
      }
      if (operator === '===') {
        return `${readable} is ${value}`;
      }
      if (operator === '!==') {
        return `${readable} is not ${value}`;
      }

      return `${readable} ${operator} ${value}`;
    })
    .filter(Boolean);

  if (humanized.length === 0) return 'Conditional';

  if (humanized.length > 2) {
    const text = `${humanized[0]} and ${humanized[1]}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  const text = humanized.join(' and ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function generateStepDescription(step: {
  id: string;
  module?: string;
  inputs?: Record<string, unknown>;
  outputAs?: string;
  when?: string;
  type?: string;
  condition?: string;
  array?: string;
}): string {
  const inputs = step.inputs || {};
  const modulePath = step.module || '';
  const parts = modulePath.split('.');
  const category = parts[0] || '';
  const service = parts[1] || '';
  const func = parts[parts.length - 1] || '';

  // AI steps — show the prompt, that IS the description
  if (category === 'ai') {
    const prompt = String(inputs.prompt || inputs.systemPrompt || inputs.system || '');
    if (prompt) {
      const cleaned = prompt
        .replace(/\{\{([^}]+)\}\}/g, (_, varPath: string) => {
          const field = varPath.split('.').pop() || varPath;
          return field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        })
        .trim();
      const truncated = cleaned.length > 300 ? cleaned.slice(0, 300).trim() + '…' : cleaned;

      const modelInfo = [inputs.provider, inputs.model].filter(Boolean).join(' · ');
      return modelInfo ? `${truncated}\n\nModel: ${modelInfo}` : truncated;
    }
    return 'AI processing step';
  }

  // JavaScript execute steps
  if (modulePath === 'utilities.javascript.execute') {
    const contextVars = inputs.context as Record<string, unknown> | undefined;
    const outputName = step.outputAs || '';

    if (contextVars) {
      const inputVars = Object.keys(contextVars)
        .map((k) =>
          k
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/_/g, ' ')
            .toLowerCase()
        )
        .join(', ');
      if (outputName) {
        const readableOutput = outputName
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/_/g, ' ')
          .toLowerCase();
        return `Processes ${inputVars} and produces ${readableOutput}`;
      }
      return `Processes ${inputVars}`;
    }

    const readableId = step.id.split('-').join(' ').replace(/_/g, ' ');
    if (outputName) {
      const readableOutput = outputName
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .toLowerCase();
      return `Runs custom logic for ${readableId}, outputs ${readableOutput}`;
    }
    return `Runs custom logic for ${readableId}`;
  }

  // HTTP steps
  if (func === 'httpPost' || func === 'httpGet' || func === 'httpRequest') {
    const url = String(inputs.url || '');
    if (url) {
      try {
        const hostname = new URL(url).hostname.replace('api.', '').replace('www.', '');
        return `Makes an API call to ${hostname}`;
      } catch {
        return 'Makes an API call';
      }
    }
    return 'Makes an HTTP request';
  }

  // Gmail/Communication steps
  if (service === 'gmail') {
    const descriptions: Record<string, string> = {
      fetchEmails: 'Fetches emails from Gmail',
      addLabels: 'Adds labels to the email in Gmail',
      removeLabels: 'Removes labels from the email in Gmail',
      markAsRead: 'Marks the email as read in Gmail',
      markAsUnread: 'Marks the email as unread in Gmail',
      sendEmail: 'Sends an email via Gmail',
      createDraft: 'Creates a draft email in Gmail',
    };
    return (
      descriptions[func] ||
      `Performs ${func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} via Gmail`
    );
  }

  // Google Drive steps
  if (service === 'google-drive') {
    if (func.toLowerCase().includes('upload')) {
      return 'Uploads a file to Google Drive';
    }
    if (func.toLowerCase().includes('download')) {
      return 'Downloads a file from Google Drive';
    }
    return `Performs ${func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} in Google Drive`;
  }

  // Slack steps
  if (service === 'slack') {
    return `Performs ${func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} in Slack`;
  }

  // Airtable steps
  if (service === 'airtable') {
    return `Performs ${func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} in Airtable`;
  }

  // Email/SMTP steps
  if (func === 'sendEmail' || func === 'send') {
    return 'Sends an email';
  }

  // Google Sheets
  if (service === 'google-sheets') {
    return `Performs ${func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} in Google Sheets`;
  }

  // Control flow
  if (step.type === 'condition') {
    return 'Checks a condition and branches the workflow';
  }
  if (step.type === 'forEach') {
    return 'Loops through each item and runs sub-steps';
  }
  if (step.type === 'while') {
    return 'Repeats steps while a condition is true';
  }

  // Generic fallback
  const readableFunc = func.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const readableService = service.replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (readableService && readableFunc) {
    return `${readableFunc.charAt(0).toUpperCase() + readableFunc.slice(1)} via ${readableService}`;
  }
  return `Runs ${step.id.split('-').join(' ')}`;
}

export function WorkflowStepCard({
  step,
  stepIndex,
  isExpanded,
  onToggleExpand,
  hasConfigurableSettings,
  isConfiguring,
  onToggleConfigure,
  children,
}: WorkflowStepCardProps) {
  const stepName = generateStepName(step);

  return (
    <div>
      {/* Collapsed row — always visible */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 py-3 px-4 hover:bg-zinc-800/30 transition-colors rounded-lg text-left"
      >
        <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-zinc-800 text-[10px] font-medium text-zinc-500">
          {stepIndex + 1}
        </span>
        <p className="text-sm text-zinc-300 truncate flex-1">{stepName}</p>
        {step.when && (
          <Badge
            variant="outline"
            className="border-0 text-[10px] px-1.5 py-0 bg-amber-500/20 text-amber-400 flex-shrink-0"
          >
            {humanizeCondition(step.when)}
          </Badge>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded section */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 ml-8 border-l border-zinc-800">
          <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line">
            {generateStepDescription(step)}
          </p>

          {/* Configure button — only for steps with configurable settings */}
          {hasConfigurableSettings && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleConfigure();
              }}
              className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Settings className="h-3 w-3" />
              {isConfiguring ? 'Hide Settings' : 'Edit Settings'}
            </button>
          )}

          {/* Configurable settings panel */}
          {isConfiguring && children && (
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-4">{children}</div>
          )}
        </div>
      )}
    </div>
  );
}
