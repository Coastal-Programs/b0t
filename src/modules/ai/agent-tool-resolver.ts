import { type Tool } from 'ai';
import { logger } from '@/lib/logger';
import {
  getAllAgentTools,
  getAgentToolsByCategory,
  getAgentTools as getCuratedTools,
  getMCPAgentTools,
} from './agent-tools-library';
import { generateToolsFromModules } from './ai-tools';

/**
 * Unified Agent Tool Resolver
 *
 * Provides a single entry point for loading agent tools, used by both
 * ai-agent.ts (non-streaming) and ai-agent-stream.ts (streaming).
 *
 * Tool loading strategy:
 * 1. Curated tools from agent-tools-library.ts (high-quality, hand-crafted schemas)
 * 2. Registry-generated tools from ai-tools.ts (auto-generated from 140+ modules)
 * 3. MCP tools (dynamically loaded from MCP servers)
 * 4. Custom tools (user-provided)
 *
 * By default, only curated tools are loaded. Set `includeRegistryTools: true`
 * to also include auto-generated tools from the full module registry.
 */

export interface AgentToolOptions {
  /**
   * Select tools by category: 'web', 'ai', 'communication', 'utilities', or 'all'
   */
  categories?: string[];

  /**
   * Select specific curated tools by name
   */
  tools?: string[];

  /**
   * Use all available curated tools (default if no other options provided)
   */
  useAll?: boolean;

  /**
   * Also include auto-generated tools from the full module registry.
   * These cover 140+ modules but have less refined schemas than curated tools.
   */
  includeRegistryTools?: boolean;

  /**
   * Filter registry tools to specific modules (e.g., ['social.twitter']).
   * Only applies when includeRegistryTools is true.
   */
  registryModules?: string[];

  /**
   * Maximum number of registry tools to generate (for token limit management).
   * Only applies when includeRegistryTools is true.
   */
  maxRegistryTools?: number;

  /**
   * Enable MCP (Model Context Protocol) tools
   */
  useMCP?: boolean;

  /**
   * Specific MCP servers to use (if useMCP is true)
   */
  mcpServers?: string[];

  /**
   * User credentials for auto-injection into registry tools
   */
  credentials?: Record<string, string>;
}

export interface ResolvedTools {
  tools: Record<string, Tool>;
  counts: {
    curated: number;
    registry: number;
    mcp: number;
    custom: number;
    total: number;
  };
}

/**
 * Resolve agent tools based on the provided options.
 *
 * This is the single source of truth for tool loading across both
 * the streaming and non-streaming agent execution paths.
 */
export async function resolveAgentTools(
  options: AgentToolOptions = {},
  customTools: Record<string, Tool> = {}
): Promise<ResolvedTools> {
  // 1. Load curated tools
  let curatedTools: Record<string, Tool> = {};

  if (options.tools && options.tools.length > 0) {
    curatedTools = getCuratedTools(options.tools);
    logger.info({ toolNames: options.tools }, 'Resolved specific curated tools');
  } else if (options.categories && options.categories.length > 0) {
    curatedTools = getAgentToolsByCategory(options.categories);
    logger.info({ categories: options.categories }, 'Resolved curated tools by category');
  } else {
    curatedTools = getAllAgentTools();
    logger.info('Resolved all curated tools');
  }

  // 2. Load registry-generated tools if requested
  let registryTools: Record<string, Tool> = {};

  if (options.includeRegistryTools) {
    registryTools = generateToolsFromModules({
      categories: options.categories,
      modules: options.registryModules,
      maxTools: options.maxRegistryTools,
      credentials: options.credentials,
    });
    logger.info(
      { registryToolCount: Object.keys(registryTools).length },
      'Resolved registry-generated tools'
    );
  }

  // 3. Load MCP tools if enabled
  let mcpTools: Record<string, Tool> = {};

  if (options.useMCP) {
    try {
      mcpTools = await getMCPAgentTools(options.mcpServers);
      logger.info(
        {
          mcpToolCount: Object.keys(mcpTools).length,
          mcpServers: options.mcpServers,
        },
        'Resolved MCP tools'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Failed to load MCP tools');
    }
  }

  // Merge: curated first (highest priority), then registry, then MCP, then custom
  // Later entries override earlier ones with the same key
  const allTools = { ...registryTools, ...curatedTools, ...mcpTools, ...customTools };

  const counts = {
    curated: Object.keys(curatedTools).length,
    registry: Object.keys(registryTools).length,
    mcp: Object.keys(mcpTools).length,
    custom: Object.keys(customTools).length,
    total: Object.keys(allTools).length,
  };

  logger.info(counts, 'Agent tools resolved');

  return { tools: allTools, counts };
}
