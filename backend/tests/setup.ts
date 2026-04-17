// Vitest global setup
process.env['LOG_LEVEL'] = 'silent';

// Minimal env vars required by config/env.schema.ts
// These are test-only values — never used against real services
process.env['CATALOG_CLIENT_ID'] = 'test-client-id';
process.env['CATALOG_CLIENT_SECRET'] = 'test-client-secret';
process.env['ENCRYPTION_KEY'] = 'a'.repeat(64); // 64 hex chars = 32 bytes
process.env['JWT_SECRET'] = 'test-jwt-secret-must-be-at-least-32-chars-long';
process.env['DASHBOARD_PASSWORD'] = 'test-dashboard-password';
process.env['DATABASE_PATH'] = ':memory:';
process.env['PUBLIC_URL'] = 'http://localhost:3001';
