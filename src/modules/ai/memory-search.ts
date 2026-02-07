/**
 * Memory Search Module
 *
 * Allows workflows to interact with the agent memory system for storing and retrieving facts.
 * Useful for building personalized agents that remember user preferences, project context, etc.
 */

import { MemoryManager } from '@/lib/memory/memory-manager';

/**
 * Store a memory fact from a workflow
 * @param category - Category (user_info, preferences, projects, people, work, notes, decisions)
 * @param subject - Short identifier/title for the fact
 * @param content - Full content of the fact
 * @param metadata - Optional metadata object
 * @param userId - User ID (injected by workflow executor)
 * @param organizationId - Organization ID (injected by workflow executor)
 * @returns Object with the created fact ID
 */
export async function storeFact(
  category: string,
  subject: string,
  content: string,
  metadata?: Record<string, unknown>,
  userId?: string,
  organizationId?: string
): Promise<{ id: string }> {
  if (!userId) {
    throw new Error('userId is required for memory operations');
  }

  const memoryManager = new MemoryManager(userId, organizationId);
  return await memoryManager.saveFact(category, subject, content, metadata);
}

/**
 * Search memories using hybrid search (vector + keyword)
 * @param query - Search query (natural language)
 * @param topK - Number of results to return (default: 6)
 * @param userId - User ID (injected by workflow executor)
 * @param organizationId - Organization ID (injected by workflow executor)
 * @returns Array of matching facts with relevance scores
 */
export async function searchMemories(
  query: string,
  topK: number = 6,
  userId?: string,
  organizationId?: string
): Promise<Array<{ subject: string; content: string; category: string; score: number; metadata?: Record<string, unknown> }>> {
  if (!userId) {
    throw new Error('userId is required for memory operations');
  }

  const memoryManager = new MemoryManager(userId, organizationId);
  return await memoryManager.searchFacts(query, topK);
}

/**
 * Delete a memory fact
 * @param factId - Fact ID to delete
 * @param userId - User ID (injected by workflow executor)
 * @param organizationId - Organization ID (injected by workflow executor)
 * @returns Success status
 */
export async function deleteFact(
  factId: string,
  userId?: string,
  organizationId?: string
): Promise<{ success: boolean }> {
  if (!userId) {
    throw new Error('userId is required for memory operations');
  }

  const memoryManager = new MemoryManager(userId, organizationId);
  await memoryManager.deleteFact(factId);
  return { success: true };
}

/**
 * Get all facts as context string (formatted markdown)
 * Useful for providing context to AI agents
 * @param userId - User ID (injected by workflow executor)
 * @param organizationId - Organization ID (injected by workflow executor)
 * @returns Markdown-formatted string of all facts
 */
export async function getFactsContext(
  userId?: string,
  organizationId?: string
): Promise<{ context: string }> {
  if (!userId) {
    throw new Error('userId is required for memory operations');
  }

  const memoryManager = new MemoryManager(userId, organizationId);
  const context = await memoryManager.getFactsForContext();
  return { context };
}
