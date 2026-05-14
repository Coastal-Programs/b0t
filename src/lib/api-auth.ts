import { auth } from '@/lib/auth';

/**
 * Authenticate an API request via session or B0T_API_KEY.
 *
 * Returns the user ID if authenticated, or null if not.
 * API key auth uses userId '1' (the admin/script user) to match
 * what the import-test endpoint creates workflows under.
 */
export async function getAuthUserId(request: Request): Promise<string | null> {
  // Check API key first (for CLI scripts)
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.B0T_API_KEY;
  if (apiKey && authHeader === `Bearer ${apiKey}`) {
    return '1'; // Script/admin user
  }

  // Fall back to session auth
  const session = await auth();
  return session?.user?.id ?? null;
}
