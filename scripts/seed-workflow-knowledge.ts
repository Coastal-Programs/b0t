/**
 * Seed Workflow Knowledge Base
 *
 * Populates the workflow_node_mappings and workflow_patterns tables with
 * initial N8N and Make.com conversion knowledge.
 */

import { db } from '../src/lib/db.js';
import {
  workflowNodeMappingsTable,
  workflowPatternsTable,
} from '../src/lib/schema.js';

async function seed() {
  console.log('📝 Seeding workflow knowledge base...\n');

  try {
    // ============================================
    // N8N NODE MAPPINGS
    // ============================================
    console.log('📌 Seeding N8N node mappings...');

    const n8nMappings = [
      // AI Nodes
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: '@n8n/n8n-nodes-langchain.textClassifier',
        identifierType: 'node_type',
        odinModulePath: 'ai.aiSdk.generateJSON',
        conversionConfig: {
          useEnumSchema: true,
          extractCategoryDescriptions: true,
          buildPromptFromDescriptions: true,
          modelDefault: 'claude-3-5-haiku-20241022',
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: '@n8n/n8n-nodes-langchain.anthropic',
        identifierType: 'node_type',
        odinModulePath: 'ai.aiSdk.generateText',
        conversionConfig: {
          provider: 'anthropic',
          extractSystemPrompt: true,
          extractOptions: ['temperature', 'maxTokens', 'topP'],
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: '@n8n/n8n-nodes-langchain.openAi',
        identifierType: 'node_type',
        odinModulePath: 'ai.aiSdk.generateText',
        conversionConfig: {
          provider: 'openai',
          extractSystemPrompt: true,
        },
      },

      // Data Nodes
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.airtable',
        identifierType: 'node_type',
        odinModulePath: 'data.airtable',
        conversionConfig: {
          mapOperationToMethod: true,
          operations: {
            search: 'searchRecords',
            create: 'createRecord',
            update: 'updateRecord',
            delete: 'deleteRecord',
            list: 'listRecords',
          },
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.googleSheets',
        identifierType: 'node_type',
        odinModulePath: 'data.google-sheets',
        conversionConfig: {
          mapOperationToMethod: true,
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.postgres',
        identifierType: 'node_type',
        odinModulePath: 'data.postgres',
        conversionConfig: {
          extractQuery: true,
        },
      },

      // Communication Nodes
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.gmail',
        identifierType: 'node_type',
        odinModulePath: 'communication.gmail',
        conversionConfig: {
          mapActionsToMethods: true,
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.slack',
        identifierType: 'node_type',
        odinModulePath: 'communication.slack',
        conversionConfig: {
          mapActionsToMethods: true,
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.discord',
        identifierType: 'node_type',
        odinModulePath: 'communication.discord',
        conversionConfig: {
          mapActionsToMethods: true,
        },
      },

      // Utility Nodes
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.httpRequest',
        identifierType: 'node_type',
        odinModulePath: 'utilities.http.request',
        conversionConfig: {
          extractMethod: true,
          extractHeaders: true,
          extractBody: true,
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.code',
        identifierType: 'node_type',
        odinModulePath: 'utilities.javascript.execute',
        conversionConfig: {
          extractCode: true,
          wrapInFunction: false,
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.if',
        identifierType: 'node_type',
        odinModulePath: 'utilities.javascript.execute',
        conversionConfig: {
          convertConditionsToJs: true,
          generateBooleanReturn: true,
        },
      },

      // Trigger Nodes
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.scheduleTrigger',
        identifierType: 'node_type',
        odinModulePath: 'trigger.schedule',
        conversionConfig: {
          extractCronExpression: true,
        },
      },
      {
        sourcePlatform: 'n8n',
        sourceIdentifier: 'n8n-nodes-base.webhook',
        identifierType: 'node_type',
        odinModulePath: 'trigger.webhook',
        conversionConfig: {
          extractPath: true,
          extractMethod: true,
        },
      },
    ];

    for (const mapping of n8nMappings) {
      await db
        .insert(workflowNodeMappingsTable)
        .values(mapping)
        .onConflictDoNothing();
    }

    console.log(`✅ Seeded ${n8nMappings.length} N8N node mappings\n`);

    // ============================================
    // MAKE.COM MODULE MAPPINGS
    // ============================================
    console.log('📌 Seeding Make.com module mappings...');

    const makeMappings = [
      // Triggers
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'airtable:TriggerWatchRecords',
        identifierType: 'module_action',
        odinModulePath: 'data.airtable.watchRecords',
        conversionConfig: {
          triggerType: 'polling',
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'cal-com:calSubscribe',
        identifierType: 'module_action',
        odinModulePath: 'webhook',
        conversionConfig: {
          triggerType: 'webhook',
          extractWebhookUrl: true,
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'gmail:watchEmails',
        identifierType: 'module_action',
        odinModulePath: 'communication.gmail.watch',
        conversionConfig: {
          triggerType: 'webhook',
        },
      },

      // Actions
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'airtable:ActionSearchRecords',
        identifierType: 'module_action',
        odinModulePath: 'data.airtable.searchRecords',
        conversionConfig: {
          extractBase: true,
          extractTable: true,
          extractFormula: true,
          mapFilterToFormula: true,
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'airtable:ActionCreateRecords',
        identifierType: 'module_action',
        odinModulePath: 'data.airtable.createRecord',
        conversionConfig: {
          mapFieldsFromMapper: true,
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'canva:makeApiCall',
        identifierType: 'module_action',
        odinModulePath: 'utilities.http.request',
        conversionConfig: {
          isCustomApiCall: true,
          extractUrlFromMapper: true,
          extractMethodFromMapper: true,
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'google-sheets:getValues',
        identifierType: 'module_action',
        odinModulePath: 'data.google-sheets.getRange',
        conversionConfig: {
          extractSpreadsheetId: true,
          extractRange: true,
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'slack:sendMessage',
        identifierType: 'module_action',
        odinModulePath: 'communication.slack.sendMessage',
        conversionConfig: {
          mapFieldsFromMapper: true,
        },
      },

      // Utilities
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'builtin:BasicRouter',
        identifierType: 'module_action',
        odinModulePath: 'PATTERN_DETECTION_NEEDED',
        conversionConfig: {
          requiresPatternConversion: true,
          patternType: 'multi_route_branching',
        },
      },
      {
        sourcePlatform: 'make',
        sourceIdentifier: 'builtin:BasicFilter',
        identifierType: 'module_action',
        odinModulePath: 'utilities.javascript.execute',
        conversionConfig: {
          convertConditionsToJs: true,
        },
      },
    ];

    for (const mapping of makeMappings) {
      await db
        .insert(workflowNodeMappingsTable)
        .values(mapping)
        .onConflictDoNothing();
    }

    console.log(`✅ Seeded ${makeMappings.length} Make.com module mappings\n`);

    // ============================================
    // N8N PATTERNS
    // ============================================
    console.log('📌 Seeding N8N patterns...');

    const n8nPatterns = [
      {
        sourcePlatform: 'n8n',
        patternName: 'cascading_ai_classifiers',
        description:
          'Two AI classifiers where second only runs conditionally based on first result',
        detectionCriteria: {
          sequential_text_classifiers: true,
          conditional_connection: true,
          min_classifiers: 2,
        },
        conversionStrategy: {
          approach: 'sequential_steps',
          add_javascript_conditional: true,
          run_both_classifiers: true,
        },
        yamlTemplate: `# Main classifier
- module: ai.aiSdk.generateJSON
  outputAs: mainCat
# Conditional check
- module: utilities.javascript.execute
  code: "return { needsSub: mainCat.category === 'Finance' };"
  outputAs: check
# Sub-classifier
- module: ai.aiSdk.generateJSON
  outputAs: subCat`,
      },
      {
        sourcePlatform: 'n8n',
        patternName: 'ai_agent_with_tools',
        description: 'AI agent node with custom tools defined',
        detectionCriteria: {
          has_anthropic_or_openai_node: true,
          has_tool_definitions: true,
        },
        conversionStrategy: {
          approach: 'ai_agent_module',
          extract_tools: true,
          convert_tools_to_odin_modules: true,
        },
        yamlTemplate: `- module: ai.aiAgent.runAgent
  inputs:
    model: claude-3-5-sonnet-20241022
    tools: [...]  # Extracted and converted
    prompt: "{{trigger.message}}"`,
      },
    ];

    for (const pattern of n8nPatterns) {
      await db
        .insert(workflowPatternsTable)
        .values(pattern)
        .onConflictDoNothing();
    }

    console.log(`✅ Seeded ${n8nPatterns.length} N8N patterns\n`);

    // ============================================
    // MAKE.COM PATTERNS
    // ============================================
    console.log('📌 Seeding Make.com patterns...');

    const makePatterns = [
      {
        sourcePlatform: 'make',
        patternName: 'multi_route_branching',
        description:
          'BasicRouter with multiple conditional routes (Make.com branching pattern)',
        detectionCriteria: {
          module_type: 'builtin:BasicRouter',
          min_routes: 2,
        },
        conversionStrategy: {
          approach: 'ask_user_or_create_multiple_workflows',
          options: [
            'Create separate Odin workflows for each route',
            'Use conditional JavaScript steps in single workflow',
            'Use Odin conditional steps feature (if implemented)',
          ],
        },
        yamlTemplate: `# Option 1: Multiple workflows
# Create one workflow per route

# Option 2: JavaScript conditionals
- module: utilities.javascript.execute
  code: |
    if (condition1) return { route: 'route1' };
    if (condition2) return { route: 'route2' };
  outputAs: routeDecision`,
      },
    ];

    for (const pattern of makePatterns) {
      await db
        .insert(workflowPatternsTable)
        .values(pattern)
        .onConflictDoNothing();
    }

    console.log(`✅ Seeded ${makePatterns.length} Make.com patterns\n`);

    console.log('✅ Knowledge base seeding complete!');
    console.log('\nSummary:');
    console.log(`  - ${n8nMappings.length} N8N node mappings`);
    console.log(`  - ${makeMappings.length} Make.com module mappings`);
    console.log(`  - ${n8nPatterns.length} N8N patterns`);
    console.log(`  - ${makePatterns.length} Make.com patterns`);
    console.log(
      `  - Total: ${n8nMappings.length + makeMappings.length + n8nPatterns.length + makePatterns.length} entries`
    );
  } catch (error) {
    console.error('❌ Failed to seed knowledge base:', error);
    process.exit(1);
  }

  process.exit(0);
}

seed();
