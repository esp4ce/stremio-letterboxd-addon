import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { configure } from '@esp4ce/letterboxd-client';

process.env['PORT'] = '3001';
process.env['PUBLIC_URL'] = 'http://localhost:3001';
process.env['LETTERBOXD_CLIENT_ID'] = 'test-client-id';
process.env['LETTERBOXD_CLIENT_SECRET'] = 'test-client-secret';
process.env['LETTERBOXD_USER_AGENT'] = 'TestAgent/1.0.0';
process.env['ENCRYPTION_KEY'] =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env['JWT_SECRET'] = 'test-jwt-secret-that-is-at-least-32-chars';
process.env['JWT_TTL'] = '7d';
process.env['DATABASE_PATH'] = ':memory:';
process.env['CORS_ORIGIN'] = 'http://localhost:3000';
process.env['LOG_LEVEL'] = 'silent';

beforeAll(() => {
  configure({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    userAgent: 'TestAgent/1.0.0',
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});
