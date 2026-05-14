import { db } from '@/lib/db';
import { notificationsTable, notificationPreferencesTable, usersTable } from '@/lib/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

export type NotificationType =
  | 'workflow_failure'
  | 'credential_expiry'
  | 'credential_refresh_failure'
  | 'system_alert';

// Throttle duplicate notification emails — max 1 email per type+key per hour
const recentNotificationEmails = new Map<string, number>();
const NOTIFICATION_EMAIL_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

// Periodically clean up stale throttle entries to prevent memory leak
setInterval(
  () => {
    const now = Date.now();
    for (const [key, timestamp] of recentNotificationEmails) {
      if (now - timestamp > NOTIFICATION_EMAIL_THROTTLE_MS) {
        recentNotificationEmails.delete(key);
      }
    }
  },
  10 * 60 * 1000
); // Clean up every 10 minutes

interface CreateNotificationParams {
  userId: string;
  organizationId?: string;
  type: NotificationType;
  title: string;
  message?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a notification for a user.
 * Checks email preferences and optionally sends an email.
 * Wrapped in try/catch so it never breaks callers.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const { userId, organizationId, type, title, message, link, metadata } = params;

    const id = randomUUID();
    await db.insert(notificationsTable).values({
      id,
      userId,
      organizationId: organizationId || null,
      type,
      title,
      message: message || null,
      link: link || null,
      read: 0,
      metadata: metadata || null,
    });

    logger.info({ notificationId: id, userId, type, title }, 'Notification created');

    // Check email preferences and send email if enabled
    try {
      const prefs = await db
        .select()
        .from(notificationPreferencesTable)
        .where(
          and(
            eq(notificationPreferencesTable.userId, userId),
            eq(notificationPreferencesTable.channel, 'email')
          )
        )
        .limit(1);

      // Default: email enabled for all types. Check if explicitly disabled.
      const emailPref = prefs[0];
      let shouldEmail = true;

      if (emailPref) {
        const prefMap: Record<NotificationType, number> = {
          workflow_failure: emailPref.workflowFailures,
          credential_expiry: emailPref.credentialExpiry,
          credential_refresh_failure: emailPref.credentialRefreshFailure,
          system_alert: emailPref.systemAlerts,
        };
        shouldEmail = prefMap[type] === 1;
      }

      if (shouldEmail) {
        // Throttle: don't send duplicate emails for the same issue within 1 hour
        const throttleKey = `${userId}:${type}:${metadata?.provider || ''}:${metadata?.accountId || ''}`;
        const lastSent = recentNotificationEmails.get(throttleKey);
        if (lastSent && Date.now() - lastSent < NOTIFICATION_EMAIL_THROTTLE_MS) {
          logger.debug({ throttleKey, type }, 'Skipping duplicate notification email (throttled)');
        } else {
          recentNotificationEmails.set(throttleKey, Date.now());
          await sendNotificationEmail(userId, title, message || '', link);
        }
      }
    } catch (emailError) {
      logger.warn({ emailError, userId, type }, 'Failed to send notification email (non-fatal)');
    }
  } catch (error) {
    logger.error({ error, params }, 'Failed to create notification');
  }
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, 0)));

  return result[0]?.value ?? 0;
}

/**
 * Get paginated notifications for a user.
 */
export async function getUserNotifications(
  userId: string,
  opts: { limit?: number; offset?: number; unreadOnly?: boolean } = {}
): Promise<{
  notifications: (typeof notificationsTable.$inferSelect)[];
  total: number;
  unreadCount: number;
}> {
  const { limit = 20, offset = 0, unreadOnly = false } = opts;

  const conditions = [eq(notificationsTable.userId, userId)];
  if (unreadOnly) {
    conditions.push(eq(notificationsTable.read, 0));
  }

  const [notifications, totalResult, unreadResult] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(and(...conditions))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(notificationsTable)
      .where(and(...conditions)),
    db
      .select({ value: count() })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, 0))),
  ]);

  return {
    notifications,
    total: totalResult[0]?.value ?? 0,
    unreadCount: unreadResult[0]?.value ?? 0,
  };
}

/**
 * Mark a single notification or all notifications as read.
 */
export async function markAsRead(idOrAll: string, userId: string): Promise<void> {
  if (idOrAll === 'all') {
    await db
      .update(notificationsTable)
      .set({ read: 1 })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, 0)));
  } else {
    await db
      .update(notificationsTable)
      .set({ read: 1 })
      .where(and(eq(notificationsTable.id, idOrAll), eq(notificationsTable.userId, userId)));
  }
}

/**
 * Create a system alert notification for the admin user.
 */
export async function createSystemAlert(
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.warn('ADMIN_EMAIL not set, skipping system alert notification');
      return;
    }

    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, adminEmail))
      .limit(1);

    if (users.length === 0) {
      logger.warn({ adminEmail }, 'Admin user not found for system alert');
      return;
    }

    await createNotification({
      userId: users[0].id,
      type: 'system_alert',
      title,
      message,
      metadata,
    });
  } catch (error) {
    logger.error({ error, title }, 'Failed to create system alert');
  }
}

/**
 * Send a notification email using Resend.
 */
async function sendNotificationEmail(
  userId: string,
  title: string,
  message: string,
  link?: string | null
): Promise<void> {
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (users.length === 0) return;
    const userEmail = users[0].email;

    const { sendEmail, getResendFromEmail } = await import('@/modules/communication/email');
    const { getNotificationEmailHtml } = await import('@/lib/email-templates');

    const fromAddress = await getResendFromEmail();
    const html = getNotificationEmailHtml({ title, message, link });

    await sendEmail({
      from: fromAddress,
      to: userEmail,
      subject: `b0t: ${title}`,
      html,
    });

    logger.info({ userId, title }, 'Notification email sent');
  } catch (error) {
    logger.warn({ error, userId, title }, 'Failed to send notification email');
  }
}
