import { db } from '@/lib/db';
import { workflowsTable } from '@/lib/schema';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/redis';
import { queueWorkflowExecution, isWorkflowQueueAvailable } from './workflow-queue';
import { executeWorkflow } from './executor';
import * as gmailModule from '@/modules/communication/gmail';
import * as outlookModule from '@/modules/communication/outlook';

/**
 * Email Triggers System
 *
 * Polls Gmail/Outlook for new emails matching workflow trigger filters.
 * When a matching email is found, executes the workflow with email data.
 *
 * Features:
 * - Separate pollers for Gmail and Outlook
 * - Per-workflow configurable poll interval via `pollInterval` (default 60s)
 * - Deduplication persisted to Redis (survives worker restarts)
 * - Falls back to in-memory Set when Redis is unavailable
 * - Queue-based execution for scalability
 * - Error handling and retry logic
 *
 * Trigger Config Example:
 * {
 *   "type": "gmail",
 *   "config": {
 *     "filters": {
 *       "label": "inbox",
 *       "isUnread": true,
 *       "hasNoLabels": true
 *     },
 *     "pollInterval": 60
 *   }
 * }
 */

interface EmailTriggerWorkflow {
  id: string;
  userId: string;
  name: string;
  trigger: {
    type: 'gmail' | 'outlook';
    config: {
      filters?: Record<string, unknown>;
      pollInterval?: number;
    };
  };
  lastChecked?: Date;
}

interface PerWorkflowTimer {
  intervalId: NodeJS.Timeout;
  intervalSeconds: number;
  consecutiveFailures: number;
  currentBackoffMs: number;
}

const REDIS_KEY_PREFIX = 'b0t:email-triggers:processed:';
const REDIS_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_IN_MEMORY_TRACKED = 10000;

class EmailTriggerPoller {
  private gmailWorkflows: Map<string, EmailTriggerWorkflow> = new Map();
  private outlookWorkflows: Map<string, EmailTriggerWorkflow> = new Map();
  private workflowTimers: Map<string, PerWorkflowTimer> = new Map();
  private isInitialized = false;

  private defaultPollInterval = 60; // seconds
  /** Fallback in-memory set when Redis is unavailable */
  private processedEmailIds: Set<string> = new Set();

  /**
   * Check if an email key has already been processed.
   * Uses Redis when available, falls back to in-memory Set.
   */
  private async isProcessed(emailKey: string): Promise<boolean> {
    const redis = getRedisClient();
    if (redis) {
      try {
        const exists = await redis.exists(`${REDIS_KEY_PREFIX}${emailKey}`);
        return exists === 1;
      } catch (error) {
        logger.warn({ error }, 'Redis read failed, falling back to in-memory dedup');
      }
    }
    return this.processedEmailIds.has(emailKey);
  }

  /**
   * Mark an email key as processed.
   * Persists to Redis when available, always adds to in-memory Set.
   */
  private async markProcessed(emailKey: string): Promise<void> {
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.set(`${REDIS_KEY_PREFIX}${emailKey}`, '1', 'EX', REDIS_EXPIRY_SECONDS);
      } catch (error) {
        logger.warn({ error }, 'Redis write failed, using in-memory dedup only');
      }
    }
    this.processedEmailIds.add(emailKey);
    // Trim in-memory set
    if (this.processedEmailIds.size > MAX_IN_MEMORY_TRACKED) {
      const entries = Array.from(this.processedEmailIds);
      this.processedEmailIds = new Set(entries.slice(-5000));
    }
  }

  /**
   * Initialize email trigger polling
   */
  async initialize() {
    try {
      await this.loadWorkflows();

      // Start per-workflow timers for Gmail
      for (const workflow of this.gmailWorkflows.values()) {
        this.startWorkflowTimer(workflow, 'gmail');
      }
      if (this.gmailWorkflows.size > 0) {
        logger.info({ count: this.gmailWorkflows.size }, 'Gmail trigger polling initialized');
      }

      // Start per-workflow timers for Outlook
      for (const workflow of this.outlookWorkflows.values()) {
        this.startWorkflowTimer(workflow, 'outlook');
      }
      if (this.outlookWorkflows.size > 0) {
        logger.info({ count: this.outlookWorkflows.size }, 'Outlook trigger polling initialized');
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize email triggers');
      throw error;
    }
  }

  /**
   * Load all active workflows with email triggers
   */
  private async loadWorkflows() {
    // Load Gmail workflows
    const gmailWorkflows = await db
      .select({
        id: workflowsTable.id,
        name: workflowsTable.name,
        userId: workflowsTable.userId,
        trigger: workflowsTable.trigger,
      })
      .from(workflowsTable)
      .where(
        sql`
          ${workflowsTable.status} = 'active' AND
          ${workflowsTable.trigger}::jsonb->>'type' = 'gmail'
        `
      );

    for (const wf of gmailWorkflows) {
      this.gmailWorkflows.set(wf.id, {
        id: wf.id,
        userId: wf.userId,
        name: wf.name,
        trigger: wf.trigger as unknown as EmailTriggerWorkflow['trigger'],
      });
    }

    // Load Outlook workflows
    const outlookWorkflows = await db
      .select({
        id: workflowsTable.id,
        name: workflowsTable.name,
        userId: workflowsTable.userId,
        trigger: workflowsTable.trigger,
      })
      .from(workflowsTable)
      .where(
        sql`
          ${workflowsTable.status} = 'active' AND
          ${workflowsTable.trigger}::jsonb->>'type' = 'outlook'
        `
      );

    for (const wf of outlookWorkflows) {
      this.outlookWorkflows.set(wf.id, {
        id: wf.id,
        userId: wf.userId,
        name: wf.name,
        trigger: wf.trigger as unknown as EmailTriggerWorkflow['trigger'],
      });
    }
  }

  // Circuit breaker constants
  private static readonly MAX_CONSECUTIVE_FAILURES = 5;
  private static readonly MAX_BACKOFF_MS = 15 * 60 * 1000; // 15 minutes max backoff

  /**
   * Start a per-workflow polling timer with exponential backoff on failures.
   * After MAX_CONSECUTIVE_FAILURES, the poller enters circuit-breaker open state
   * and backs off up to MAX_BACKOFF_MS between attempts.
   */
  private startWorkflowTimer(workflow: EmailTriggerWorkflow, type: 'gmail' | 'outlook') {
    // Stop any existing timer for this workflow
    this.stopWorkflowTimer(workflow.id);

    // Read pollInterval from trigger config, also accept legacy pollingInterval
    const config = workflow.trigger.config || {};
    const pollIntervalSeconds =
      (config.pollInterval as number | undefined) ??
      ((config as Record<string, unknown>).pollingInterval as number | undefined) ??
      this.defaultPollInterval;

    const baseIntervalMs = pollIntervalSeconds * 1000;

    const pollFn =
      type === 'gmail'
        ? () => this.pollWorkflowGmail(workflow)
        : () => this.pollWorkflowOutlook(workflow);

    const timerState: PerWorkflowTimer = {
      intervalId: null as unknown as NodeJS.Timeout,
      intervalSeconds: pollIntervalSeconds,
      consecutiveFailures: 0,
      currentBackoffMs: baseIntervalMs,
    };

    const schedulePoll = () => {
      timerState.intervalId = setTimeout(async () => {
        try {
          await pollFn();
          // Success — reset backoff
          if (timerState.consecutiveFailures > 0) {
            logger.info(
              { workflowId: workflow.id, previousFailures: timerState.consecutiveFailures },
              `${type} poll recovered after ${timerState.consecutiveFailures} consecutive failures`
            );
          }
          timerState.consecutiveFailures = 0;
          timerState.currentBackoffMs = baseIntervalMs;
        } catch (error) {
          timerState.consecutiveFailures++;
          // Exponential backoff: baseInterval * 2^failures, capped at MAX_BACKOFF_MS
          timerState.currentBackoffMs = Math.min(
            baseIntervalMs * Math.pow(2, timerState.consecutiveFailures),
            EmailTriggerPoller.MAX_BACKOFF_MS
          );

          logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
              workflowId: workflow.id,
              consecutiveFailures: timerState.consecutiveFailures,
              nextPollInMs: timerState.currentBackoffMs,
              circuitBreakerOpen:
                timerState.consecutiveFailures >= EmailTriggerPoller.MAX_CONSECUTIVE_FAILURES,
            },
            `${type} poll failed (${timerState.consecutiveFailures} consecutive failures, next poll in ${Math.round(timerState.currentBackoffMs / 1000)}s)`
          );
        }
        // Schedule next poll with current backoff
        schedulePoll();
      }, timerState.currentBackoffMs);
    };

    // Poll immediately on startup
    pollFn()
      .then(() => {
        timerState.consecutiveFailures = 0;
      })
      .catch((error) => {
        timerState.consecutiveFailures++;
        timerState.currentBackoffMs = Math.min(
          baseIntervalMs * Math.pow(2, timerState.consecutiveFailures),
          EmailTriggerPoller.MAX_BACKOFF_MS
        );
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            workflowId: workflow.id,
          },
          `${type} poll error on startup`
        );
      })
      .finally(() => {
        schedulePoll();
      });

    this.workflowTimers.set(workflow.id, timerState);

    logger.info(
      { workflowId: workflow.id, intervalSeconds: pollIntervalSeconds },
      `${type} workflow polling started`
    );
  }

  /**
   * Stop a per-workflow timer
   */
  private stopWorkflowTimer(workflowId: string) {
    const timer = this.workflowTimers.get(workflowId);
    if (timer) {
      clearTimeout(timer.intervalId);
      this.workflowTimers.delete(workflowId);
    }
  }

  /**
   * Poll Gmail for a single workflow
   */
  private async pollWorkflowGmail(workflow: EmailTriggerWorkflow) {
    try {
      const filters = (workflow.trigger.config?.filters || {}) as {
        label?: string;
        isUnread?: boolean;
        hasNoLabels?: boolean;
        from?: string;
        to?: string;
        subject?: string;
        after?: string;
        before?: string;
      };

      const emails = await gmailModule.fetchEmails({
        userId: workflow.userId,
        filters,
        limit: 10,
        includeBody: true,
      });

      const newEmails: typeof emails = [];
      for (const email of emails) {
        const emailKey = `gmail:${workflow.id}:${email.id}`;
        if (await this.isProcessed(emailKey)) continue;
        await this.markProcessed(emailKey);
        newEmails.push(email);
      }

      if (newEmails.length > 0) {
        logger.info(
          { workflowId: workflow.id, emailCount: newEmails.length },
          'New Gmail emails found'
        );
        for (const email of newEmails) {
          await this.executeEmailWorkflow(workflow, email);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { workflowId: workflow.id, error: errorMessage, stack: errorStack },
        'Error polling Gmail for workflow'
      );
    }
  }

  /**
   * Poll Outlook for a single workflow
   */
  private async pollWorkflowOutlook(workflow: EmailTriggerWorkflow) {
    try {
      const filters = (workflow.trigger.config?.filters || {}) as {
        folder?: string;
        isUnread?: boolean;
        hasNoCategories?: boolean;
        from?: string;
        to?: string;
        subject?: string;
        importance?: 'low' | 'normal' | 'high';
      };

      const emails = await outlookModule.fetchEmails({
        userId: workflow.userId,
        filters,
        limit: 10,
        includeBody: true,
      });

      const newEmails: typeof emails = [];
      for (const email of emails) {
        const emailKey = `outlook:${workflow.id}:${email.id}`;
        if (await this.isProcessed(emailKey)) continue;
        await this.markProcessed(emailKey);
        newEmails.push(email);
      }

      if (newEmails.length > 0) {
        logger.info(
          { workflowId: workflow.id, emailCount: newEmails.length },
          'New Outlook emails found'
        );
        for (const email of newEmails) {
          await this.executeEmailWorkflow(workflow, email);
        }
      }
    } catch (error) {
      logger.error({ workflowId: workflow.id, error }, 'Error polling Outlook for workflow');
    }
  }

  /**
   * Execute workflow with email trigger data
   */
  private async executeEmailWorkflow(
    workflow: EmailTriggerWorkflow,
    email: {
      id: string;
      from: string;
      to: string;
      subject: string;
      snippet: string;
      body?: { text?: string; html?: string };
      [key: string]: unknown;
    }
  ) {
    // Flatten email data into trigger root to match documented API:
    // trigger.from, trigger.subject, trigger.messageId, etc.
    const triggerData = {
      ...email,
      messageId: email.id,
      body:
        typeof email.body === 'object'
          ? email.body?.text || email.body?.html || ''
          : email.body || '',
      bodyHtml: typeof email.body === 'object' ? email.body?.html || '' : '',
      attachments: (email as Record<string, unknown>).attachments || [],
      userId: workflow.userId,
    };

    logger.info(
      {
        workflowId: workflow.id,
        workflowName: workflow.name,
        emailId: email.id,
        from: email.from,
        subject: email.subject,
      },
      'Executing workflow for email'
    );

    try {
      if (await isWorkflowQueueAvailable()) {
        await queueWorkflowExecution(
          workflow.id,
          workflow.userId,
          workflow.trigger.type,
          triggerData
        );
        logger.info({ workflowId: workflow.id, emailId: email.id }, 'Workflow queued');
      } else {
        await executeWorkflow(workflow.id, workflow.userId, workflow.trigger.type, triggerData);
        logger.info({ workflowId: workflow.id, emailId: email.id }, 'Workflow executed');
      }
    } catch (error) {
      logger.error(
        { workflowId: workflow.id, emailId: email.id, error },
        'Failed to execute workflow for email'
      );
    }
  }

  /**
   * Reload workflows (called when workflows are added/updated)
   */
  async reload() {
    logger.info('Reloading email trigger workflows');

    // Stop all existing timers
    for (const workflowId of this.workflowTimers.keys()) {
      this.stopWorkflowTimer(workflowId);
    }

    // Clear existing workflow maps
    this.gmailWorkflows.clear();
    this.outlookWorkflows.clear();

    // Reload from database
    await this.loadWorkflows();

    // Restart per-workflow timers
    for (const workflow of this.gmailWorkflows.values()) {
      this.startWorkflowTimer(workflow, 'gmail');
    }
    for (const workflow of this.outlookWorkflows.values()) {
      this.startWorkflowTimer(workflow, 'outlook');
    }

    logger.info(
      {
        gmailWorkflows: this.gmailWorkflows.size,
        outlookWorkflows: this.outlookWorkflows.size,
      },
      'Email triggers reloaded'
    );
  }

  /**
   * Stop all polling
   */
  stop() {
    for (const [workflowId] of this.workflowTimers) {
      this.stopWorkflowTimer(workflowId);
    }
    logger.info('All email polling stopped');
  }

  /**
   * Get current status
   */
  getStatus() {
    const timers: Record<string, number> = {};
    for (const [id, timer] of this.workflowTimers) {
      timers[id] = timer.intervalSeconds;
    }

    return {
      gmail: {
        isPolling: this.gmailWorkflows.size > 0,
        workflowCount: this.gmailWorkflows.size,
      },
      outlook: {
        isPolling: this.outlookWorkflows.size > 0,
        workflowCount: this.outlookWorkflows.size,
      },
      processedEmailsTracked: this.processedEmailIds.size,
      perWorkflowIntervals: timers,
    };
  }
}

// Singleton instance
export const emailTriggerPoller = new EmailTriggerPoller();
