import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganizationMembers, getOrganizationById, getUserRoleInOrganization } from '@/lib/organizations';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { accountsTable, usersTable, invitationsTable } from '@/lib/schema';
import { inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sendEmail, getResendFromEmail } from '@/modules/communication/email';
import { getInvitationEmailHtml } from '@/lib/email-templates';

/**
 * GET /api/clients/[id]/members
 * Get all members of a client organization
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Verify user has access to this organization
    const role = await getUserRoleInOrganization(session.user.id, id);
    if (!role) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get all members with account details in a single query (fixes N+1 problem)
    const members = await getOrganizationMembers(id);

    // Fetch account details and user details in parallel
    const userIds = members.map(m => m.userId);
    const [accounts, users] = userIds.length > 0
      ? await Promise.all([
          db.select().from(accountsTable).where(inArray(accountsTable.userId, userIds)),
          db.select().from(usersTable).where(inArray(usersTable.id, userIds)),
        ])
      : [[], []];

    // Create lookup maps for O(1) access
    const accountMap = new Map(
      accounts.map(acc => [acc.userId, acc])
    );
    const userMap = new Map(
      users.map(u => [u.id, u])
    );

    // Map members with their details (prefer usersTable for name/email)
    const membersWithDetails = members.map((member) => {
      const account = accountMap.get(member.userId);
      const user = userMap.get(member.userId);
      return {
        id: member.id,
        userId: member.userId,
        email: user?.email || account?.account_name || member.userId,
        name: user?.name || account?.account_name || undefined,
        role: member.role,
        joinedAt: member.joinedAt,
      };
    });

    return NextResponse.json({ members: membersWithDetails });
  } catch (error) {
    const { id } = await params;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: id,
        action: 'client_members_fetch_failed'
      },
      'Failed to fetch client members'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/clients/[id]/members
 * Invite a new member to the client organization
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { email, role } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!role || !['admin', 'member', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Verify user has permission (must be owner, admin, or platform admin)
    if (!session.user.isPlatformAdmin) {
      const userRole = await getUserRoleInOrganization(session.user.id, id);
      if (userRole !== 'owner' && userRole !== 'admin') {
        return NextResponse.json({ error: 'Only owners and admins can invite members' }, { status: 403 });
      }
    }

    // Generate invitation token
    const token = nanoid(32);
    const invitationId = nanoid();

    // Create invitation that expires in 7 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

     
    await (db as any).insert(invitationsTable).values({
      id: invitationId,
      token,
      email: email.toLowerCase(),
      organizationId: id,
      role,
      invitedBy: session.user.id,
      expiresAt,
      createdAt: new Date(),
    });

    // Generate invitation link
    const inviteUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3123'}/auth/register?token=${token}&email=${encodeURIComponent(email)}`;

    // Send invitation email (graceful degradation — if sending fails, the invite record still exists)
    let emailSent = false;
    try {
      const org = await getOrganizationById(id);
      const orgName = org?.name || 'your organization';
      const inviterName = session.user.name || session.user.email || 'A team member';
      const fromAddress = await getResendFromEmail();
      const html = getInvitationEmailHtml({
        organizationName: orgName,
        inviterName,
        role,
        inviteUrl,
        expiresInDays: 7,
      });

      await sendEmail({
        from: fromAddress,
        to: email.toLowerCase(),
        subject: `You've been invited to join ${orgName}`,
        html,
      });
      emailSent = true;
    } catch (emailError) {
      logger.warn(
        { error: emailError instanceof Error ? emailError.message : String(emailError), email, organizationId: id },
        'Failed to send invitation email — invitation record created, link can be shared manually'
      );
    }

    return NextResponse.json({
      success: true,
      message: emailSent ? 'Invitation sent successfully' : 'Invitation created (email could not be sent — share the link manually)',
      inviteUrl,
      emailSent,
    });
  } catch (error) {
    const { id } = await params;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: id,
        action: 'client_member_invite_failed'
      },
      'Failed to invite client member'
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
