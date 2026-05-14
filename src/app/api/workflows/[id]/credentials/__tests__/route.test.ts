import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockAuth,
  mockAnalyzeWorkflowCredentials,
  workflowsTable,
  userCredentialsTable,
  eq,
  and,
  isNull,
  ne,
  db,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockAnalyzeWorkflowCredentials: vi.fn(),
  workflowsTable: { __name: 'workflowsTable' },
  userCredentialsTable: { __name: 'userCredentialsTable' },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  ne: vi.fn(),
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === workflowsTable) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 'workflow-1',
                  userId: 'user-1',
                  organizationId: null,
                  trigger: { type: 'manual', config: {} },
                  config: { steps: [] },
                  conversionMetadata: null,
                },
              ]),
            })),
          };
        }

        if (table === userCredentialsTable) {
          return {
            where: vi.fn(() => Promise.resolve([])),
          };
        }

        return { where: vi.fn(() => Promise.resolve([])) };
      }),
    })),
  },
}));

vi.mock('@/lib/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/schema', () => ({ workflowsTable, userCredentialsTable }));
vi.mock('drizzle-orm', () => ({ eq, and, isNull, ne }));
vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn(() => JSON.stringify({ expires_at: 9999999999 })),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/workflows/analyze-credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workflows/analyze-credentials')>(
    '@/lib/workflows/analyze-credentials'
  );
  return {
    ...actual,
    analyzeWorkflowCredentials: mockAnalyzeWorkflowCredentials,
  };
});

import { GET } from '../route';

describe('GET /api/workflows/[id]/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  });

  it('marks api_key analyzer result as connected when OAuth alias exists (google/microsoft variants)', async () => {
    mockAnalyzeWorkflowCredentials.mockReturnValue([
      { platform: 'google-sheets', type: 'api_key', variable: 'user.google-sheets' },
    ]);

    db.select.mockImplementation(() => ({
      from: vi.fn((table: unknown) => {
        if (table === workflowsTable) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 'workflow-1',
                  userId: 'user-1',
                  organizationId: null,
                  trigger: { type: 'manual', config: {} },
                  config: { steps: [{ id: 's1', module: 'data.google_sheets.getRows' }] },
                  conversionMetadata: null,
                },
              ]),
            })),
          };
        }

        if (table === userCredentialsTable) {
          return {
            where: vi.fn(() =>
              Promise.resolve([
                {
                  id: 'cred-oauth-1',
                  platform: 'google_sheets',
                  name: 'me@gmail.com',
                  type: 'oauth',
                  encryptedValue: 'enc',
                  metadata: { connectedEmail: 'me@gmail.com' },
                },
              ])
            ),
          };
        }

        return { where: vi.fn(() => Promise.resolve([])) };
      }),
    }));

    const request = new NextRequest('http://localhost:3123/api/workflows/workflow-1/credentials');
    const response = await GET(request, { params: Promise.resolve({ id: 'workflow-1' }) });

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.credentials).toHaveLength(1);
    expect(json.credentials[0].platform).toBe('google-sheets');
    expect(json.credentials[0].connected).toBe(true);
    expect(json.credentials[0].accounts).toHaveLength(1);
    expect(json.credentials[0].oauthPlatform).toBe('google');
  });

  it('preserves Add Key behavior for true API-key-only providers', async () => {
    mockAnalyzeWorkflowCredentials.mockReturnValue([
      { platform: 'openai', type: 'api_key', variable: 'user.openai' },
    ]);

    db.select.mockImplementation(() => ({
      from: vi.fn((table: unknown) => {
        if (table === workflowsTable) {
          return {
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 'workflow-1',
                  userId: 'user-1',
                  organizationId: null,
                  trigger: { type: 'manual', config: {} },
                  config: { steps: [{ id: 's1', module: 'ai.openai.generateText' }] },
                  conversionMetadata: null,
                },
              ]),
            })),
          };
        }

        if (table === userCredentialsTable) {
          return {
            where: vi.fn(() => Promise.resolve([])),
          };
        }

        return { where: vi.fn(() => Promise.resolve([])) };
      }),
    }));

    const request = new NextRequest('http://localhost:3123/api/workflows/workflow-1/credentials');
    const response = await GET(request, { params: Promise.resolve({ id: 'workflow-1' }) });

    const json = await response.json();
    expect(json.credentials).toHaveLength(1);
    expect(json.credentials[0].platform).toBe('openai');
    expect(json.credentials[0].connected).toBe(false);
    expect(json.credentials[0].keys).toHaveLength(0);
  });
});
