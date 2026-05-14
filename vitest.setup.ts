import { afterEach, afterAll, vi } from 'vitest';

// Set test environment variables BEFORE any imports
process.env.AUTH_SECRET = 'test-secret-key-for-encryption-minimum-32-chars-long';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Mock DOMMatrix for PDF parsing (browser API not available in Node)
class MockDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;
  is2D = true;
  isIdentity = true;
  inverse() {
    return new MockDOMMatrix();
  }
  multiply() {
    return new MockDOMMatrix();
  }
  translate() {
    return new MockDOMMatrix();
  }
  scale() {
    return new MockDOMMatrix();
  }
  rotate() {
    return new MockDOMMatrix();
  }
  transformPoint() {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  toFloat32Array() {
    return new Float32Array(16);
  }
  toFloat64Array() {
    return new Float64Array(16);
  }
}
(globalThis as unknown as { DOMMatrix: typeof MockDOMMatrix }).DOMMatrix = MockDOMMatrix;

// Mock logger to prevent console spam in tests
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logJobStart: vi.fn(),
  logJobComplete: vi.fn(),
  logJobError: vi.fn(),
}));

// Mock database module to avoid actual DB connections in tests
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue({}),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
  },
}));

// Cleanup runs after each test
afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});

// Cleanup runs after all tests
afterAll(() => {
  // Restore all mocks
  vi.restoreAllMocks();
});
