'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

export default function GlobalError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  // unstable_retry: Next.js 16.2+ — calls router.refresh() + reset() in startTransition
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    logger.error({ error }, 'Global error boundary triggered');
  }, [error]);

  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center">
          <div className="text-center">
            <h1 className="text-5xl font-bold">500</h1>
            <p className="mt-4 text-xl">Something went wrong</p>
            <div className="mt-8">
              <button
                onClick={() => (unstable_retry ?? reset)()}
                className="px-4 py-2 bg-black text-white border-none rounded-md cursor-pointer hover:opacity-90"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
