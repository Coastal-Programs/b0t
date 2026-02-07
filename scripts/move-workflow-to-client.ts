#!/usr/bin/env tsx
/**
 * Move workflow to Coastal Programs client
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import { db } from '../src/lib/db';
import { workflowsTable, organizationsTable } from '../src/lib/schema';
import { eq, like } from 'drizzle-orm';

async function moveWorkflowToClient() {
  const workflowId = '5e22c2d0-c2d1-4cf2-8047-eef2586725d3';
  const clientName = 'Coastal Programs';

  console.log('🔄 Moving workflow to client...\n');

  // Find Coastal Programs organization
  console.log(`🔍 Looking for client: "${clientName}"`);
  const orgs = await db
    .select()
    .from(organizationsTable)
    .where(like(organizationsTable.name, `%${clientName}%`))
    .limit(5);

  if (orgs.length === 0) {
    console.error(`❌ Client "${clientName}" not found`);
    console.log('\n📋 Available organizations:');
    const allOrgs = await db.select().from(organizationsTable).limit(10);
    allOrgs.forEach(org => {
      console.log(`   - ${org.name} (ID: ${org.id})`);
    });
    process.exit(1);
  }

  if (orgs.length > 1) {
    console.log(`\n⚠️  Multiple organizations found:`);
    orgs.forEach((org, i) => {
      console.log(`   ${i + 1}. ${org.name} (ID: ${org.id})`);
    });
    console.log(`\nUsing first match: ${orgs[0].name}`);
  }

  const organization = orgs[0];
  console.log(`✅ Found: ${organization.name} (ID: ${organization.id})\n`);

  // Update workflow
  console.log('📝 Updating workflow...');
  const result = await db
    .update(workflowsTable)
    .set({ organizationId: organization.id })
    .where(eq(workflowsTable.id, workflowId))
    .returning();

  if (result.length === 0) {
    console.error('❌ Workflow not found');
    process.exit(1);
  }

  console.log('✅ Workflow moved successfully!\n');
  console.log('📊 Details:');
  console.log(`   Workflow: ${result[0].name}`);
  console.log(`   Client: ${organization.name}`);
  console.log(`   Organization ID: ${organization.id}`);
  console.log('\n🌐 View at: http://localhost:3123/dashboard/workflows');
}

moveWorkflowToClient().catch(console.error);
