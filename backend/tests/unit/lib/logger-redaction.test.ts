import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { redactPaths } from '../../../src/lib/logger.js';

const EMAIL = 'someone@example.com';
const SECRET = 'super-secret-value';

/** Log a payload through a pino instance using the production redact config. */
function logLine(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const stream = { write: (chunk: string) => void lines.push(chunk) };
  const log = pino({ level: 'info', redact: { paths: redactPaths, censor: '[REDACTED]' } }, stream);
  log.info(payload, 'test');
  return lines.join('');
}

describe('logger redaction', () => {
  it('redacts an email nested one level deep (whole-object logging)', () => {
    const out = logLine({ result: { member: { id: 'm1', username: 'u' }, emailAddress: EMAIL } });
    expect(out).not.toContain(EMAIL);
  });

  it('redacts an email on a differently named wrapper object', () => {
    const out = logLine({ letterboxdUser: { member: { id: 'm1' }, emailAddress: EMAIL } });
    expect(out).not.toContain(EMAIL);
  });

  it('redacts a top-level email', () => {
    const out = logLine({ emailAddress: EMAIL });
    expect(out).not.toContain(EMAIL);
  });

  it('redacts tokens nested under a wrapper object', () => {
    const out = logLine({ tokens: { access_token: SECRET, refresh_token: SECRET } });
    expect(out).not.toContain(SECRET);
  });

  it('redacts an upstream response body carried on an error', () => {
    const out = logLine({ err: { message: 'boom', body: `{"emailAddress":"${EMAIL}"}` } });
    expect(out).not.toContain(EMAIL);
  });

  it('keeps non-sensitive fields readable', () => {
    const out = logLine({ userId: 'abc123', statusCode: 200 });
    expect(out).toContain('abc123');
    expect(out).toContain('200');
  });
});
