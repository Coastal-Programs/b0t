import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { notificationPreferencesTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

interface PreferencesPayload {
  channel: string;
  workflowFailures: boolean;
  credentialExpiry: boolean;
  credentialRefreshFailure: boolean;
  systemAlerts: boolean;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const prefs = await db
    .select()
    .from(notificationPreferencesTable)
    .where(eq(notificationPreferencesTable.userId, session.user.id));

  // Build response with defaults for missing channels
  const channels = ['in_app', 'email'];
  const result: Record<
    string,
    {
      workflowFailures: boolean;
      credentialExpiry: boolean;
      credentialRefreshFailure: boolean;
      systemAlerts: boolean;
    }
  > = {};

  for (const channel of channels) {
    const pref = prefs.find((p) => p.channel === channel);
    result[channel] = {
      workflowFailures: pref ? pref.workflowFailures === 1 : true,
      credentialExpiry: pref ? pref.credentialExpiry === 1 : true,
      credentialRefreshFailure: pref ? pref.credentialRefreshFailure === 1 : true,
      systemAlerts: pref ? pref.systemAlerts === 1 : true,
    };
  }

  return NextResponse.json(result);
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as PreferencesPayload;
  const { channel, workflowFailures, credentialExpiry, credentialRefreshFailure, systemAlerts } =
    body;

  if (!channel) {
    return NextResponse.json({ error: 'channel is required' }, { status: 400 });
  }

  // Upsert preference
  const existing = await db
    .select()
    .from(notificationPreferencesTable)
    .where(
      and(
        eq(notificationPreferencesTable.userId, session.user.id),
        eq(notificationPreferencesTable.channel, channel)
      )
    )
    .limit(1);

  const values = {
    workflowFailures: workflowFailures ? 1 : 0,
    credentialExpiry: credentialExpiry ? 1 : 0,
    credentialRefreshFailure: credentialRefreshFailure ? 1 : 0,
    systemAlerts: systemAlerts ? 1 : 0,
  };

  if (existing.length > 0) {
    await db
      .update(notificationPreferencesTable)
      .set(values)
      .where(eq(notificationPreferencesTable.id, existing[0].id));
  } else {
    await db.insert(notificationPreferencesTable).values({
      id: randomUUID(),
      userId: session.user.id,
      channel,
      ...values,
    });
  }

  return NextResponse.json({ success: true });
}
