'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Check } from 'lucide-react';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface AirtableTriggerConfigProps {
  initialConfig?: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

export function AirtableTriggerConfig({
  initialConfig,
  onConfigChange,
}: AirtableTriggerConfigProps) {
  const [baseId, setBaseId] = useState((initialConfig?.baseId as string) || '');
  const [tableId, setTableId] = useState((initialConfig?.tableId as string) || '');
  const [pollInterval, setPollInterval] = useState((initialConfig?.pollInterval as number) || 60);
  const [intervalOpen, setIntervalOpen] = useState(false);

  useEffect(() => {
    onConfigChange({
      baseId: baseId || undefined,
      tableId: tableId || undefined,
      pollInterval,
    });
  }, [baseId, tableId, pollInterval, onConfigChange]);

  const pollIntervals = [
    { value: 30, label: 'Every 30 seconds' },
    { value: 60, label: 'Every minute (recommended)' },
    { value: 300, label: 'Every 5 minutes' },
    { value: 600, label: 'Every 10 minutes' },
    { value: 900, label: 'Every 15 minutes' },
    { value: 1800, label: 'Every 30 minutes' },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-3">
        <h4 className="text-sm font-medium">Airtable Settings</h4>
        <p className="text-xs text-muted-foreground">
          Configure the Airtable base and table to watch for new or updated records.
        </p>

        <div className="space-y-2">
          <Label htmlFor="airtable-base-id" className="text-sm">
            Base ID
          </Label>
          <Input
            id="airtable-base-id"
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            placeholder="appXXXXXXXXXXXXXX"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Find this in your Airtable base URL or API docs (starts with &quot;app&quot;).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="airtable-table-id" className="text-sm">
            Table ID
          </Label>
          <Input
            id="airtable-table-id"
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            placeholder="tblXXXXXXXXXXXXXX"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Find this in your Airtable table URL or API docs (starts with &quot;tbl&quot;).
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-3">
        <h4 className="text-sm font-medium">Polling Settings</h4>

        <div className="space-y-2">
          <Label htmlFor="airtable-interval" className="text-sm">
            Check for new records
          </Label>
          <Popover open={intervalOpen} onOpenChange={setIntervalOpen} modal={true}>
            <PopoverTrigger asChild>
              <Button
                id="airtable-interval"
                variant="outline"
                role="combobox"
                aria-expanded={intervalOpen}
                className="w-full justify-between font-normal text-sm"
              >
                {pollIntervals.find((i) => i.value === pollInterval)?.label || 'Select interval'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-full p-0"
              align="start"
              style={{ width: 'var(--radix-popover-trigger-width)' }}
            >
              <Command>
                <CommandList className="max-h-[300px]">
                  <CommandGroup>
                    {pollIntervals.map((interval) => (
                      <CommandItem
                        key={interval.value}
                        value={interval.value.toString()}
                        onSelect={() => {
                          setPollInterval(interval.value);
                          setIntervalOpen(false);
                        }}
                        className="text-sm"
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${pollInterval === interval.value ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {interval.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">
            How often to check Airtable for new or updated records
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950 p-3">
        <p className="text-xs text-blue-900 dark:text-blue-100">
          <strong>Note:</strong> Requires an Airtable API key or personal access token. Go to
          Settings → Credentials to connect your Airtable account.
        </p>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/50 p-3 space-y-2">
        <h4 className="text-sm font-medium">Available Trigger Data</h4>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <code className="bg-muted px-1 rounded">{'{{trigger.recordId}}'}</code> - Record ID
          </div>
          <div>
            <code className="bg-muted px-1 rounded">{'{{trigger.fields}}'}</code> - Record fields
            object
          </div>
          <div>
            <code className="bg-muted px-1 rounded">{'{{trigger.createdTime}}'}</code> - Record
            creation time
          </div>
          <div>
            <code className="bg-muted px-1 rounded">{'{{trigger.baseId}}'}</code> - Airtable base ID
          </div>
          <div>
            <code className="bg-muted px-1 rounded">{'{{trigger.tableId}}'}</code> - Airtable table
            ID
          </div>
        </div>
      </div>
    </div>
  );
}
