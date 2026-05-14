'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { WorkflowStepCard } from './workflow-step-card';
import { WorkflowDiagramView } from './workflow-diagram-view';
import { CronTriggerConfig } from './trigger-configs/cron-trigger-config';
import { GmailTriggerConfig } from './trigger-configs/gmail-trigger-config';
import { OutlookTriggerConfig } from './trigger-configs/outlook-trigger-config';
import { DiscordTriggerConfig } from './trigger-configs/discord-trigger-config';
import { TelegramTriggerConfig } from './trigger-configs/telegram-trigger-config';
import { getModelIdsByProvider, getDefaultModel, type AIProvider } from '@/lib/ai-models';

interface WorkflowPipelineViewProps {
  workflowConfig: Record<string, unknown>;
  trigger: {
    type: string;
    config: Record<string, unknown>;
  };
  stepSettings: Record<string, Record<string, unknown>>;
  onUpdateStepSetting: (stepKey: string, fieldKey: string, value: unknown) => void;
  triggerSettings: Record<string, unknown>;
  onUpdateTriggerSettings: (settings: Record<string, unknown>) => void;
  openRouterModels: string[];
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

interface StepInfo {
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
  isConfigurable: boolean;
  configurableFields: ConfigurableField[];
}

function getCategoryBorderColor(module: string): string {
  const category = module.split('.')[0];
  switch (category) {
    case 'ai':
      return 'border-violet-500/30';
    case 'communication':
      return 'border-blue-500/30';
    case 'data':
      return 'border-green-500/30';
    case 'social':
      return 'border-orange-500/30';
    case 'utilities':
      return 'border-zinc-600/30';
    case 'productivity':
      return 'border-cyan-500/30';
    case 'devtools':
      return 'border-red-500/30';
    default:
      return 'border-zinc-600/30';
  }
}

function getConfigurableFields(
  modulePath: string | undefined,
  inputs: Record<string, unknown>
): ConfigurableField[] {
  const fields: ConfigurableField[] = [];
  const normalizedModulePath = typeof modulePath === 'string' ? modulePath : '';

  // AI modules
  if (
    normalizedModulePath.startsWith('ai.') ||
    normalizedModulePath.toLowerCase().includes('openai') ||
    normalizedModulePath.toLowerCase().includes('anthropic')
  ) {
    const options = inputs.options as Record<string, unknown> | undefined;
    const aiInputs = options || inputs;

    const hasPrompt = aiInputs.prompt !== undefined;
    const hasSystemPrompt = aiInputs.systemPrompt !== undefined || aiInputs.system !== undefined;
    const hasNonDefaultModel = aiInputs.model !== undefined && aiInputs.model !== 'gpt-4o-mini';
    const hasTemperature = aiInputs.temperature !== undefined;

    if (!hasPrompt && !hasSystemPrompt && !hasNonDefaultModel && !hasTemperature) {
      return fields;
    }

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

    fields.push({
      key: 'systemPrompt',
      label: 'System Prompt',
      type: 'textarea',
      value: aiInputs.systemPrompt || aiInputs.system || '',
      placeholder: 'You are a helpful AI assistant...',
      description: 'Instructions that guide the AI behavior and responses.',
    });

    const currentProvider = (aiInputs.provider as string) || 'openai';
    const availableModels = getModelIdsByProvider(currentProvider as AIProvider);

    fields.push({
      key: 'model',
      label: 'Model',
      type: 'select',
      value: aiInputs.model || getDefaultModel(currentProvider as AIProvider),
      options: availableModels,
      description: 'AI model to use',
    });

    fields.push({
      key: 'temperature',
      label: 'Temperature',
      type: 'number',
      value: aiInputs.temperature ?? 0.7,
      min: 0,
      max: 2,
      step: 0.1,
      placeholder: '0.7',
      description: 'Controls randomness (0 = focused, 2 = creative).',
    });

    fields.push({
      key: 'maxTokens',
      label: 'Max Output Tokens',
      type: 'number',
      value: aiInputs.maxTokens ?? 500,
      min: 1,
      max: 16000,
      step: 1,
      placeholder: '500',
      description: 'Maximum length of AI response.',
    });

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

function extractAllSteps(config: Record<string, unknown>): StepInfo[] {
  if (!config || !config.steps || !Array.isArray(config.steps)) {
    return [];
  }

  const steps = config.steps as Array<Record<string, unknown>>;

  return steps.map((step, index) => {
    const modulePath = typeof step.module === 'string' ? step.module : '';
    const stepInputs =
      step.inputs && typeof step.inputs === 'object'
        ? (step.inputs as Record<string, unknown>)
        : {};
    const fields = getConfigurableFields(modulePath, stepInputs);

    return {
      step: {
        id: (step.id as string) || `step-${index}`,
        module: step.module as string | undefined,
        name: step.name as string | undefined,
        type: step.type as 'action' | 'condition' | 'forEach' | 'while' | undefined,
        inputs: stepInputs,
        outputAs: step.outputAs as string | undefined,
        when: step.when as string | undefined,
        optional: step.optional as boolean | undefined,
        condition: step.condition as string | undefined,
        then: step.then as unknown[] | undefined,
        else: step.else as unknown[] | undefined,
        array: step.array as string | undefined,
      },
      stepIndex: index,
      isConfigurable: fields.length > 0,
      configurableFields: fields,
    };
  });
}

function VerticalConnector() {
  return (
    <div className="flex justify-center">
      <div className="w-px h-4 bg-zinc-700" />
    </div>
  );
}

function TriggerCard({
  trigger,
  triggerSettings,
  onUpdateTriggerSettings,
}: {
  trigger: { type: string; config: Record<string, unknown> };
  triggerSettings: Record<string, unknown>;
  onUpdateTriggerSettings: (settings: Record<string, unknown>) => void;
}) {
  const type = trigger.type;
  const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);

  // Use a ref to hold the latest triggerSettings so callbacks remain stable
  // and don't cause infinite re-render loops when trigger config components
  // call onConfigChange in a useEffect that depends on the callback identity.
  const triggerSettingsRef = useRef(triggerSettings);
  useEffect(() => {
    triggerSettingsRef.current = triggerSettings;
  }, [triggerSettings]);

  const handleCronConfigChange = useCallback(
    (config: Record<string, unknown>) => {
      onUpdateTriggerSettings({ ...triggerSettingsRef.current, ...config });
    },
    [onUpdateTriggerSettings]
  );

  const handleTriggerConfigChange = useCallback(
    (config: Record<string, unknown>) => {
      onUpdateTriggerSettings({ ...triggerSettingsRef.current, ...config });
    },
    [onUpdateTriggerSettings]
  );

  const renderTriggerInfo = () => {
    switch (type) {
      case 'gmail':
        return (
          <div className="text-xs text-zinc-400 space-y-1 mt-2">
            {trigger.config.label != null && <p>Label: {String(trigger.config.label)}</p>}
            {trigger.config.isUnread !== undefined && (
              <p>Unread only: {String(trigger.config.isUnread) === 'true' ? 'Yes' : 'No'}</p>
            )}
            {trigger.config.pollInterval != null && (
              <p>Poll interval: {String(trigger.config.pollInterval)}s</p>
            )}
          </div>
        );
      case 'cron':
        return (
          <p className="text-xs text-zinc-400 mt-2 font-mono">
            {String(trigger.config.schedule || trigger.config.cron || '* * * * *')}
          </p>
        );
      case 'webhook':
        return <p className="text-xs text-zinc-400 mt-2">Webhook endpoint</p>;
      case 'chat':
      case 'chat-input':
        return <p className="text-xs text-zinc-400 mt-2">Chat input</p>;
      default:
        return <p className="text-xs text-zinc-400 mt-2">{capitalizedType} trigger</p>;
    }
  };

  const renderTriggerConfigEditor = () => {
    switch (type) {
      case 'cron':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <CronTriggerConfig
              initialConfig={triggerSettings}
              onConfigChange={handleCronConfigChange}
            />
          </div>
        );
      case 'gmail':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <GmailTriggerConfig
              initialConfig={triggerSettings}
              onConfigChange={handleTriggerConfigChange}
            />
          </div>
        );
      case 'outlook':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <OutlookTriggerConfig
              initialConfig={triggerSettings}
              onConfigChange={handleTriggerConfigChange}
            />
          </div>
        );
      case 'discord':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <DiscordTriggerConfig
              initialConfig={triggerSettings}
              onConfigChange={handleTriggerConfigChange}
            />
          </div>
        );
      case 'telegram':
        return (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <TelegramTriggerConfig
              initialConfig={triggerSettings}
              onConfigChange={handleTriggerConfigChange}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-emerald-500/30 rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="border-0 text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400"
        >
          Trigger
        </Badge>
        <p className="text-sm font-medium text-zinc-100">Trigger: {capitalizedType}</p>
      </div>
      {renderTriggerInfo()}
      {renderTriggerConfigEditor()}
    </div>
  );
}

function StepFieldRenderer({
  stepKey,
  field,
  stepSettings,
  onUpdateStepSetting,
  openRouterModels,
  selectOpenStates,
  setSelectOpenStates,
}: {
  stepKey: string;
  field: ConfigurableField;
  stepSettings: Record<string, Record<string, unknown>>;
  onUpdateStepSetting: (stepKey: string, fieldKey: string, value: unknown) => void;
  openRouterModels: string[];
  selectOpenStates: Record<string, boolean>;
  setSelectOpenStates: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const value = stepSettings[stepKey]?.[field.key];

  switch (field.type) {
    case 'textarea':
      return (
        <div className="space-y-2">
          <Label htmlFor={`${stepKey}-${field.key}`} className="text-sm font-medium">
            {field.label}
          </Label>
          <Textarea
            id={`${stepKey}-${field.key}`}
            value={(value as string) || ''}
            onChange={(e) => onUpdateStepSetting(stepKey, field.key, e.target.value)}
            placeholder={field.placeholder}
            className="text-sm min-h-[100px] bg-background text-foreground"
          />
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );

    case 'number':
      return (
        <div className="space-y-2">
          <Label htmlFor={`${stepKey}-${field.key}`} className="text-sm font-medium">
            {field.label}
          </Label>
          <Input
            id={`${stepKey}-${field.key}`}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value === null || value === undefined ? '' : (value as number)}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '') {
                onUpdateStepSetting(stepKey, field.key, null);
              } else {
                onUpdateStepSetting(
                  stepKey,
                  field.key,
                  field.step && field.step < 1 ? parseFloat(val) : parseInt(val)
                );
              }
            }}
            placeholder={field.placeholder}
            className="text-sm bg-background text-foreground"
          />
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );

    case 'select': {
      const selectKey = `${stepKey}-${field.key}`;
      const isSelectOpen = selectOpenStates[selectKey] || false;

      let selectOptions = field.options || [];
      if (field.key === 'model') {
        const currentProvider = (stepSettings[stepKey]?.['provider'] as string) || 'openai';
        if (currentProvider === 'openrouter') {
          selectOptions = openRouterModels;
        } else {
          selectOptions = getModelIdsByProvider(currentProvider as AIProvider);
        }
      }

      return (
        <div className="space-y-2">
          <Label htmlFor={`${stepKey}-${field.key}`} className="text-sm font-medium">
            {field.label}
          </Label>
          <Popover
            open={isSelectOpen}
            onOpenChange={(open) => setSelectOpenStates((prev) => ({ ...prev, [selectKey]: open }))}
            modal={true}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={isSelectOpen}
                className="w-full justify-between font-normal h-9 text-sm"
              >
                {(value as string) || selectOptions[0] || 'Select...'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-full p-0"
              align="start"
              style={{ width: 'var(--radix-popover-trigger-width)' }}
            >
              <Command loop>
                <CommandInput
                  placeholder={field.key === 'model' ? 'Search models...' : 'Search...'}
                  className="h-9"
                />
                <CommandList className="max-h-[300px]">
                  <CommandEmpty>No {field.key} found.</CommandEmpty>
                  <CommandGroup>
                    {selectOptions.map((option) => (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => {
                          onUpdateStepSetting(stepKey, field.key, option);
                          setSelectOpenStates((prev) => ({
                            ...prev,
                            [selectKey]: false,
                          }));
                        }}
                        className="text-sm"
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${value === option ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {option}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );
    }

    case 'text':
    default:
      return (
        <div className="space-y-2">
          <Label htmlFor={`${stepKey}-${field.key}`} className="text-sm font-medium">
            {field.label}
          </Label>
          <Input
            id={`${stepKey}-${field.key}`}
            value={(value as string) || ''}
            onChange={(e) => onUpdateStepSetting(stepKey, field.key, e.target.value)}
            placeholder={field.placeholder}
            className="text-sm bg-background text-foreground"
          />
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      );
  }
}

export function WorkflowPipelineView({
  workflowConfig,
  trigger,
  stepSettings,
  onUpdateStepSetting,
  triggerSettings,
  onUpdateTriggerSettings,
  openRouterModels,
}: WorkflowPipelineViewProps) {
  const [viewMode, setViewMode] = useState<'diagram' | 'steps'>('diagram');
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [configuringSteps, setConfiguringSteps] = useState<Record<number, boolean>>({});
  const [selectOpenStates, setSelectOpenStates] = useState<Record<string, boolean>>({});

  const allSteps = extractAllSteps(workflowConfig);

  const toggleExpand = (stepIndex: number) => {
    setExpandedSteps((prev) => ({ ...prev, [stepIndex]: !prev[stepIndex] }));
  };

  const toggleConfigure = (stepIndex: number) => {
    setConfiguringSteps((prev) => ({ ...prev, [stepIndex]: !prev[stepIndex] }));
  };

  return (
    <div className="max-h-[70vh] overflow-y-auto pr-1 scrollbar-none">
      {/* View mode toggle */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-zinc-900/50 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setViewMode('diagram')}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            viewMode === 'diagram'
              ? 'bg-zinc-700 text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Diagram
        </button>
        <button
          type="button"
          onClick={() => setViewMode('steps')}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            viewMode === 'steps' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Steps
        </button>
      </div>

      {viewMode === 'diagram' ? (
        <WorkflowDiagramView
          workflowName="Workflow"
          workflowConfig={workflowConfig}
          trigger={trigger}
        />
      ) : (
        <div className="space-y-0">
          {/* Trigger Card */}
          <TriggerCard
            trigger={trigger}
            triggerSettings={triggerSettings}
            onUpdateTriggerSettings={onUpdateTriggerSettings}
          />

          {/* Steps */}
          {allSteps.map((stepInfo) => {
            const stepKey = `step-${stepInfo.stepIndex}`;
            const borderColor = stepInfo.step.module
              ? getCategoryBorderColor(stepInfo.step.module)
              : 'border-zinc-600/30';

            return (
              <div key={stepKey}>
                <VerticalConnector />
                <div className={`border ${borderColor} rounded-lg bg-zinc-900/50`}>
                  <WorkflowStepCard
                    step={stepInfo.step}
                    stepIndex={stepInfo.stepIndex}
                    isExpanded={!!expandedSteps[stepInfo.stepIndex]}
                    onToggleExpand={() => toggleExpand(stepInfo.stepIndex)}
                    hasConfigurableSettings={stepInfo.isConfigurable}
                    isConfiguring={!!configuringSteps[stepInfo.stepIndex]}
                    onToggleConfigure={() => toggleConfigure(stepInfo.stepIndex)}
                  >
                    {stepInfo.isConfigurable && (
                      <div className="space-y-4">
                        {stepInfo.configurableFields.map((field) => (
                          <StepFieldRenderer
                            key={field.key}
                            stepKey={stepKey}
                            field={field}
                            stepSettings={stepSettings}
                            onUpdateStepSetting={onUpdateStepSetting}
                            openRouterModels={openRouterModels}
                            selectOpenStates={selectOpenStates}
                            setSelectOpenStates={setSelectOpenStates}
                          />
                        ))}
                      </div>
                    )}
                  </WorkflowStepCard>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
