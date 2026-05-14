import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { z } from 'zod';

/**
 * Supabase Module
 *
 * Native Supabase integration using the PostgREST API.
 * Provides CRUD operations and stored procedure calls.
 *
 * Requires:
 * - supabaseUrl: Your project URL (e.g. https://xyz.supabase.co)
 * - supabaseKey: Service role key or anon key
 *
 * @see https://supabase.com/docs/guides/api
 */

const supabaseRateLimiter = createRateLimiter({
  maxConcurrent: 10,
  minTime: 100,
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
  id: 'supabase',
});

// --- Types ---

export interface SupabaseResponse {
  data: Record<string, unknown>[] | null;
  count: number | null;
  status: number;
  error: string | null;
}

// --- Schemas ---

const baseSchema = z.object({
  supabaseUrl: z.string(),
  supabaseKey: z.string(),
  table: z.string(),
});

const insertRowSchema = baseSchema.extend({
  data: z.record(z.string(), z.unknown()),
});

const updateRowSchema = baseSchema.extend({
  data: z.record(z.string(), z.unknown()),
  match: z.record(z.string(), z.string()),
});

const deleteRowSchema = baseSchema.extend({
  match: z.record(z.string(), z.string()),
});

const selectRowsSchema = baseSchema.extend({
  columns: z.string().optional().default('*'),
  filters: z
    .array(
      z.object({
        column: z.string(),
        operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in']),
        value: z.string(),
      })
    )
    .optional(),
  order: z
    .object({
      column: z.string(),
      ascending: z.boolean().optional().default(true),
    })
    .optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const upsertRowSchema = baseSchema.extend({
  data: z.record(z.string(), z.unknown()),
  onConflict: z.string().optional(),
});

const rpcSchema = z.object({
  supabaseUrl: z.string(),
  supabaseKey: z.string(),
  functionName: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// --- Helpers ---

function buildUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/$/, '');
  return `${base}/rest/v1/${path}`;
}

function buildHeaders(supabaseKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function buildFilterQuery(filters?: z.infer<typeof selectRowsSchema>['filters']): string {
  if (!filters?.length) return '';
  return filters.map((f) => `${f.column}=${f.operator}.${f.value}`).join('&');
}

async function supabaseRequest(url: string, options: RequestInit): Promise<SupabaseResponse> {
  const response = await fetch(url, options);
  const text = await response.text();

  let data: Record<string, unknown>[] | null = null;
  try {
    const parsed = JSON.parse(text);
    data = Array.isArray(parsed) ? parsed : parsed ? [parsed] : null;
  } catch {
    // Non-JSON response (e.g. 204 No Content)
  }

  if (!response.ok) {
    const errorMsg =
      (data?.[0]?.message as string) ||
      (data?.[0]?.error as string) ||
      text ||
      `HTTP ${response.status}`;
    throw new Error(`Supabase API error (${response.status}): ${errorMsg}`);
  }

  const countHeader = response.headers.get('content-range');
  const count = countHeader ? parseInt(countHeader.split('/').pop() || '0', 10) : null;

  return {
    data,
    count,
    status: response.status,
    error: null,
  };
}

// --- insertRow ---

/**
 * Insert a row into a Supabase table
 * @example
 * const result = await insertRow({
 *   supabaseUrl: 'https://xyz.supabase.co',
 *   supabaseKey: 'your-key',
 *   table: 'contacts',
 *   data: { name: 'Jane', email: 'jane@example.com' }
 * });
 */
async function insertRowInternal(
  input: z.infer<typeof insertRowSchema>
): Promise<SupabaseResponse> {
  const validated = insertRowSchema.parse(input);

  logger.info({ table: validated.table, provider: 'supabase' }, 'Supabase insertRow');

  return supabaseRequest(buildUrl(validated.supabaseUrl, validated.table), {
    method: 'POST',
    headers: buildHeaders(validated.supabaseKey, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(validated.data),
  });
}

const insertRowWithBreaker = createCircuitBreaker(insertRowInternal, {
  timeout: 30000,
  name: 'supabase-insert-row',
});

export async function insertRow(input: z.infer<typeof insertRowSchema>): Promise<SupabaseResponse> {
  return (await withRateLimit(
    () => insertRowWithBreaker.fire(input),
    supabaseRateLimiter
  )()) as unknown as SupabaseResponse;
}

// --- updateRow ---

/**
 * Update rows in a Supabase table matching the given filters
 * @example
 * const result = await updateRow({
 *   supabaseUrl: 'https://xyz.supabase.co',
 *   supabaseKey: 'your-key',
 *   table: 'contacts',
 *   data: { status: 'active' },
 *   match: { id: '123' }
 * });
 */
async function updateRowInternal(
  input: z.infer<typeof updateRowSchema>
): Promise<SupabaseResponse> {
  const validated = updateRowSchema.parse(input);

  logger.info(
    { table: validated.table, match: validated.match, provider: 'supabase' },
    'Supabase updateRow'
  );

  const filterParams = Object.entries(validated.match)
    .map(([col, val]) => `${col}=eq.${val}`)
    .join('&');

  return supabaseRequest(`${buildUrl(validated.supabaseUrl, validated.table)}?${filterParams}`, {
    method: 'PATCH',
    headers: buildHeaders(validated.supabaseKey, {
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(validated.data),
  });
}

const updateRowWithBreaker = createCircuitBreaker(updateRowInternal, {
  timeout: 30000,
  name: 'supabase-update-row',
});

export async function updateRow(input: z.infer<typeof updateRowSchema>): Promise<SupabaseResponse> {
  return (await withRateLimit(
    () => updateRowWithBreaker.fire(input),
    supabaseRateLimiter
  )()) as unknown as SupabaseResponse;
}

// --- deleteRow ---

/**
 * Delete rows from a Supabase table matching the given filters
 * @example
 * const result = await deleteRow({
 *   supabaseUrl: 'https://xyz.supabase.co',
 *   supabaseKey: 'your-key',
 *   table: 'contacts',
 *   match: { id: '123' }
 * });
 */
async function deleteRowInternal(
  input: z.infer<typeof deleteRowSchema>
): Promise<SupabaseResponse> {
  const validated = deleteRowSchema.parse(input);

  logger.info(
    { table: validated.table, match: validated.match, provider: 'supabase' },
    'Supabase deleteRow'
  );

  const filterParams = Object.entries(validated.match)
    .map(([col, val]) => `${col}=eq.${val}`)
    .join('&');

  return supabaseRequest(`${buildUrl(validated.supabaseUrl, validated.table)}?${filterParams}`, {
    method: 'DELETE',
    headers: buildHeaders(validated.supabaseKey, {
      Prefer: 'return=representation',
    }),
  });
}

const deleteRowWithBreaker = createCircuitBreaker(deleteRowInternal, {
  timeout: 30000,
  name: 'supabase-delete-row',
});

export async function deleteRow(input: z.infer<typeof deleteRowSchema>): Promise<SupabaseResponse> {
  return (await withRateLimit(
    () => deleteRowWithBreaker.fire(input),
    supabaseRateLimiter
  )()) as unknown as SupabaseResponse;
}

// --- selectRows ---

/**
 * Query rows from a Supabase table with filters, ordering, and pagination
 * @example
 * const result = await selectRows({
 *   supabaseUrl: 'https://xyz.supabase.co',
 *   supabaseKey: 'your-key',
 *   table: 'contacts',
 *   columns: 'id,name,email',
 *   filters: [{ column: 'status', operator: 'eq', value: 'active' }],
 *   order: { column: 'created_at', ascending: false },
 *   limit: 10
 * });
 */
async function selectRowsInternal(
  input: z.infer<typeof selectRowsSchema>
): Promise<SupabaseResponse> {
  const validated = selectRowsSchema.parse(input);

  logger.info({ table: validated.table, provider: 'supabase' }, 'Supabase selectRows');

  const params = new URLSearchParams();
  params.set('select', validated.columns);

  if (validated.filters?.length) {
    const filterStr = buildFilterQuery(validated.filters);
    filterStr.split('&').forEach((part) => {
      const [key, ...rest] = part.split('=');
      params.set(key, rest.join('='));
    });
  }

  if (validated.order) {
    params.set('order', `${validated.order.column}.${validated.order.ascending ? 'asc' : 'desc'}`);
  }

  const headers: Record<string, string> = {
    Prefer: 'count=exact',
  };

  if (validated.limit !== undefined) {
    const start = validated.offset ?? 0;
    const end = start + validated.limit - 1;
    headers['Range'] = `${start}-${end}`;
  }

  return supabaseRequest(
    `${buildUrl(validated.supabaseUrl, validated.table)}?${params.toString()}`,
    {
      method: 'GET',
      headers: buildHeaders(validated.supabaseKey, headers),
    }
  );
}

const selectRowsWithBreaker = createCircuitBreaker(selectRowsInternal, {
  timeout: 30000,
  name: 'supabase-select-rows',
});

export async function selectRows(
  input: z.infer<typeof selectRowsSchema>
): Promise<SupabaseResponse> {
  return (await withRateLimit(
    () => selectRowsWithBreaker.fire(input),
    supabaseRateLimiter
  )()) as unknown as SupabaseResponse;
}

// --- upsertRow ---

/**
 * Upsert a row into a Supabase table (insert or update on conflict)
 * @example
 * const result = await upsertRow({
 *   supabaseUrl: 'https://xyz.supabase.co',
 *   supabaseKey: 'your-key',
 *   table: 'contacts',
 *   data: { id: '123', name: 'Jane', email: 'jane@example.com' },
 *   onConflict: 'id'
 * });
 */
async function upsertRowInternal(
  input: z.infer<typeof upsertRowSchema>
): Promise<SupabaseResponse> {
  const validated = upsertRowSchema.parse(input);

  logger.info(
    {
      table: validated.table,
      onConflict: validated.onConflict,
      provider: 'supabase',
    },
    'Supabase upsertRow'
  );

  const url = validated.onConflict
    ? `${buildUrl(validated.supabaseUrl, validated.table)}?on_conflict=${validated.onConflict}`
    : buildUrl(validated.supabaseUrl, validated.table);

  return supabaseRequest(url, {
    method: 'POST',
    headers: buildHeaders(validated.supabaseKey, {
      Prefer: 'return=representation,resolution=merge-duplicates',
    }),
    body: JSON.stringify(validated.data),
  });
}

const upsertRowWithBreaker = createCircuitBreaker(upsertRowInternal, {
  timeout: 30000,
  name: 'supabase-upsert-row',
});

export async function upsertRow(input: z.infer<typeof upsertRowSchema>): Promise<SupabaseResponse> {
  return (await withRateLimit(
    () => upsertRowWithBreaker.fire(input),
    supabaseRateLimiter
  )()) as unknown as SupabaseResponse;
}

// --- rpc ---

/**
 * Call a Supabase stored procedure / RPC function
 * @example
 * const result = await rpc({
 *   supabaseUrl: 'https://xyz.supabase.co',
 *   supabaseKey: 'your-key',
 *   functionName: 'get_user_stats',
 *   params: { user_id: '123' }
 * });
 */
async function rpcInternal(input: z.infer<typeof rpcSchema>): Promise<SupabaseResponse> {
  const validated = rpcSchema.parse(input);

  logger.info({ functionName: validated.functionName, provider: 'supabase' }, 'Supabase rpc');

  return supabaseRequest(buildUrl(validated.supabaseUrl, `rpc/${validated.functionName}`), {
    method: 'POST',
    headers: buildHeaders(validated.supabaseKey),
    body: JSON.stringify(validated.params ?? {}),
  });
}

const rpcWithBreaker = createCircuitBreaker(rpcInternal, {
  timeout: 60000,
  name: 'supabase-rpc',
});

export async function rpc(input: z.infer<typeof rpcSchema>): Promise<SupabaseResponse> {
  return (await withRateLimit(
    () => rpcWithBreaker.fire(input),
    supabaseRateLimiter
  )()) as unknown as SupabaseResponse;
}
