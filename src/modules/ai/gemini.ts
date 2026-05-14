import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { z } from 'zod';

/**
 * Google Gemini Module
 *
 * Native Google Gemini integration using the Generative Language API.
 * Provides chat, vision (image understanding), and embeddings.
 *
 * Models:
 * - gemini-2.0-flash: Fast, efficient (default)
 * - gemini-2.5-pro-preview-06-05: Most capable
 * - gemini-2.5-flash-preview-05-20: Fast with thinking
 * - text-embedding-004: Embeddings (768-dim default)
 *
 * @see https://ai.google.dev/gemini-api/docs
 */

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

const geminiRateLimiter = createRateLimiter({
  maxConcurrent: 5,
  minTime: 200,
  reservoir: 60,
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60 * 1000,
  id: 'gemini',
});

// --- Types ---

export interface GeminiChatResponse {
  text: string;
  model: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GeminiEmbeddingResponse {
  embedding: number[];
  model: string;
}

// --- Schemas ---

const chatInputSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'model']),
      content: z.string(),
    })
  ),
  systemPrompt: z.string().optional(),
  model: z.string().default('gemini-2.0-flash'),
  temperature: z.number().optional().default(0.7),
  maxTokens: z.number().optional().default(4096),
  apiKey: z.string().optional(),
});

const visionInputSchema = z.object({
  prompt: z.string(),
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  imageMimeType: z.string().optional().default('image/jpeg'),
  systemPrompt: z.string().optional(),
  model: z.string().default('gemini-2.0-flash'),
  temperature: z.number().optional().default(0.7),
  maxTokens: z.number().optional().default(4096),
  apiKey: z.string().optional(),
});

const embeddingsInputSchema = z.object({
  text: z.union([z.string(), z.array(z.string())]),
  model: z.string().default('text-embedding-004'),
  dimensions: z.number().optional(),
  apiKey: z.string().optional(),
});

// --- Helpers ---

async function geminiRequest<T>(
  url: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

interface GeminiRawResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

function parseGeminiResponse(data: GeminiRawResponse, model: string): GeminiChatResponse {
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join('') ?? '';

  return {
    text,
    model: data.modelVersion ?? model,
    finishReason: candidate?.finishReason ?? 'UNKNOWN',
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

// --- chat ---

/**
 * Chat with Google Gemini models
 * @example
 * const result = await chat({
 *   messages: [{ role: 'user', content: 'Explain quantum computing briefly' }],
 *   model: 'gemini-2.0-flash',
 *   apiKey: 'AIza...'
 * });
 */
async function chatInternal(input: z.infer<typeof chatInputSchema>): Promise<GeminiChatResponse> {
  const validated = chatInputSchema.parse(input);

  if (!validated.apiKey) {
    throw new Error('Gemini API key required. Add credentials in Settings.');
  }

  logger.info(
    {
      model: validated.model,
      provider: 'gemini',
      messageCount: validated.messages.length,
    },
    'Gemini chat request'
  );

  const contents = validated.messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: validated.temperature,
      maxOutputTokens: validated.maxTokens,
    },
  };

  if (validated.systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: validated.systemPrompt }],
    };
  }

  const url = `${GEMINI_API}/models/${validated.model}:generateContent`;
  const data = await geminiRequest<GeminiRawResponse>(url, validated.apiKey, body);
  return parseGeminiResponse(data, validated.model);
}

const chatWithBreaker = createCircuitBreaker(chatInternal, {
  timeout: 120000,
  name: 'gemini-chat',
});

export async function chat(input: z.infer<typeof chatInputSchema>): Promise<GeminiChatResponse> {
  return (await withRateLimit(
    () => chatWithBreaker.fire(input),
    geminiRateLimiter
  )()) as unknown as GeminiChatResponse;
}

// --- vision ---

/**
 * Analyze images with Gemini's vision capabilities
 * @example
 * const result = await vision({
 *   prompt: 'Describe what you see in this image',
 *   imageUrl: 'https://example.com/photo.jpg',
 *   apiKey: 'AIza...'
 * });
 */
async function visionInternal(
  input: z.infer<typeof visionInputSchema>
): Promise<GeminiChatResponse> {
  const validated = visionInputSchema.parse(input);

  if (!validated.apiKey) {
    throw new Error('Gemini API key required. Add credentials in Settings.');
  }

  if (!validated.imageUrl && !validated.imageBase64) {
    throw new Error('Either imageUrl or imageBase64 is required.');
  }

  logger.info(
    {
      model: validated.model,
      provider: 'gemini',
      hasImageUrl: !!validated.imageUrl,
      hasImageBase64: !!validated.imageBase64,
    },
    'Gemini vision request'
  );

  const parts: Record<string, unknown>[] = [{ text: validated.prompt }];

  if (validated.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: validated.imageMimeType,
        data: validated.imageBase64,
      },
    });
  } else if (validated.imageUrl) {
    // Fetch and inline the image
    const imgResponse = await fetch(validated.imageUrl);
    if (!imgResponse.ok) {
      throw new Error(`Failed to fetch image: ${imgResponse.status}`);
    }
    const buffer = await imgResponse.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = imgResponse.headers.get('content-type') ?? validated.imageMimeType;

    parts.push({
      inlineData: {
        mimeType,
        data: base64,
      },
    });
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: validated.temperature,
      maxOutputTokens: validated.maxTokens,
    },
  };

  if (validated.systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: validated.systemPrompt }],
    };
  }

  const url = `${GEMINI_API}/models/${validated.model}:generateContent`;
  const data = await geminiRequest<GeminiRawResponse>(url, validated.apiKey, body);
  return parseGeminiResponse(data, validated.model);
}

const visionWithBreaker = createCircuitBreaker(visionInternal, {
  timeout: 120000,
  name: 'gemini-vision',
});

export async function vision(
  input: z.infer<typeof visionInputSchema>
): Promise<GeminiChatResponse> {
  return (await withRateLimit(
    () => visionWithBreaker.fire(input),
    geminiRateLimiter
  )()) as unknown as GeminiChatResponse;
}

// --- embeddings ---

/**
 * Generate text embeddings using Gemini's embedding model
 * @example
 * const result = await embeddings({
 *   text: 'The quick brown fox',
 *   model: 'text-embedding-004',
 *   apiKey: 'AIza...'
 * });
 * // result.embedding — number[] vector
 */
async function embeddingsInternal(
  input: z.infer<typeof embeddingsInputSchema>
): Promise<GeminiEmbeddingResponse> {
  const validated = embeddingsInputSchema.parse(input);

  if (!validated.apiKey) {
    throw new Error('Gemini API key required. Add credentials in Settings.');
  }

  const textInput = Array.isArray(validated.text) ? validated.text.join(' ') : validated.text;

  logger.info(
    {
      model: validated.model,
      provider: 'gemini',
      textLength: textInput.length,
    },
    'Gemini embeddings request'
  );

  const body: Record<string, unknown> = {
    model: `models/${validated.model}`,
    content: {
      parts: [{ text: textInput }],
    },
  };

  if (validated.dimensions) {
    body.outputDimensionality = validated.dimensions;
  }

  const url = `${GEMINI_API}/models/${validated.model}:embedContent`;
  const data = await geminiRequest<{
    embedding: { values: number[] };
  }>(url, validated.apiKey, body);

  return {
    embedding: data.embedding.values,
    model: validated.model,
  };
}

const embeddingsWithBreaker = createCircuitBreaker(embeddingsInternal, {
  timeout: 30000,
  name: 'gemini-embeddings',
});

export async function embeddings(
  input: z.infer<typeof embeddingsInputSchema>
): Promise<GeminiEmbeddingResponse> {
  return (await withRateLimit(
    () => embeddingsWithBreaker.fire(input),
    geminiRateLimiter
  )()) as unknown as GeminiEmbeddingResponse;
}
