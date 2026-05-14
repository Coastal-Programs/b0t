import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUserNotifications } from '@/lib/notifications';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true';

  const result = await getUserNotifications(session.user.id, { limit, offset, unreadOnly });

  return NextResponse.json(result);
}
