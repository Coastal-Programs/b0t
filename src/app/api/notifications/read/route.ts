import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { markAsRead } from '@/lib/notifications';

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { notificationId } = body as { notificationId: string };

  if (!notificationId) {
    return NextResponse.json({ error: 'notificationId is required' }, { status: 400 });
  }

  await markAsRead(notificationId, session.user.id);

  return NextResponse.json({ success: true });
}
