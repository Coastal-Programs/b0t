import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

/**
 * Cal.com Module
 *
 * Manage Cal.com scheduling and bookings
 * - List and manage bookings
 * - Get event types
 * - Manage availability
 * - Cancel and reschedule bookings
 * - Webhook management
 * - Built-in resilience
 *
 * Perfect for:
 * - Meeting scheduling automation
 * - Calendar integration workflows
 * - Booking management
 * - Availability synchronization
 * - Event-driven automation via webhooks
 */

const CALCOM_API_KEY = process.env.CALCOM_API_KEY;

if (!CALCOM_API_KEY) {
  logger.warn('⚠️  CALCOM_API_KEY not set. Cal.com features will not work.');
}

const CALCOM_API_BASE = 'https://api.cal.com/v1';

// Rate limiter: Cal.com allows ~100-200 req/min
const calcomRateLimiter = createRateLimiter({
  maxConcurrent: 10,
  minTime: 300, // 300ms between requests ≈ 200/min
  reservoir: 200,
  reservoirRefreshAmount: 200,
  reservoirRefreshInterval: 60000,
  id: 'calcom',
});

export interface CalcomBooking {
  id: number;
  uid: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  status: 'accepted' | 'pending' | 'rejected' | 'cancelled';
  attendees: Array<{
    email: string;
    name: string;
    timeZone: string;
  }>;
  eventType: {
    id: number;
    title: string;
    slug: string;
  };
  user?: {
    id: number;
    email: string;
    name: string;
    timeZone: string;
  };
  metadata?: Record<string, unknown>;
  responses?: Record<string, unknown>;
  rescheduled?: boolean;
  paid?: boolean;
  payment?: Array<Record<string, unknown>>;
}

export interface CalcomEventType {
  id: number;
  title: string;
  slug: string;
  description?: string;
  length: number;
  hidden: boolean;
  position: number;
  userId?: number;
  teamId?: number;
  eventName?: string;
  timeZone?: string;
  periodType?: 'unlimited' | 'rolling' | 'range';
  periodStartDate?: string;
  periodEndDate?: string;
  periodDays?: number;
  periodCountCalendarDays?: boolean;
  requiresConfirmation?: boolean;
  disableGuests?: boolean;
  hideCalendarNotes?: boolean;
  minimumBookingNotice?: number;
  beforeEventBuffer?: number;
  afterEventBuffer?: number;
  slotInterval?: number;
  metadata?: Record<string, unknown>;
}

export interface CalcomAvailability {
  id: number;
  days: number[];
  startTime: string;
  endTime: string;
  date?: string;
  scheduleId?: number;
}

export interface CalcomWebhook {
  id: string;
  subscriberUrl: string;
  eventTriggers: string[];
  active: boolean;
  payloadTemplate?: string;
}

/**
 * Make API request to Cal.com
 *
 * Supports both API key authentication (legacy) and OAuth Bearer tokens.
 * Auto-detects auth method based on token format.
 */
async function makeCalcomRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
  apiKey?: string
): Promise<T> {
  const key = apiKey || CALCOM_API_KEY;

  if (!key) {
    throw new Error('Cal.com API key not set. Provide apiKey parameter or set CALCOM_API_KEY.');
  }

  // Auto-detect OAuth: OAuth tokens are typically longer and don't start with 'cal_'
  // API keys usually start with 'cal_' prefix
  const isOAuthToken = !key.startsWith('cal_') && key.length > 50;

  logger.info({ method, endpoint, authType: isOAuthToken ? 'OAuth' : 'API Key' }, 'Making Cal.com API request');

  const url = new URL(endpoint, CALCOM_API_BASE);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Use OAuth Bearer token or API key
  if (isOAuthToken) {
    headers['Authorization'] = `Bearer ${key}`;
  } else {
    url.searchParams.append('apiKey', key);
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Cal.com API error');
    throw new Error(`Cal.com API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as T;
  logger.info({ method, endpoint }, 'Cal.com API request successful');
  return data;
}

/**
 * List bookings (internal)
 */
async function listBookingsInternal(
  options: {
    apiKey?: string;
    status?: 'upcoming' | 'past' | 'cancelled';
    limit?: number;
    cursor?: number;
    eventTypeId?: number;
    userId?: number;
  } = {}
): Promise<{ bookings: CalcomBooking[] }> {
  logger.info({ status: options.status, limit: options.limit }, 'Listing Cal.com bookings');

  const params = new URLSearchParams();
  if (options.status) params.append('status', options.status);
  if (options.limit) params.append('limit', String(options.limit));
  if (options.cursor) params.append('cursor', String(options.cursor));
  if (options.eventTypeId) params.append('eventTypeId', String(options.eventTypeId));
  if (options.userId) params.append('userId', String(options.userId));

  const endpoint = `/bookings${params.toString() ? `?${params}` : ''}`;
  const data = await makeCalcomRequest<{ bookings: CalcomBooking[] }>(
    endpoint,
    'GET',
    undefined,
    options.apiKey
  );

  logger.info({ bookingCount: data.bookings.length }, 'Cal.com bookings listed');
  return data;
}

/**
 * List bookings
 *
 * Get a list of bookings with optional filters
 *
 * @param options - Filter options (status, limit, cursor, eventTypeId, userId, apiKey)
 * @returns Array of bookings
 * @example
 * const bookings = await listBookings({ status: 'upcoming', limit: 10, apiKey: '{{credential.calcom}}' });
 */
const listBookingsWithBreaker = createCircuitBreaker(listBookingsInternal, {
  timeout: 15000,
  name: 'calcom-list-bookings',
});

export const listBookings = withRateLimit(
  (options?: {
    apiKey?: string;
    status?: 'upcoming' | 'past' | 'cancelled';
    limit?: number;
    cursor?: number;
    eventTypeId?: number;
    userId?: number;
  }) => listBookingsWithBreaker.fire(options),
  calcomRateLimiter
);

/**
 * Get booking by ID (internal)
 */
async function getBookingInternal(
  bookingId: number,
  apiKey?: string
): Promise<{ booking: CalcomBooking }> {
  logger.info({ bookingId }, 'Fetching Cal.com booking');

  const data = await makeCalcomRequest<{ booking: CalcomBooking }>(
    `/bookings/${bookingId}`,
    'GET',
    undefined,
    apiKey
  );

  logger.info({ bookingId }, 'Cal.com booking fetched');
  return data;
}

/**
 * Get booking by ID
 *
 * Retrieve detailed information about a specific booking
 *
 * @param bookingId - Booking ID
 * @param apiKey - API key (optional, falls back to env)
 * @returns Booking details
 * @example
 * const booking = await getBooking(12345, '{{credential.calcom}}');
 */
const getBookingWithBreaker = createCircuitBreaker(getBookingInternal, {
  timeout: 10000,
  name: 'calcom-get-booking',
});

export const getBooking = withRateLimit(
  (bookingId: number, apiKey?: string) => getBookingWithBreaker.fire(bookingId, apiKey),
  calcomRateLimiter
);

/**
 * Cancel booking (internal)
 */
async function cancelBookingInternal(
  bookingId: number,
  options: {
    apiKey?: string;
    cancellationReason?: string;
  } = {}
): Promise<{ booking: CalcomBooking }> {
  logger.info({ bookingId, reason: options.cancellationReason }, 'Cancelling Cal.com booking');

  const data = await makeCalcomRequest<{ booking: CalcomBooking }>(
    `/bookings/${bookingId}/cancel`,
    'DELETE',
    options.cancellationReason ? { cancellationReason: options.cancellationReason } : undefined,
    options.apiKey
  );

  logger.info({ bookingId }, 'Cal.com booking cancelled');
  return data;
}

/**
 * Cancel booking
 *
 * Cancel an existing booking
 *
 * @param bookingId - Booking ID to cancel
 * @param options - Cancellation options (apiKey, cancellationReason)
 * @returns Cancelled booking details
 * @example
 * const result = await cancelBooking(12345, {
 *   cancellationReason: 'Schedule conflict',
 *   apiKey: '{{credential.calcom}}'
 * });
 */
const cancelBookingWithBreaker = createCircuitBreaker(cancelBookingInternal, {
  timeout: 10000,
  name: 'calcom-cancel-booking',
});

export const cancelBooking = withRateLimit(
  (
    bookingId: number,
    options?: {
      apiKey?: string;
      cancellationReason?: string;
    }
  ) => cancelBookingWithBreaker.fire(bookingId, options),
  calcomRateLimiter
);

/**
 * Reschedule booking (internal)
 */
async function rescheduleBookingInternal(
  bookingId: number,
  options: {
    apiKey?: string;
    startTime: string;
    endTime?: string;
    reschedulingReason?: string;
  }
): Promise<{ booking: CalcomBooking }> {
  logger.info({ bookingId, startTime: options.startTime }, 'Rescheduling Cal.com booking');

  const data = await makeCalcomRequest<{ booking: CalcomBooking }>(
    `/bookings/${bookingId}/reschedule`,
    'PATCH',
    {
      startTime: options.startTime,
      ...(options.endTime && { endTime: options.endTime }),
      ...(options.reschedulingReason && { reschedulingReason: options.reschedulingReason }),
    },
    options.apiKey
  );

  logger.info({ bookingId }, 'Cal.com booking rescheduled');
  return data;
}

/**
 * Reschedule booking
 *
 * Reschedule an existing booking to a new time
 *
 * @param bookingId - Booking ID to reschedule
 * @param options - Rescheduling options (startTime, endTime, reschedulingReason, apiKey)
 * @returns Rescheduled booking details
 * @example
 * const result = await rescheduleBooking(12345, {
 *   startTime: '2024-03-20T10:00:00Z',
 *   reschedulingReason: 'Client request',
 *   apiKey: '{{credential.calcom}}'
 * });
 */
const rescheduleBookingWithBreaker = createCircuitBreaker(rescheduleBookingInternal, {
  timeout: 10000,
  name: 'calcom-reschedule-booking',
});

export const rescheduleBooking = withRateLimit(
  (
    bookingId: number,
    options: {
      apiKey?: string;
      startTime: string;
      endTime?: string;
      reschedulingReason?: string;
    }
  ) => rescheduleBookingWithBreaker.fire(bookingId, options),
  calcomRateLimiter
);

/**
 * List event types (internal)
 */
async function listEventTypesInternal(
  apiKey?: string
): Promise<{ event_types: CalcomEventType[] }> {
  logger.info({}, 'Listing Cal.com event types');

  const data = await makeCalcomRequest<{ event_types: CalcomEventType[] }>(
    '/event-types',
    'GET',
    undefined,
    apiKey
  );

  logger.info({ eventTypeCount: data.event_types.length }, 'Cal.com event types listed');
  return data;
}

/**
 * List event types
 *
 * Get all available event types for the user
 *
 * @param apiKey - API key (optional, falls back to env)
 * @returns Array of event types
 * @example
 * const eventTypes = await listEventTypes('{{credential.calcom}}');
 */
const listEventTypesWithBreaker = createCircuitBreaker(listEventTypesInternal, {
  timeout: 10000,
  name: 'calcom-list-event-types',
});

export const listEventTypes = withRateLimit(
  (apiKey?: string) => listEventTypesWithBreaker.fire(apiKey),
  calcomRateLimiter
);

/**
 * Get event type by ID (internal)
 */
async function getEventTypeInternal(
  eventTypeId: number,
  apiKey?: string
): Promise<{ event_type: CalcomEventType }> {
  logger.info({ eventTypeId }, 'Fetching Cal.com event type');

  const data = await makeCalcomRequest<{ event_type: CalcomEventType }>(
    `/event-types/${eventTypeId}`,
    'GET',
    undefined,
    apiKey
  );

  logger.info({ eventTypeId }, 'Cal.com event type fetched');
  return data;
}

/**
 * Get event type by ID
 *
 * Retrieve detailed information about a specific event type
 *
 * @param eventTypeId - Event type ID
 * @param apiKey - API key (optional, falls back to env)
 * @returns Event type details
 * @example
 * const eventType = await getEventType(123, '{{credential.calcom}}');
 */
const getEventTypeWithBreaker = createCircuitBreaker(getEventTypeInternal, {
  timeout: 10000,
  name: 'calcom-get-event-type',
});

export const getEventType = withRateLimit(
  (eventTypeId: number, apiKey?: string) => getEventTypeWithBreaker.fire(eventTypeId, apiKey),
  calcomRateLimiter
);

/**
 * Create event type (internal)
 */
async function createEventTypeInternal(
  eventType: {
    title: string;
    slug: string;
    length: number;
    description?: string;
    hidden?: boolean;
    apiKey?: string;
  }
): Promise<{ event_type: CalcomEventType }> {
  logger.info({ title: eventType.title, slug: eventType.slug }, 'Creating Cal.com event type');

  const { apiKey, ...eventTypeData } = eventType;

  const data = await makeCalcomRequest<{ event_type: CalcomEventType }>(
    '/event-types',
    'POST',
    eventTypeData,
    apiKey
  );

  logger.info({ eventTypeId: data.event_type.id }, 'Cal.com event type created');
  return data;
}

/**
 * Create event type
 *
 * Create a new event type
 *
 * @param eventType - Event type configuration (title, slug, length, description, hidden, apiKey)
 * @returns Created event type
 * @example
 * const eventType = await createEventType({
 *   title: '30 Minute Meeting',
 *   slug: '30min',
 *   length: 30,
 *   description: 'Quick 30 minute meeting',
 *   apiKey: '{{credential.calcom}}'
 * });
 */
const createEventTypeWithBreaker = createCircuitBreaker(createEventTypeInternal, {
  timeout: 15000,
  name: 'calcom-create-event-type',
});

export const createEventType = withRateLimit(
  (eventType: {
    title: string;
    slug: string;
    length: number;
    description?: string;
    hidden?: boolean;
    apiKey?: string;
  }) => createEventTypeWithBreaker.fire(eventType),
  calcomRateLimiter
);

/**
 * Update event type (internal)
 */
async function updateEventTypeInternal(
  eventTypeId: number,
  updates: {
    title?: string;
    slug?: string;
    length?: number;
    description?: string;
    hidden?: boolean;
    apiKey?: string;
  }
): Promise<{ event_type: CalcomEventType }> {
  logger.info({ eventTypeId, updates }, 'Updating Cal.com event type');

  const { apiKey, ...updateData } = updates;

  const data = await makeCalcomRequest<{ event_type: CalcomEventType }>(
    `/event-types/${eventTypeId}`,
    'PATCH',
    updateData,
    apiKey
  );

  logger.info({ eventTypeId }, 'Cal.com event type updated');
  return data;
}

/**
 * Update event type
 *
 * Update an existing event type
 *
 * @param eventTypeId - Event type ID to update
 * @param updates - Fields to update (title, slug, length, description, hidden, apiKey)
 * @returns Updated event type
 * @example
 * const eventType = await updateEventType(123, {
 *   title: '45 Minute Meeting',
 *   length: 45,
 *   apiKey: '{{credential.calcom}}'
 * });
 */
const updateEventTypeWithBreaker = createCircuitBreaker(updateEventTypeInternal, {
  timeout: 15000,
  name: 'calcom-update-event-type',
});

export const updateEventType = withRateLimit(
  (
    eventTypeId: number,
    updates: {
      title?: string;
      slug?: string;
      length?: number;
      description?: string;
      hidden?: boolean;
      apiKey?: string;
    }
  ) => updateEventTypeWithBreaker.fire(eventTypeId, updates),
  calcomRateLimiter
);

/**
 * Delete event type (internal)
 */
async function deleteEventTypeInternal(
  eventTypeId: number,
  apiKey?: string
): Promise<{ message: string }> {
  logger.info({ eventTypeId }, 'Deleting Cal.com event type');

  const data = await makeCalcomRequest<{ message: string }>(
    `/event-types/${eventTypeId}`,
    'DELETE',
    undefined,
    apiKey
  );

  logger.info({ eventTypeId }, 'Cal.com event type deleted');
  return data;
}

/**
 * Delete event type
 *
 * Delete an event type
 *
 * @param eventTypeId - Event type ID to delete
 * @param apiKey - API key (optional, falls back to env)
 * @returns Deletion confirmation
 * @example
 * const result = await deleteEventType(123, '{{credential.calcom}}');
 */
const deleteEventTypeWithBreaker = createCircuitBreaker(deleteEventTypeInternal, {
  timeout: 10000,
  name: 'calcom-delete-event-type',
});

export const deleteEventType = withRateLimit(
  (eventTypeId: number, apiKey?: string) => deleteEventTypeWithBreaker.fire(eventTypeId, apiKey),
  calcomRateLimiter
);

/**
 * Create webhook (internal)
 */
async function createWebhookInternal(
  webhook: {
    subscriberUrl: string;
    eventTriggers: string[];
    active?: boolean;
    payloadTemplate?: string;
    apiKey?: string;
  }
): Promise<{ webhook: CalcomWebhook }> {
  logger.info({ subscriberUrl: webhook.subscriberUrl }, 'Creating Cal.com webhook');

  const { apiKey, ...webhookData } = webhook;

  const data = await makeCalcomRequest<{ webhook: CalcomWebhook }>(
    '/webhooks',
    'POST',
    webhookData,
    apiKey
  );

  logger.info({ webhookId: data.webhook.id }, 'Cal.com webhook created');
  return data;
}

/**
 * Create webhook
 *
 * Create a new webhook subscription
 *
 * @param webhook - Webhook configuration (subscriberUrl, eventTriggers, active, payloadTemplate, apiKey)
 * @returns Created webhook
 * @example
 * const webhook = await createWebhook({
 *   subscriberUrl: 'https://myapp.com/webhook',
 *   eventTriggers: ['BOOKING_CREATED', 'BOOKING_CANCELLED'],
 *   active: true,
 *   apiKey: '{{credential.calcom}}'
 * });
 */
const createWebhookWithBreaker = createCircuitBreaker(createWebhookInternal, {
  timeout: 10000,
  name: 'calcom-create-webhook',
});

export const createWebhook = withRateLimit(
  (webhook: {
    subscriberUrl: string;
    eventTriggers: string[];
    active?: boolean;
    payloadTemplate?: string;
    apiKey?: string;
  }) => createWebhookWithBreaker.fire(webhook),
  calcomRateLimiter
);

/**
 * List webhooks (internal)
 */
async function listWebhooksInternal(
  apiKey?: string
): Promise<{ webhooks: CalcomWebhook[] }> {
  logger.info({}, 'Listing Cal.com webhooks');

  const data = await makeCalcomRequest<{ webhooks: CalcomWebhook[] }>(
    '/webhooks',
    'GET',
    undefined,
    apiKey
  );

  logger.info({ webhookCount: data.webhooks.length }, 'Cal.com webhooks listed');
  return data;
}

/**
 * List webhooks
 *
 * Get all webhooks for the user
 *
 * @param apiKey - API key (optional, falls back to env)
 * @returns Array of webhooks
 * @example
 * const webhooks = await listWebhooks('{{credential.calcom}}');
 */
const listWebhooksWithBreaker = createCircuitBreaker(listWebhooksInternal, {
  timeout: 10000,
  name: 'calcom-list-webhooks',
});

export const listWebhooks = withRateLimit(
  (apiKey?: string) => listWebhooksWithBreaker.fire(apiKey),
  calcomRateLimiter
);

/**
 * Delete webhook (internal)
 */
async function deleteWebhookInternal(
  webhookId: string,
  apiKey?: string
): Promise<{ message: string }> {
  logger.info({ webhookId }, 'Deleting Cal.com webhook');

  const data = await makeCalcomRequest<{ message: string }>(
    `/webhooks/${webhookId}`,
    'DELETE',
    undefined,
    apiKey
  );

  logger.info({ webhookId }, 'Cal.com webhook deleted');
  return data;
}

/**
 * Delete webhook
 *
 * Delete a webhook subscription
 *
 * @param webhookId - Webhook ID to delete
 * @param apiKey - API key (optional, falls back to env)
 * @returns Deletion confirmation
 * @example
 * const result = await deleteWebhook('webhook_123', '{{credential.calcom}}');
 */
const deleteWebhookWithBreaker = createCircuitBreaker(deleteWebhookInternal, {
  timeout: 10000,
  name: 'calcom-delete-webhook',
});

export const deleteWebhook = withRateLimit(
  (webhookId: string, apiKey?: string) => deleteWebhookWithBreaker.fire(webhookId, apiKey),
  calcomRateLimiter
);
