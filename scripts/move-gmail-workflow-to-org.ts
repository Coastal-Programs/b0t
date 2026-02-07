#!/usr/bin/env tsx
/**
 * Move Gmail Auto-Labeling workflow to Coastal Programs organization
 *
 * Tasks:
 * 1. Update workflow organizationId to Coastal Programs
 * 2. Delete old incomplete workflow if it exists
 * 3. Verify required credentials exist for the organization
 * 4. Report final status
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/move-gmail-workflow-to-org.ts
 */

import { db } from '../src/lib/db';
import { workflowsTable, userCredentialsTable } from '../src/lib/schema';
import { eq, and } from 'drizzle-orm';

const WORKFLOW_ID = 'f5c08868-8713-43f6-b71e-8f16e2f79d63';
const OLD_WORKFLOW_ID = '5e22c2d0-c2d1-4cf2-8047-eef2586725d3';
const ORGANIZATION_ID = 'cf2537d7-40cf-4bcf-b3b0-c64c38eef12f';
const ORGANIZATION_NAME = 'Coastal Programs';

async function moveGmailWorkflowToOrg() {
  console.log('🚀 Starting Gmail Auto-Labeling workflow migration\n');
  console.log('📋 Configuration:');
  console.log(`   Workflow ID: ${WORKFLOW_ID}`);
  console.log(`   Organization: ${ORGANIZATION_NAME}`);
  console.log(`   Organization ID: ${ORGANIZATION_ID}\n`);

  // Task 1: Update the workflow's organizationId
  console.log('📝 Task 1: Updating workflow organizationId...');
  try {
    const workflow = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, WORKFLOW_ID))
      .limit(1);

    if (workflow.length === 0) {
      console.error(`❌ Workflow ${WORKFLOW_ID} not found`);
      process.exit(1);
    }

    const updateResult = await db
      .update(workflowsTable)
      .set({
        organizationId: ORGANIZATION_ID,
        organizationStatus: 'active'
      })
      .where(eq(workflowsTable.id, WORKFLOW_ID))
      .returning();

    if (updateResult.length > 0) {
      console.log(`✅ Successfully updated workflow: ${updateResult[0].name}`);
      console.log(`   Old organizationId: ${workflow[0].organizationId || 'null'}`);
      console.log(`   New organizationId: ${updateResult[0].organizationId}`);
    }
  } catch (error) {
    console.error('❌ Failed to update workflow:', error);
    process.exit(1);
  }

  console.log('');

  // Task 2: Delete old incomplete workflow
  console.log('📝 Task 2: Checking for old incomplete workflow...');
  try {
    const oldWorkflow = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.id, OLD_WORKFLOW_ID))
      .limit(1);

    if (oldWorkflow.length > 0) {
      console.log(`   Found old workflow: ${oldWorkflow[0].name}`);
      console.log(`   Status: ${oldWorkflow[0].status}`);

      await db
        .delete(workflowsTable)
        .where(eq(workflowsTable.id, OLD_WORKFLOW_ID));

      console.log('✅ Successfully deleted old incomplete workflow');
    } else {
      console.log('ℹ️  No old workflow found (already deleted or never existed)');
    }
  } catch (error) {
    console.error('❌ Failed to delete old workflow:', error);
    // Don't exit - this is not critical
  }

  console.log('');

  // Task 3: Verify required credentials exist
  console.log('📝 Task 3: Verifying required credentials...');
  console.log('');

  const requiredCredentials = [
    { platform: 'gmail', name: 'Gmail' },
    { platform: 'google_drive', name: 'Google Drive' },
    { platform: 'anthropic', name: 'Anthropic' }
  ];

  const credentialResults: Array<{
    platform: string;
    name: string;
    exists: boolean;
    credentialName?: string;
  }> = [];

  for (const cred of requiredCredentials) {
    try {
      const credentials = await db
        .select()
        .from(userCredentialsTable)
        .where(
          and(
            eq(userCredentialsTable.organizationId, ORGANIZATION_ID),
            eq(userCredentialsTable.platform, cred.platform)
          )
        )
        .limit(1);

      if (credentials.length > 0) {
        console.log(`✅ ${cred.name}: Found (${credentials[0].name})`);
        credentialResults.push({
          platform: cred.platform,
          name: cred.name,
          exists: true,
          credentialName: credentials[0].name
        });
      } else {
        console.log(`❌ ${cred.name}: Not found`);
        credentialResults.push({
          platform: cred.platform,
          name: cred.name,
          exists: false
        });
      }
    } catch (error) {
      console.error(`❌ ${cred.name}: Error checking credential:`, error);
      credentialResults.push({
        platform: cred.platform,
        name: cred.name,
        exists: false
      });
    }
  }

  console.log('');

  // Task 4: Report final status
  console.log('📊 Final Status Report\n');
  console.log('═'.repeat(60));
  console.log('');

  console.log('✅ Workflow Migration:');
  console.log(`   Workflow ${WORKFLOW_ID} moved to ${ORGANIZATION_NAME}`);
  console.log('');

  console.log('🗑️  Old Workflow Cleanup:');
  console.log(`   Old workflow ${OLD_WORKFLOW_ID} handled`);
  console.log('');

  console.log('🔑 Credential Status:');
  const allCredsExist = credentialResults.every(r => r.exists);
  credentialResults.forEach(result => {
    const status = result.exists ? '✅' : '❌';
    const details = result.credentialName ? ` (${result.credentialName})` : ' (MISSING)';
    console.log(`   ${status} ${result.name}${details}`);
  });
  console.log('');

  if (allCredsExist) {
    console.log('✅ All required credentials are configured');
    console.log('✅ Workflow is ready to use');
  } else {
    console.log('⚠️  Missing credentials detected');
    console.log('⚠️  Please configure missing credentials before running workflow');
    console.log('');
    console.log('📝 To add credentials:');
    console.log('   1. Go to http://localhost:3123/dashboard/credentials');
    console.log('   2. Add the missing OAuth/API credentials');
  }

  console.log('');
  console.log('═'.repeat(60));
  console.log('');
  console.log('🌐 View workflow: http://localhost:3123/dashboard/workflows');
  console.log('');
}

moveGmailWorkflowToOrg().catch(error => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
