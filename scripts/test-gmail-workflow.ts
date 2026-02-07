#!/usr/bin/env tsx
/**
 * Test Gmail Auto-Labeling Workflow
 * Simulates a Gmail trigger with sample email data
 */

import { executeWorkflow } from '../src/lib/workflows/executor';
import { db } from '../src/lib/db';
import { workflowsTable } from '../src/lib/schema';
import { eq } from 'drizzle-orm';

async function testWorkflow() {
  const workflowId = '5e22c2d0-c2d1-4cf2-8047-eef2586725d3';

  console.log('🧪 Testing Gmail Auto-Labeling Workflow\n');

  // Fetch workflow from database
  const workflows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);

  if (workflows.length === 0) {
    console.error('❌ Workflow not found');
    process.exit(1);
  }

  // Sample email data simulating Gmail trigger
  const sampleEmail = {
    subject: 'N8N Workflow Failed - Blog Content Generator',
    from: 'notifications@n8n.io',
    messageId: 'test-msg-alert-001',
    threadId: 'thread-001',
    body: 'Your workflow "Blog Content Generator" has failed. Error: Connection timeout to Airtable API. Please check your Airtable credentials and network connectivity.',
    bodyHtml: '<p>Your workflow "Blog Content Generator" has failed.</p>',
    date: new Date().toISOString(),
    to: 'jake@coastalprograms.com',
    labels: ['INBOX', 'UNREAD'],
    attachments: []
  };

  console.log('📧 Sample Email:');
  console.log(`   Subject: ${sampleEmail.subject}`);
  console.log(`   From: ${sampleEmail.from}`);
  console.log(`   Has Attachments: No\n`);

  console.log('⚙️  Executing workflow...\n');

  try {
    const result = await executeWorkflow(
      workflowId,
      'test-user',
      'gmail',
      sampleEmail,
    );

    console.log('✅ Workflow executed successfully!\n');
    console.log('📊 Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n❌ Workflow execution failed:');
    console.error(error);
    process.exit(1);
  }
}

testWorkflow().catch(console.error);
