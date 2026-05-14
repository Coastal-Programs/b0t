import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { usersTable, invitationsTable, organizationMembersTable } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { logger } from '@/lib/logger';
import { checkStrictRateLimit } from '@/lib/ratelimit';

/**
 * POST /api/auth/register
 * Register a new user via invitation token
 */
export async function POST(request: NextRequest) {
  // Apply rate limiting (3 requests per minute) to prevent registration abuse
  const rateLimitResult = await checkStrictRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const { token, email, password, name } = body;

    // Validate input
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Invitation token is required' }, { status: 400 });
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Find invitation
    const [invitation] = await db
      .select()
      .from(invitationsTable)
      .where(and(eq(invitationsTable.token, token), eq(invitationsTable.email, email)))
      .limit(1);

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation token or email' }, { status: 404 });
    }

    // Check if invitation is expired
    if (new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
    }

    // Check if invitation was already accepted
    if (invitation.acceptedAt) {
      return NextResponse.json({ error: 'Invitation has already been used' }, { status: 400 });
    }

    // Check if user already exists
    const [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user, add to organization, and mark invitation as accepted atomically
    const userId = nanoid();

    await db.transaction(async (tx) => {
      await tx.insert(usersTable).values({
        id: userId,
        email: email.toLowerCase(),
        password: hashedPassword,
        name: name || null,
        emailVerified: 1, // Consider them verified since they used the invitation
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await tx.insert(organizationMembersTable).values({
        id: nanoid(),
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        joinedAt: new Date(),
      });

      await tx
        .update(invitationsTable)
        .set({ acceptedAt: new Date() })
        .where(eq(invitationsTable.id, invitation.id));
    });

    logger.info(
      {
        userId,
        email: email.toLowerCase(),
        organizationId: invitation.organizationId,
        action: 'user_register_success',
      },
      'User registered successfully'
    );

    return NextResponse.json({
      success: true,
      message: 'Account created successfully. You can now sign in.',
    });
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        action: 'user_register_failed',
      },
      'Failed to register user'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
