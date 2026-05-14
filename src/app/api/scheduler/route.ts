import { NextResponse } from 'next/server';
import { scheduler } from '@/lib/scheduler';
import { auth } from '@/lib/auth';

/**
 * API Route to manage the scheduler
 *
 * GET /api/scheduler - Get scheduler status
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isRunning = scheduler.isRunning();
  const jobs = scheduler.getJobs();

  return NextResponse.json({
    isRunning,
    jobCount: jobs.length,
    jobs,
    message: isRunning
      ? 'Scheduler is running'
      : 'Scheduler is not running. Jobs need to be initialized in instrumentation.ts',
  });
}
