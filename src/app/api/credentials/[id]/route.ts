import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteCredential, updateCredential } from '@/lib/workflows/credentials';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { userCredentialsTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

/**
 * GET /api/credentials/[id]
 * Get credential details with decrypted fields
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    const [credential] = await db
      .select()
      .from(userCredentialsTable)
      .where(
        and(
          eq(userCredentialsTable.id, id),
          eq(userCredentialsTable.userId, session.user.id)
        )
      )
      .limit(1);

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    }

    // Parse metadata
    const metadata = typeof credential.metadata === 'string'
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

    return NextResponse.json({
      id: credential.id,
      platform: credential.platform,
      name: credential.name,
      type: credential.type,
      value,
      fields,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get credential');
    return NextResponse.json(
      { error: 'Failed to get credential' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/credentials/[id]
 * Update a credential's name and/or value
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const { value, name, fields } = body;

    // At least one field must be provided
    if (!value && !name && !fields) {
      return NextResponse.json(
        { error: 'At least one field (name, value, or fields) must be provided' },
        { status: 400 }
      );
    }

    // Update credential value if provided (single-field)
    if (value) {
      await updateCredential(session.user.id, id, value);
    }

    // Update multi-field credential if provided
    if (fields && typeof fields === 'object') {
      const { updateMultiFieldCredential } = await import('@/lib/workflows/credentials');
      await updateMultiFieldCredential(session.user.id, id, fields);
    }

    // Update credential name if provided
    if (name) {
      const { updateCredentialName } = await import('@/lib/workflows/credentials');
      await updateCredentialName(session.user.id, id, name);
    }

    logger.info(
      { userId: session.user.id, credentialId: id, updatedFields: { name: !!name, value: !!value, fields: !!fields } },
      'Credential updated'
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to update credential');
    return NextResponse.json(
      { error: 'Failed to update credential' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/credentials/[id]
 * Delete a credential
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    await deleteCredential(session.user.id, id);

    logger.info(
      { userId: session.user.id, credentialId: id },
      'Credential deleted'
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete credential');
    return NextResponse.json(
      { error: 'Failed to delete credential' },
      { status: 500 }
    );
  }
}
