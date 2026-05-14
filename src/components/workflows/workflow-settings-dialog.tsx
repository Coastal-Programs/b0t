'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchOpenRouterModels,
  getModelIdsByProvider,
  getDefaultModel,
  type AIProvider,
} from '@/lib/ai-models';
import { logger } from '@/lib/logger';
import { WorkflowPipelineView } from './workflow-pipeline-view';

interface WorkflowSettingsDialogProps {
  workflowId: string;
  workflowName: string;
  workflowConfig: Record<string, unknown>;
  workflowTrigger: {
    type:
      | 'manual'
      | 'cron'
      | 'webhook'
      | 'telegram'
      | 'discord'
      | 'chat'
      | 'chat-input'
      | 'gmail'
      | 'outlook';
    config: Record<string, unknown>;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

interface ConfigurableField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  value: unknown;
  placeholder?: string;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export function WorkflowSettingsDialog({
  workflowId,
  workflowName,
  workflowConfig,
  workflowTrigger,
  open,
  onOpenChange,
  onUpdated,
}: WorkflowSettingsDialogProps) {
  const [stepSettings, setStepSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [triggerSettings, setTriggerSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [openRouterModels, setOpenRouterModels] = useState<string[]>([]);

  // Fetch OpenRouter models when dialog opens
  useEffect(() => {
    if (open) {
      fetchOpenRouterModels().then((models) => {
        setOpenRouterModels(models.map((m) => m.id));
      });
    }
  }, [open]);

  // Extract configurable steps and initialize settings
  useEffect(() => {
    if (open && !initialized) {
      const steps = extractConfigurableSteps(workflowConfig);

      // Initialize settings for each configurable step
      const initialSettings: Record<string, Record<string, unknown>> = {};
      steps.forEach((step) => {
        const stepKey = `step-${step.stepIndex}`;
        initialSettings[stepKey] = {};
        step.configurableFields.forEach((field) => {
          initialSettings[stepKey][field.key] = field.value;
        });
      });

      setStepSettings(initialSettings);

      // Initialize trigger settings
      setTriggerSettings(workflowTrigger.config || {});
      setInitialized(true);
    } else if (!open) {
      // Reset initialization when dialog closes
      setInitialized(false);
    }
  }, [open, initialized, workflowConfig, workflowTrigger]);

  const handleSave = async () => {
    try {
      setSaving(true);

      // Update the workflow config with new settings
      const updatedConfig = applyStepSettings(workflowConfig, stepSettings);

      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: updatedConfig,
          trigger: {
            type: workflowTrigger.type,
            config: triggerSettings,
          },
        }),
      });

      if (!response.ok) {
        toast.error('Failed to save workflow settings');
      } else {
        toast.success('Workflow settings saved');
        onUpdated?.();
        onOpenChange(false);
      }
    } catch (error) {
      logger.error({ error }, 'Error saving workflow settings');
      toast.error('Error saving workflow settings');
    } finally {
      setSaving(false);
    }
  };

  const updateStepSetting = (stepKey: string, fieldKey: string, value: unknown) => {
    setStepSettings((prev) => {
      const newSettings = {
        ...prev,
        [stepKey]: {
          ...prev[stepKey],
          [fieldKey]: value,
        },
      };

      // If provider changed, reset model to default for new provider
      if (fieldKey === 'provider') {
        const defaultModel = getDefaultModel(value as AIProvider);
        newSettings[stepKey]['model'] = defaultModel;
      }

      return newSettings;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">Workflow Settings: {workflowName}</DialogTitle>
          <DialogDescription className="text-xs">
            Configure workflow step parameters
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto py-3 px-1 -mx-1 flex-1 scrollbar-none">
          <WorkflowPipelineView
            workflowConfig={workflowConfig}
            trigger={workflowTrigger}
            stepSettings={stepSettings}
            onUpdateStepSetting={updateStepSetting}
            triggerSettings={triggerSettings}
            onUpdateTriggerSettings={setTriggerSettings}
            openRouterModels={openRouterModels}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Get available models for a given AI provider
 * Uses centralized AI models configuration
 */
function getModelsForProvider(provider: string): string[] {
  return getModelIdsByProvider(provider as AIProvider);
}

/**
 * Extract configurable steps from workflow config
 */
function extractConfigurableSteps(
  config: Record<string, unknown>
): { stepIndex: number; configurableFields: ConfigurableField[] }[] {
  const configurableSteps: { stepIndex: number; configurableFields: ConfigurableField[] }[] = [];

  // Add null/undefined checks
  if (!config || !config.steps || !Array.isArray(config.steps)) {
    return configurableSteps;
  }

  const steps = config.steps as Array<{
    id?: string;
    module?: string;
    inputs?: Record<string, unknown>;
  }>;

  steps.forEach((step, index) => {
    const modulePath = typeof step.module === 'string' ? step.module : '';
    const stepInputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const fields = getConfigurableFields(modulePath, stepInputs);

    if (fields.length > 0) {
      configurableSteps.push({
        stepIndex: index,
        configurableFields: fields,
      });
    }
  });

  return configurableSteps;
}

/**
 * Get configurable fields for a specific module
 */
function getConfigurableFields(
  modulePath: string | undefined,
  inputs: Record<string, unknown>
): ConfigurableField[] {
  const fields: ConfigurableField[] = [];
  const normalizedModulePath = typeof modulePath === 'string' ? modulePath : '';

  // AI modules (ai.ai-sdk, ai.openai, ai.anthropic, ai.openai-workflow)
  if (
    normalizedModulePath.startsWith('ai.') ||
    normalizedModulePath.toLowerCase().includes('openai') ||
    normalizedModulePath.toLowerCase().includes('anthropic')
  ) {
    // Check if inputs are nested under 'options' (common pattern for AI modules)
    const options = inputs.options as Record<string, unknown> | undefined;
    const aiInputs = options || inputs;

    // Check if this AI module has meaningful configurable content
    // We'll show config if: prompt exists (static or dynamic), or system prompt is defined, or model is non-default
    const hasPrompt = aiInputs.prompt !== undefined;
    const hasSystemPrompt = aiInputs.systemPrompt !== undefined || aiInputs.system !== undefined;
    const hasNonDefaultModel = aiInputs.model !== undefined && aiInputs.model !== 'gpt-4o-mini';
    const hasTemperature = aiInputs.temperature !== undefined;

    // If this AI step has no configurable context (no prompt, no system, default model only), skip it
    if (!hasPrompt && !hasSystemPrompt && !hasNonDefaultModel && !hasTemperature) {
      return fields;
    }

    // Provider selection (for ai-sdk module only, not legacy modules)
    if (normalizedModulePath.includes('ai-sdk')) {
      fields.push({
        key: 'provider',
        label: 'AI Provider',
        type: 'select',
        value: aiInputs.provider || 'openai',
        options: ['openai', 'anthropic', 'openrouter'],
        description: 'OpenAI (GPT), Anthropic (Claude), or OpenRouter (hundreds of models)',
      });
    }

    // System prompt - always show for AI modules so users can add instructions
    fields.push({
      key: 'systemPrompt',
      label: 'System Prompt',
      type: 'textarea',
      value: aiInputs.systemPrompt || aiInputs.system || '',
      placeholder: 'You are a helpful AI assistant...',
      description:
        'Instructions that guide the AI behavior and responses. This will override any system prompt in the workflow.',
    });

    // Model selection - always show for AI modules as dropdown
    // Get current provider to determine available models
    const currentProvider = (aiInputs.provider as string) || 'openai';
    const availableModels = getModelsForProvider(currentProvider);

    fields.push({
      key: 'model',
      label: 'Model',
      type: 'select',
      value: aiInputs.model || getDefaultModel(currentProvider as AIProvider),
      options: availableModels,
      description: 'AI model to use',
    });

    // Temperature (always show for AI modules)
    fields.push({
      key: 'temperature',
      label: 'Temperature',
      type: 'number',
      value: aiInputs.temperature ?? 0.7,
      min: 0,
      max: 2,
      step: 0.1,
      placeholder: '0.7 (leave empty to use model default)',
      description:
        "Controls randomness (0 = focused, 2 = creative). Leave empty for models that don't support it.",
    });

    // Max tokens (always show for AI modules)
    fields.push({
      key: 'maxTokens',
      label: 'Max Output Tokens',
      type: 'number',
      value: aiInputs.maxTokens ?? 500,
      min: 1,
      max: 16000,
      step: 1,
      placeholder: '500 (leave empty to use model default)',
      description: "Maximum length of AI response. Leave empty for models that don't support it.",
    });

    // Prompt field (for modules that use 'prompt' instead of separate system/user)
    if (
      aiInputs.prompt !== undefined &&
      typeof aiInputs.prompt === 'string' &&
      !aiInputs.prompt.includes('{{')
    ) {
      fields.push({
        key: 'prompt',
        label: 'Prompt',
        type: 'textarea',
        value: aiInputs.prompt || '',
        placeholder: 'Enter your prompt...',
        description: 'The prompt to send to the AI',
      });
    }
  }

  // Social media modules
  if (normalizedModulePath.startsWith('social.twitter')) {
    if (inputs.maxResults !== undefined) {
      fields.push({
        key: 'maxResults',
        label: 'Max Results',
        type: 'number',
        value: inputs.maxResults ?? 10,
        min: 1,
        max: 100,
        step: 1,
        placeholder: '10',
        description: 'Maximum number of results to fetch',
      });
    }
  }

  // String manipulation modules
  if (normalizedModulePath.includes('string.truncate')) {
    if (inputs.maxLength !== undefined) {
      fields.push({
        key: 'maxLength',
        label: 'Max Length',
        type: 'number',
        value: inputs.maxLength ?? 100,
        min: 1,
        step: 1,
        placeholder: '100',
        description: 'Maximum string length',
      });
    }
  }

  // Communication modules
  if (normalizedModulePath.startsWith('communication.')) {
    if (
      inputs.text !== undefined &&
      typeof inputs.text === 'string' &&
      !inputs.text.includes('{{')
    ) {
      fields.push({
        key: 'text',
        label: 'Message Text',
        type: 'textarea',
        value: inputs.text || '',
        placeholder: 'Enter message text...',
        description: 'The message to send',
      });
    }
  }

  return fields;
}

/**
 * Apply step settings back to workflow config
 */
function applyStepSettings(
  config: Record<string, unknown>,
  stepSettings: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  // Add null/undefined checks
  if (!config || !config.steps || !Array.isArray(config.steps)) {
    return config;
  }

  const updatedConfig = JSON.parse(JSON.stringify(config)); // Deep clone

  const steps = updatedConfig.steps as Array<{
    id?: string;
    module?: string;
    inputs?: Record<string, unknown>;
  }>;

  steps.forEach((step, index) => {
    const stepKey = `step-${index}`;
    const settings = stepSettings[stepKey];

    if (settings) {
      if (!step.inputs || typeof step.inputs !== 'object') {
        step.inputs = {};
      }

      const stepInputs = step.inputs as Record<string, unknown>;
      const modulePath = typeof step.module === 'string' ? step.module : '';

      // For AI modules, check if inputs are nested under 'options'
      const isAIModule =
        modulePath.startsWith('ai.') ||
        modulePath.toLowerCase().includes('openai') ||
        modulePath.toLowerCase().includes('anthropic');
      const hasOptionsNesting =
        isAIModule && stepInputs.options && typeof stepInputs.options === 'object';

      // Apply all settings for this step
      Object.entries(settings).forEach(([key, value]) => {
        // Allow empty strings for systemPrompt and prompt to enable clearing them
        const allowEmpty = key === 'systemPrompt' || key === 'prompt';

        // For numeric fields, allow empty to remove the parameter
        const isNumericField = key === 'temperature' || key === 'maxTokens';
        const shouldRemove =
          isNumericField && (value === '' || value === null || value === undefined);
        const shouldApply = value !== undefined && value !== null && (allowEmpty || value !== '');

        if (shouldRemove) {
          // Remove the parameter for models that don't support it
          if (hasOptionsNesting) {
            delete (stepInputs.options as Record<string, unknown>)[key];
          } else {
            delete stepInputs[key];
          }
        } else if (shouldApply) {
          // Special handling for systemPrompt - map to 'system' if that's what's being used
          const actualKey =
            key === 'systemPrompt' && hasOptionsNesting
              ? (stepInputs.options as Record<string, unknown>).system !== undefined
                ? 'system'
                : 'systemPrompt'
              : key;

          if (hasOptionsNesting) {
            // Set nested in options for AI modules with that structure
            (stepInputs.options as Record<string, unknown>)[actualKey] = value;
          } else {
            // Set at top level for other modules
            stepInputs[actualKey] = value;
          }
        }
      });
    }
  });

  return updatedConfig;
}
