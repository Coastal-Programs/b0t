import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { userCredentialsTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

/**
 * POST /api/credentials/[id]/reveal
 * Returns decrypted credential values for editing.
 * Uses POST (not GET) to prevent accidental caching/logging of secrets.
 * Requires active authenticated session.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    const [credential] = await db
      .select()
      .from(userCredentialsTable)
      .where(and(eq(userCredentialsTable.id, id), eq(userCredentialsTable.userId, session.user.id)))
      .limit(1);

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    }

    // Parse metadata
    const metadata =
      typeof credential.metadata === 'string'
        ? JSON.parse(credential.metadata)
        : credential.metadata;

    // Decrypt fields if they exist in metadata
    const fields: Record<string, string> = {};
    if (metadata && typeof metadata === 'object' && 'fields' in metadata) {
      const encryptedFields = metadata.fields as Record<string, string>;
      for (const [key, encryptedValue] of Object.entries(encryptedFields)) {
        fields[key] = decrypt(encryptedValue);
      }
    }

    // Decrypt single value if it exists
    let value: string | undefined;
    if (credential.encryptedValue) {
      value = decrypt(credential.encryptedValue);
    }

    logger.info(
      { userId: session.user.id, credentialId: id },
      'Credential values revealed for editing'
    );

    // Set no-cache headers to prevent secret caching
    return new NextResponse(
      JSON.stringify({
        id: credential.id,
        platform: credential.platform,
        name: credential.name,
        type: credential.type,
        value,
        fields,
        metadata,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Failed to reveal credential');
    return NextResponse.json({ error: 'Failed to reveal credential' }, { status: 500 });
  }
}
