#!/usr/bin/env tsx
/**
 * Test Gmail Auto-Labeling through the REAL executor.
 * Gmail API calls will hit real Google APIs — tests label creation and email modification.
 */

import { executeWorkflow } from '../src/lib/workflows/executor';
import { db } from '../src/lib/db';
import { workflowsTable } from '../src/lib/schema';
import { eq } from 'drizzle-orm';

async function main() {
  // Find the workflow
  const [wf] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.name, 'Gmail Auto-Labeling'))
    .limit(1);

  if (!wf) {
    console.error('Gmail Auto-Labeling workflow not found');
    process.exit(1);
  }

  const mode = process.argv[2] || 'invoice';

  const triggers: Record<string, Record<string, unknown>> = {
    invoice: {
      id: 'test-msg-001',
      messageId: 'test-msg-001',
      threadId: 'test-thread-001',
      from: 'billing@stripe.com',
      to: 'user@example.com',
      subject: 'Invoice from Stripe - $49.00',
      body: 'Your invoice for January 2026 is available. Amount: $49.00',
      bodyHtml: '',
      labels: ['INBOX', 'UNREAD'],
      date: new Date().toISOString(),
      isUnread: true,
      attachments: [{ filename: 'invoice.pdf', mimeType: 'application/pdf' }],
      userId: wf.userId,
    },
    alert: {
      id: 'test-msg-002',
      messageId: 'test-msg-002',
      threadId: 'test-thread-002',
      from: 'notifications@n8n.io',
      to: 'user@example.com',
      subject: 'N8N Workflow Failed - Blog Content Generator',
      body: 'Your workflow "Blog Content Generator" has failed. Error: Connection timeout.',
      bodyHtml: '',
      labels: ['INBOX', 'UNREAD'],
      date: new Date().toISOString(),
      isUnread: true,
      attachments: [],
      userId: wf.userId,
    },
    // Real sample data from the N8N workflow
    stripe: {
      from: 'billing@stripe.com',
      to: 'user@example.com',
      subject: 'Your Stripe invoice is ready',
      body: 'Your latest invoice for $49.00 is ready. Please find the PDF attached.',
      bodyHtml: '<p>Your latest invoice for $49.00 is ready. Please find the PDF attached.</p>',
      date: '2026-03-11T10:00:00.000Z',
      messageId: 'test-msg-12345678',
      threadId: 'test-thread-87654321',
      labels: ['INBOX', 'UNREAD'],
      attachments: [
        { fileName: 'invoice-march-2026.pdf', mimeType: 'application/pdf', size: 45000 },
      ],
      userId: wf.userId,
    },
  };

  const trigger = triggers[mode];
  console.log(`=== Testing: ${mode} ===`);
  console.log(`Workflow: ${wf.id}`);
  console.log(`Email: "${trigger.subject}" from ${trigger.from}\n`);

  const result = await executeWorkflow(wf.id, wf.userId, 'gmail', trigger);
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
