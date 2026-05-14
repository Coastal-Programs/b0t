#!/usr/bin/env npx tsx
/**
 * Quick comparison: same parsed workflow data in 3 output formats
 * So we can actually see which one is best for Claude to consume
 */

import { readFileSync } from 'fs';

const parsed = JSON.parse(
  readFileSync('n8n-workflows/outreach-system/Lead Outreach Agent.parsed.json', 'utf-8')
);

// Pick 3 interesting nodes: Lead Agent (AI), leadScraping (tool), Voice or Text (switch)
const agentNode = parsed.nodes.find((n: any) => n.name === 'Lead Agent');
const toolNode = parsed.nodes.find((n: any) => n.name === 'leadScraping');
const switchNode = parsed.nodes.find((n: any) => n.name === 'Voice or Text');
const transcribeNode = parsed.nodes.find((n: any) => n.name === 'Transcribe');

const testNodes = [agentNode, toolNode, switchNode, transcribeNode].filter(Boolean);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n' + '━'.repeat(70));
console.log('FORMAT 1: RAW TEXT (current)');
console.log('━'.repeat(70));

for (const node of testNodes) {
  console.log(`\n  [${node.name}]`);
  console.log(`  N8N type: ${node.n8nType}`);
  console.log(
    `  b0t: ${node.mapping.known ? `${node.mapping.b0tModule}.${node.mapping.b0tFunction || '?'}` : '⚠ UNKNOWN'}`
  );
  if (node.aiPrompts?.length) {
    console.log(`  AI Prompts:`);
    for (const p of node.aiPrompts) {
      const preview = p.content.split('\n').slice(0, 3).join('\n    ');
      console.log(`    [${p.role}] (${p.content.length} chars):`);
      console.log(`    ${preview}...`);
    }
  }
  if (node.expressions?.length) {
    console.log(`  Expressions:`);
    for (const e of node.expressions) {
      console.log(`    ${e.path}: ${e.raw?.substring(0, 60) || ''}`);
    }
  }
  if (node.credentials?.length) {
    console.log(`  Credentials: ${node.credentials.join(', ')}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n\n' + '━'.repeat(70));
console.log('FORMAT 2: MARKDOWN');
console.log('━'.repeat(70));

console.log(`\n# Lead Outreach Agent`);
console.log(
  `\n**Nodes:** ${parsed.totalNodes} | **Active:** ${parsed.active} | **Trigger:** ${parsed.trigger?.n8nType || 'none'}`
);
console.log(`\n## Flow\n`);
console.log('```');
console.log(parsed.flowSummary);
console.log('```');
console.log(`\n## Nodes\n`);

for (const node of testNodes) {
  console.log(`### ${node.name}`);
  console.log(`| Field | Value |`);
  console.log(`|-------|-------|`);
  console.log(`| N8N Type | \`${node.n8nType}\` |`);
  console.log(
    `| b0t | ${node.mapping.known ? `\`${node.mapping.b0tModule}.${node.mapping.b0tFunction || '?'}\`` : '⚠ UNKNOWN'} |`
  );
  if (node.credentials?.length) {
    console.log(`| Credentials | ${node.credentials.join(', ')} |`);
  }
  if (node.expressions?.length) {
    console.log(`\n**Expressions:**`);
    for (const e of node.expressions) {
      console.log(
        `- \`${e.path}\`: ${e.type === 'named-node' ? `references "${e.referencesNode}" → ${e.referencesField}` : `reads ${e.referencesField || e.raw?.substring(0, 60)}`}`
      );
    }
  }
  if (node.aiPrompts?.length) {
    for (const p of node.aiPrompts) {
      console.log(`\n**${p.role} prompt** (${p.content.length} chars):`);
      console.log('```');
      console.log(p.content);
      console.log('```');
    }
  }
  console.log('');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n' + '━'.repeat(70));
console.log('FORMAT 3: YAML-LIKE');
console.log('━'.repeat(70));

console.log(`\nworkflow: Lead Outreach Agent`);
console.log(`nodes: ${parsed.totalNodes}`);
console.log(`active: ${parsed.active}`);
console.log(
  `trigger: ${parsed.trigger?.n8nType || 'none'} → ${parsed.trigger?.b0tTriggerType || '?'}`
);
console.log(`\nflow: |`);
for (const line of parsed.flowSummary.split('\n')) {
  console.log(`  ${line}`);
}
console.log(`\nnodes:`);

for (const node of testNodes) {
  console.log(`  - name: ${node.name}`);
  console.log(`    n8nType: ${node.n8nType}`);
  console.log(
    `    b0t: ${node.mapping.known ? `${node.mapping.b0tModule}.${node.mapping.b0tFunction || '?'}` : 'UNKNOWN'}`
  );
  if (node.credentials?.length) {
    console.log(`    credentials: [${node.credentials.join(', ')}]`);
  }
  if (node.expressions?.length) {
    console.log(`    dataFlow:`);
    for (const e of node.expressions) {
      if (e.type === 'named-node') {
        console.log(`      - from: "${e.referencesNode}"`);
        console.log(`        field: ${e.referencesField}`);
      } else if (e.referencesField) {
        console.log(`      - input: $json.${e.referencesField}`);
      }
    }
  }
  if (node.aiPrompts?.length) {
    console.log(`    prompts:`);
    for (const p of node.aiPrompts) {
      console.log(`      ${p.role}: |`);
      for (const line of p.content.split('\n')) {
        console.log(`        ${line}`);
      }
    }
  }
}

console.log('\n' + '━'.repeat(70));
console.log('COMPARISON NOTES:');
console.log('━'.repeat(70));
console.log('- Raw text: flat, easy to scan, but no structure for programmatic use');
console.log('- Markdown: headers + tables + code blocks, good visual hierarchy');
console.log('- YAML: structured, already close to b0t plan format, handles multiline well');
console.log('━'.repeat(70));
