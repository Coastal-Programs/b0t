import { db } from '../src/lib/db';
import { workflowsTable, usersTable } from '../src/lib/schema';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/import-direct.ts <workflow-json-file>');
    process.exit(1);
  }

  const wf = JSON.parse(readFileSync(filePath, 'utf8'));
  const users = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (users.length === 0) {
    console.log('No users found');
    process.exit(1);
  }

  const userId = users[0].id;
  const id = randomUUID();

  await db.insert(workflowsTable).values({
    id,
    userId,
    organizationId: null,
    name: wf.name,
    description: wf.description,
    prompt: 'Imported: ' + wf.name,
    config: JSON.stringify(wf.config) as unknown as typeof workflowsTable.$inferInsert.config,
    trigger: JSON.stringify(wf.trigger) as unknown as typeof workflowsTable.$inferInsert.trigger,
    status: 'draft',
    importedFrom: wf.importedFrom || null,
    conversionMetadata: wf.conversionMetadata || null,
  });

  console.log('Workflow imported successfully!');
  console.log('ID:', id);
  console.log('Name:', wf.name);
  process.exit(0);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
