import { executeWorkflow } from '../src/lib/workflows/executor';

async function main() {
  const workflowId = process.argv[2];
  if (!workflowId) {
    console.error('Usage: npx tsx scripts/run-workflow.ts <workflow-id>');
    process.exit(1);
  }

  console.log(`Running workflow: ${workflowId}`);

  const result = await executeWorkflow(workflowId, '1', 'manual', {});

  console.log('\n--- Result ---');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});
