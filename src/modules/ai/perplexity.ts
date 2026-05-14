import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { z } from 'zod';

/**
 * Perplexity AI Module
 *
 * Native Perplexity integration using their OpenAI-compatible API.
 * Provides web-connected AI chat and search with citations.
 *
 * Models:
 * - sonar: Fast search-focused model (default)
 * - sonar-pro: Enhanced search with deeper analysis
 * - sonar-reasoning: Multi-step reasoning with search
 * - sonar-deep-research: Deep research with extensive search
 *
 * @see https://docs.perplexity.ai/
 */

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

const perplexityRateLimiter = createRateLimiter({
  maxConcurrent: 3,
  minTime: 500,
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
  id: 'perplexity',
});

// --- Types ---

export interface PerplexityCitation {
  url: string;
  title?: string;
  snippet?: string;
}

export interface PerplexityChatResponse {
  text: string;
  citations: PerplexityCitation[];
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// --- Schemas ---

const chatInputSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  model: z.string().default('sonar'),
  temperature: z.number().optional().default(0.7),
  maxTokens: z.number().optional().default(4096),
  apiKey: z.string().optional(),
  searchDomainFilter: z.array(z.string()).optional(),
  returnImages: z.boolean().optional(),
  returnRelatedQuestions: z.boolean().optional(),
});

const searchAndAnswerInputSchema = z.object({
  query: z.string(),
  systemPrompt: z.string().optional(),
  model: z.string().default('sonar'),
  temperature: z.number().optional().default(0.7),
  maxTokens: z.number().optional().default(4096),
  apiKey: z.string().optional(),
  searchDomainFilter: z.array(z.string()).optional(),
});

// --- Internal helpers ---

async function callPerplexityAPI(
  body: Record<string, unknown>,
  apiKey: string
): Promise<PerplexityChatResponse> {
  const response = await fetch(PERPLEXITY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  const citations: PerplexityCitation[] = (data.citations ?? []).map((url: string) => ({ url }));

  return {
    text: choice?.message?.content ?? '',
    citations,
    model: data.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
  };
}

// --- chat ---

/**
 * Chat with Perplexity AI using sonar models with web search and citations
 * @example
 * const result = await chat({
 *   messages: [
 *     { role: 'system', content: 'Be concise.' },
 *     { role: 'user', content: 'What is the latest news on AI regulation?' }
 *   ],
 *   model: 'sonar',
 *   apiKey: 'pplx-...'
 * });
 * // result.text — the answer
 * // result.citations — array of { url, title?, snippet? }
 */
async function chatInternal(
  input: z.infer<typeof chatInputSchema>
): Promise<PerplexityChatResponse> {
  const validated = chatInputSchema.parse(input);

  if (!validated.apiKey) {
    throw new Error('Perplexity API key required. Add credentials in Settings.');
  }

  logger.info(
    {
      model: validated.model,
      provider: 'perplexity',
      messageCount: validated.messages.length,
    },
    'Perplexity chat request'
  );

  const body: Record<string, unknown> = {
    model: validated.model,
    messages: validated.messages,
    temperature: validated.temperature,
    max_tokens: validated.maxTokens,
  };

  if (validated.searchDomainFilter?.length) {
    body.search_domain_filter = validated.searchDomainFilter;
  }
  if (validated.returnImages) {
    body.return_images = true;
  }
  if (validated.returnRelatedQuestions) {
    body.return_related_questions = true;
  }

  return callPerplexityAPI(body, validated.apiKey);
}

const chatWithBreaker = createCircuitBreaker(chatInternal, {
  timeout: 120000,
  name: 'perplexity-chat',
});

const chatRateLimited = withRateLimit(
  async (input: z.infer<typeof chatInputSchema>) => chatWithBreaker.fire(input),
  perplexityRateLimiter
);

export async function chat(
  input: z.infer<typeof chatInputSchema>
): Promise<PerplexityChatResponse> {
  return (await chatRateLimited(input)) as unknown as PerplexityChatResponse;
}

// --- searchAndAnswer ---

/**
 * Web-grounded Q&A — ask a question, get an answer with citations
 * @example
 * const result = await searchAndAnswer({
 *   query: 'What technology stack does Acme Corp use?',
 *   apiKey: 'pplx-...'
 * });
 * // result.text — the answer
 * // result.citations — sources used
 */
async function searchAndAnswerInternal(
  input: z.infer<typeof searchAndAnswerInputSchema>
): Promise<PerplexityChatResponse> {
  const validated = searchAndAnswerInputSchema.parse(input);

  if (!validated.apiKey) {
    throw new Error('Perplexity API key required. Add credentials in Settings.');
  }

  logger.info(
    {
      model: validated.model,
      provider: 'perplexity',
      queryLength: validated.query.length,
    },
    'Perplexity searchAndAnswer request'
  );

  const messages: { role: 'system' | 'user'; content: string }[] = [];

  if (validated.systemPrompt) {
    messages.push({ role: 'system', content: validated.systemPrompt });
  }
  messages.push({ role: 'user', content: validated.query });

  const body: Record<string, unknown> = {
    model: validated.model,
    messages,
    temperature: validated.temperature,
    max_tokens: validated.maxTokens,
  };

  if (validated.searchDomainFilter?.length) {
    body.search_domain_filter = validated.searchDomainFilter;
  }

  return callPerplexityAPI(body, validated.apiKey);
}

const searchAndAnswerWithBreaker = createCircuitBreaker(searchAndAnswerInternal, {
  timeout: 120000,
  name: 'perplexity-search-and-answer',
});

const searchAndAnswerRateLimited = withRateLimit(
  async (input: z.infer<typeof searchAndAnswerInputSchema>) =>
    searchAndAnswerWithBreaker.fire(input),
  perplexityRateLimiter
);

export async function searchAndAnswer(
  input: z.infer<typeof searchAndAnswerInputSchema>
): Promise<PerplexityChatResponse> {
  return (await searchAndAnswerRateLimited(input)) as unknown as PerplexityChatResponse;
}

// --- Legacy aliases ---

/**
 * Generate text using Perplexity AI (legacy — prefer chat or searchAndAnswer)
 * @example
 * const result = await generateText({ prompt: 'Hello', apiKey: 'pplx-...' });
 */
export async function generateText(input: {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
}): Promise<PerplexityChatResponse> {
  return searchAndAnswer({
    query: input.prompt,
    systemPrompt: input.systemPrompt,
    model: input.model ?? 'sonar',
    temperature: input.temperature ?? 0.7,
    maxTokens: input.maxTokens ?? 4096,
    apiKey: input.apiKey,
  });
}

/**
 * Research a topic using Perplexity's web-connected search (legacy — prefer searchAndAnswer)
 * @example
 * const result = await research({ query: 'AI safety trends', apiKey: 'pplx-...' });
 */
export async function research(input: {
  query: string;
  systemPrompt?: string;
  model?: string;
  apiKey?: string;
}): Promise<PerplexityChatResponse> {
  return searchAndAnswer({
    query: input.query,
    systemPrompt:
      input.systemPrompt ||
      'You are a thorough research assistant. Provide accurate, well-sourced information.',
    model: input.model || 'sonar',
    temperature: 0.7,
    maxTokens: 4096,
    apiKey: input.apiKey,
  });
}
