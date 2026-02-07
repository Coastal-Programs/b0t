import { describe, it, expect } from 'vitest';

/**
 * Tests for the client members GET handler mapping logic.
 *
 * The GET handler in src/app/api/clients/[id]/members/route.ts:
 *   1. Fetches organization members (from organizationMembersTable)
 *   2. Fetches user details from both usersTable and accountsTable in parallel
 *   3. Builds lookup maps and merges data, preferring usersTable for name/email
 *
 * This file tests the pure mapping/merge logic extracted from that handler,
 * covering the bug where credential-registered users (in usersTable but NOT
 * in accountsTable) had missing names and emails.
 */

// ---------------------------------------------------------------------------
// Types that mirror the shapes used in the handler
// ---------------------------------------------------------------------------

interface OrgMember {
  id: string;
  userId: string;
  role: string;
  joinedAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
}

interface AccountRow {
  userId: string;
  account_name: string | null;
}

// ---------------------------------------------------------------------------
// Pure mapping function extracted from the GET handler (lines 56-67)
// ---------------------------------------------------------------------------

function mapMembersWithDetails(
  members: OrgMember[],
  accounts: AccountRow[],
  users: UserRow[],
) {
  const accountMap = new Map(accounts.map((acc) => [acc.userId, acc]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  return members.map((member) => {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Client Members - mapping logic', () => {
  const now = new Date('2025-01-15T00:00:00Z');

  // -----------------------------------------------------------------------
  // Bug case: user registered via credentials (exists in usersTable only)
  // -----------------------------------------------------------------------
  it('returns name and email from usersTable when user has no account row', () => {
    const members: OrgMember[] = [
      { id: 'mem-1', userId: 'user-cred', role: 'member', joinedAt: now },
    ];
    const accounts: AccountRow[] = []; // no OAuth account
    const users: UserRow[] = [
      { id: 'user-cred', email: 'alice@example.com', name: 'Alice' },
    ];

    const result = mapMembersWithDetails(members, accounts, users);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'mem-1',
      userId: 'user-cred',
      email: 'alice@example.com',
      name: 'Alice',
      role: 'member',
      joinedAt: now,
    });
  });

  // -----------------------------------------------------------------------
  // OAuth user: exists in accountsTable only (no usersTable row)
  // -----------------------------------------------------------------------
  it('falls back to accountsTable when user has no usersTable row', () => {
    const members: OrgMember[] = [
      { id: 'mem-2', userId: 'user-oauth', role: 'admin', joinedAt: now },
    ];
    const accounts: AccountRow[] = [
      { userId: 'user-oauth', account_name: 'bob@gmail.com' },
    ];
    const users: UserRow[] = [];

    const result = mapMembersWithDetails(members, accounts, users);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'mem-2',
      userId: 'user-oauth',
      email: 'bob@gmail.com',
      name: 'bob@gmail.com',
      role: 'admin',
      joinedAt: now,
    });
  });

  // -----------------------------------------------------------------------
  // User exists in both tables: usersTable data should take priority
  // -----------------------------------------------------------------------
  it('prefers usersTable data over accountsTable when both exist', () => {
    const members: OrgMember[] = [
      { id: 'mem-3', userId: 'user-both', role: 'owner', joinedAt: now },
    ];
    const accounts: AccountRow[] = [
      { userId: 'user-both', account_name: 'old-name@provider.com' },
    ];
    const users: UserRow[] = [
      { id: 'user-both', email: 'carol@example.com', name: 'Carol' },
    ];

    const result = mapMembersWithDetails(members, accounts, users);

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('carol@example.com');
    expect(result[0].name).toBe('Carol');
  });

  // -----------------------------------------------------------------------
  // User exists in neither table: fallback to userId
  // -----------------------------------------------------------------------
  it('falls back to userId when user exists in neither table', () => {
    const members: OrgMember[] = [
      { id: 'mem-4', userId: 'user-ghost', role: 'viewer', joinedAt: now },
    ];
    const accounts: AccountRow[] = [];
    const users: UserRow[] = [];

    const result = mapMembersWithDetails(members, accounts, users);

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('user-ghost');
    expect(result[0].name).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Mixed scenario: multiple members with different data sources
  // -----------------------------------------------------------------------
  it('handles a mix of credential-only, OAuth-only, both, and ghost users', () => {
    const members: OrgMember[] = [
      { id: 'mem-a', userId: 'user-cred-only', role: 'member', joinedAt: now },
      { id: 'mem-b', userId: 'user-oauth-only', role: 'member', joinedAt: now },
      { id: 'mem-c', userId: 'user-both-tables', role: 'admin', joinedAt: now },
      { id: 'mem-d', userId: 'user-neither', role: 'viewer', joinedAt: now },
    ];
    const accounts: AccountRow[] = [
      { userId: 'user-oauth-only', account_name: 'oauth-user@google.com' },
      { userId: 'user-both-tables', account_name: 'stale-name@provider.com' },
    ];
    const users: UserRow[] = [
      { id: 'user-cred-only', email: 'cred@example.com', name: 'Cred User' },
      { id: 'user-both-tables', email: 'fresh@example.com', name: 'Fresh Name' },
    ];

    const result = mapMembersWithDetails(members, accounts, users);

    expect(result).toHaveLength(4);

    // Credential-only user -- from usersTable
    expect(result[0].email).toBe('cred@example.com');
    expect(result[0].name).toBe('Cred User');

    // OAuth-only user -- from accountsTable
    expect(result[1].email).toBe('oauth-user@google.com');
    expect(result[1].name).toBe('oauth-user@google.com');

    // Both tables -- usersTable wins
    expect(result[2].email).toBe('fresh@example.com');
    expect(result[2].name).toBe('Fresh Name');

    // Neither table -- userId fallback
    expect(result[3].email).toBe('user-neither');
    expect(result[3].name).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Edge: user in usersTable with null name
  // -----------------------------------------------------------------------
  it('falls back to account_name when usersTable name is null', () => {
    const members: OrgMember[] = [
      { id: 'mem-5', userId: 'user-noname', role: 'member', joinedAt: now },
    ];
    const accounts: AccountRow[] = [
      { userId: 'user-noname', account_name: 'Provider Name' },
    ];
    const users: UserRow[] = [
      { id: 'user-noname', email: 'noname@example.com', name: null },
    ];

    const result = mapMembersWithDetails(members, accounts, users);

    expect(result[0].email).toBe('noname@example.com');
    // name is null in usersTable, so it should fall back to account_name
    expect(result[0].name).toBe('Provider Name');
  });

  // -----------------------------------------------------------------------
  // Edge: empty members list
  // -----------------------------------------------------------------------
  it('returns empty array when there are no members', () => {
    const result = mapMembersWithDetails([], [], []);
    expect(result).toEqual([]);
  });
});
