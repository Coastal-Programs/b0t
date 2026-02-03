import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { executeWorkflow } from './executor';
import { selectRecords } from '@/modules/data/airtable';

/**
 * Airtable Trigger Poller
 *
 * Polls Airtable bases for new records and triggers workflows.
 * Similar to email-triggers.ts but for Airtable.
 */

interface AirtableWorkflow {
  id: string;
  name: string;
  userId: string;
  organizationId: string | null;
  trigger: {
    type: 'airtable';
    config: {
      baseId: string;
      tableName: string;
      triggerField: string; // Field to watch for changes (e.g., "Created")
      pollInterval?: number; // Minutes between polls (default: 1)
    };
  };
}

class AirtableTriggerPoller {
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastPollTimes: Map<string, Date> = new Map();
  private isRunning = false;
  private readonly DEFAULT_POLL_INTERVAL = 60000; // 1 minute in milliseconds

  /**
   * Initialize Airtable polling
   */
  async initialize() {
    if (this.isRunning) {
      logger.warn('Airtable trigger poller already running');
      return;
    }

    logger.info('Starting Airtable trigger poller');
    this.isRunning = true;

    // Start polling immediately
    await this.pollAirtableWorkflows();

    // Then poll every minute
    this.pollingInterval = setInterval(
      () => this.pollAirtableWorkflows(),
      this.DEFAULT_POLL_INTERVAL
    );
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isRunning = false;
    logger.info('Airtable trigger poller stopped');
  }

  /**
   * Poll all active Airtable-triggered workflows
   */
  private async pollAirtableWorkflows() {
    try {
      // Get all active workflows with Airtable triggers
      const workflows = await db
        .select()
        .from(workflowsTable)
        .where(
          sql`
            ${workflowsTable.status} = 'active' AND
            ${workflowsTable.trigger}::jsonb->>'type' = 'airtable'
          `
        );

      if (workflows.length === 0) {
        return;
      }

      logger.info({ count: workflows.length }, 'Polling Airtable triggers');

      // Poll each workflow
      logger.info({ workflows: workflows.map(w => ({ id: w.id, trigger: w.trigger })) }, 'Debug: Airtable workflows');

      await Promise.all(
        workflows.map((wf) => {
          // Parse trigger if it's a string (should already be parsed by Drizzle)
          const trigger = typeof wf.trigger === 'string' ? JSON.parse(wf.trigger) : wf.trigger;
          return this.pollWorkflow({
            ...wf,
            trigger,
            lastRun: wf.lastRun
          } as unknown as AirtableWorkflow & { lastRun: Date | null });
        })
      );
    } catch (error) {
      logger.error({ error }, 'Error polling Airtable workflows');
    }
  }

  /**
   * Poll a single workflow's Airtable base
   */
  private async pollWorkflow(workflow: AirtableWorkflow & { lastRun: Date | null }) {
    try {
      const { baseId, tableName, triggerField } = workflow.trigger.config;

      // Get last poll time from database (lastRun) or in-memory Map
      // Use lastRun from DB as fallback to persist across server restarts
      const lastPoll = this.lastPollTimes.get(workflow.id)
        || workflow.lastRun
        || new Date(Date.now() - 60000);

      // Load user credentials to get Airtable API key
      const { loadUserCredentials } = await import('./executor');
      const credentials = await loadUserCredentials(workflow.userId, workflow.organizationId || undefined);

      const airtableApiKey = credentials.airtable as string;
      if (!airtableApiKey) {
        logger.warn({
          workflowId: workflow.id,
          workflowName: workflow.name,
          userId: workflow.userId
        }, 'No Airtable credentials found for user');
        return;
      }

      // Fetch records from Airtable created since last poll
      const records = await selectRecords({
        baseId,
        tableName,
        sort: [{ field: triggerField, direction: 'desc' }],
        maxRecords: 100, // Limit to recent 100 records
        apiKey: airtableApiKey
      });

      // Filter records created since last poll
      const newRecords = records.filter((record: { createdTime: string }) => {
        const createdTime = new Date(record.createdTime);
        return createdTime > lastPoll;
      });

      if (newRecords.length > 0) {
        logger.info(
          {
            workflowId: workflow.id,
            workflowName: workflow.name,
            newRecords: newRecords.length
          },
          'Found new Airtable records'
        );

        // Trigger workflow for each new record
        for (const record of newRecords) {
          await this.triggerWorkflow(workflow, record);
        }
      }

      // Update last poll time
      this.lastPollTimes.set(workflow.id, new Date());
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          workflowId: workflow.id,
          workflowName: workflow.name
        },
        'Error polling Airtable workflow'
      );
    }
  }

  /**
   * Trigger workflow execution for a new Airtable record
   */
  private async triggerWorkflow(
    workflow: AirtableWorkflow,
    record: { id: string; fields: Record<string, unknown>; createdTime: string }
  ) {
    try {
      const triggerData = {
        userId: workflow.userId,
        action: 'created',
        base: {
          id: workflow.trigger.config.baseId
        },
        table: {
          id: record.id.split('/')[0], // Extract table ID from record ID if needed
          name: workflow.trigger.config.tableName
        },
        body: {
          id: record.id,
          fields: record.fields,
          createdTime: record.createdTime
        }
      };

      logger.info(
        {
          workflowId: workflow.id,
          workflowName: workflow.name,
          recordId: record.id
        },
        'Triggering workflow for new Airtable record'
      );

      await executeWorkflow(
        workflow.id,
        workflow.userId,
        'airtable',
        triggerData
      );
    } catch (error) {
      logger.error(
        { error, workflowId: workflow.id, recordId: record.id },
        'Error triggering workflow for Airtable record'
      );
    }
  }
}

// Export singleton instance
export const airtableTriggerPoller = new AirtableTriggerPoller();
