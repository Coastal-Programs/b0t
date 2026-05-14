import { Resend } from 'resend';
import { createCircuitBreaker } from '@/lib/resilience';
import { createRateLimiter, withRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { appSettingsTable } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';

/**
 * Email Module (Resend)
 *
 * Send transactional emails with Resend
 * - Simple, modern API
 * - React email template support
 * - Built-in resilience (circuit breaker, rate limiting)
 * - Structured logging
 *
 * Perfect for:
 * - Sending notifications
 * - Workflow alerts
 * - Reports and summaries
 * - User communications
 */

// Cached values with TTL
let cachedApiKey: { value: string | null; expiresAt: number } = { value: null, expiresAt: 0 };
let cachedFromEmail: { value: string | null; expiresAt: number } = { value: null, expiresAt: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let resendClient: Resend | null = null;

async function getSettingValue(key: string): Promise<string | null> {
  try {
    const rows = await (db as any)
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key))
      .limit(1);
    if (rows[0]?.value) {
      try {
        return decrypt(rows[0].value);
      } catch {
        return rows[0].value;
      }
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to read app setting'
    );
  }
  return null;
}

async function getResendApiKey(): Promise<string | null> {
  // Env var takes priority
  if (process.env.RESEND_API_KEY) {
    return process.env.RESEND_API_KEY;
  }

  const now = Date.now();
  if (cachedApiKey.expiresAt > now) {
    return cachedApiKey.value;
  }

  const value = await getSettingValue('communication_resend_api_key');
  cachedApiKey = { value, expiresAt: now + CACHE_TTL };
  return value;
}

export async function getResendFromEmail(): Promise<string> {
  // Env var takes priority
  if (process.env.RESEND_FROM_EMAIL) {
    return process.env.RESEND_FROM_EMAIL;
  }

  const now = Date.now();
  if (cachedFromEmail.expiresAt > now && cachedFromEmail.value) {
    return cachedFromEmail.value;
  }

  const value = await getSettingValue('communication_resend_from_email');
  cachedFromEmail = { value, expiresAt: now + CACHE_TTL };
  return value || 'b0t <noreply@b0t.dev>';
}

async function getResendClient(): Promise<Resend> {
  const apiKey = await getResendApiKey();
  if (!apiKey) {
    throw new Error(
      'Resend API key not configured. Set RESEND_API_KEY env var or add it in Settings > Keys.'
    );
  }

  // Recreate client if key may have changed (cache expired)
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// Rate limiter: 100 emails per minute (conservative for Resend free tier)
const emailRateLimiter = createRateLimiter({
  maxConcurrent: 5,
  minTime: 600, // 600ms = ~100/min
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
  id: 'email-resend',
});

export interface EmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export interface EmailResponse {
  id: string;
}

/**
 * Internal send email function (unprotected)
 */
async function sendEmailInternal(options: EmailOptions): Promise<EmailResponse> {
  const client = await getResendClient();

  logger.info(
    {
      from: options.from,
      to: Array.isArray(options.to) ? options.to.length : 1,
      subject: options.subject.substring(0, 50),
    },
    'Sending email via Resend'
  );

  const emailPayload: {
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string;
    tags?: { name: string; value: string }[];
  } = {
    from: options.from,
    to: Array.isArray(options.to) ? options.to : [options.to],
    subject: options.subject,
  };

  if (options.html) emailPayload.html = options.html;
  if (options.text) emailPayload.text = options.text;
  if (options.cc) emailPayload.cc = Array.isArray(options.cc) ? options.cc : [options.cc];
  if (options.bcc) emailPayload.bcc = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
  if (options.replyTo) emailPayload.replyTo = options.replyTo;
  if (options.tags) emailPayload.tags = options.tags;

  const { data, error } = await client.emails.send(emailPayload as never);

  if (error) {
    logger.error({ error }, 'Failed to send email');
    throw new Error(`Email send failed: ${error.message}`);
  }

  if (!data) {
    throw new Error('Email send failed: No data returned');
  }

  logger.info({ emailId: data.id }, 'Email sent successfully');

  return { id: data.id };
}

/**
 * Send email (protected with circuit breaker + rate limiting)
 */
const sendEmailWithBreaker = createCircuitBreaker(sendEmailInternal, {
  timeout: 15000,
  name: 'send-email',
});

export const sendEmail = withRateLimit(
  (options: EmailOptions) => sendEmailWithBreaker.fire(options),
  emailRateLimiter
);

/**
 * Send simple text email (convenience function)
 */
export async function sendTextEmail(
  from: string,
  to: string | string[],
  subject: string,
  text: string
): Promise<EmailResponse> {
  return sendEmail({ from, to, subject, text });
}

/**
 * Send HTML email (convenience function)
 */
export async function sendHtmlEmail(
  from: string,
  to: string | string[],
  subject: string,
  html: string
): Promise<EmailResponse> {
  return sendEmail({ from, to, subject, html });
}
