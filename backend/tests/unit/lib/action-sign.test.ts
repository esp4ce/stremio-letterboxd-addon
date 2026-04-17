import { describe, it, expect } from 'vitest';
import { signAction, verifyAction } from '../../../src/lib/action-sign.js';

describe('action-sign (HMAC action button signatures)', () => {
  const userId = 'user-123';
  const filmId = 'film-456';
  const action = 'watched';

  it('signs and verifies a valid action', () => {
    const token = signAction(userId, filmId, action);
    const valid = verifyAction(userId, filmId, action, token);

    expect(valid).toBe(true);
  });

  it('produces a 16 hex char token', () => {
    const token = signAction(userId, filmId, action);

    expect(token).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = signAction(userId, filmId, action);
    const b = signAction(userId, filmId, action);

    expect(a).toBe(b);
  });

  it('rejects tampered action', () => {
    const token = signAction(userId, filmId, action);
    const valid = verifyAction(userId, filmId, 'liked', token);

    expect(valid).toBe(false);
  });

  it('rejects tampered userId', () => {
    const token = signAction(userId, filmId, action);
    const valid = verifyAction('other-user', filmId, action, token);

    expect(valid).toBe(false);
  });

  it('rejects tampered filmId', () => {
    const token = signAction(userId, filmId, action);
    const valid = verifyAction(userId, 'other-film', action, token);

    expect(valid).toBe(false);
  });

  it('rejects empty token', () => {
    expect(verifyAction(userId, filmId, action, '')).toBe(false);
  });

  it('rejects wrong-length token', () => {
    expect(verifyAction(userId, filmId, action, 'abc')).toBe(false);
  });

  it('rejects non-hex token of correct length', () => {
    expect(verifyAction(userId, filmId, action, 'zzzzzzzzzzzzzzzz')).toBe(false);
  });
});
