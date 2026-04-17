import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb, getDb } from '../../../src/db/index.js';
import { createUser, findUserById, getDecryptedRefreshToken } from '../../../src/db/repositories/user.repository.js';

describe('user-client service (DB layer)', () => {
  beforeAll(() => {
    initDb();
  });

  afterAll(() => {
    closeDb();
  });

  it('creates a user and encrypts the refresh token', () => {
    const user = createUser({
      letterboxdId: 'uc-test-1',
      letterboxdUsername: 'uctest1',
      refreshToken: 'my-secret-refresh-token',
    });

    expect(user.id).toBeDefined();
    expect(user.encrypted_refresh_token).toBeDefined();
    expect(user.encrypted_refresh_token).not.toBe('my-secret-refresh-token');
  });

  it('decrypts refresh token back to original', () => {
    const user = createUser({
      letterboxdId: 'uc-test-2',
      letterboxdUsername: 'uctest2',
      refreshToken: 'another-secret-token',
    });

    const decrypted = getDecryptedRefreshToken(user);
    expect(decrypted).toBe('another-secret-token');
  });

  it('finds user by ID', () => {
    const created = createUser({
      letterboxdId: 'uc-test-3',
      letterboxdUsername: 'uctest3',
      refreshToken: 'token3',
    });

    const found = findUserById(created.id);
    expect(found).not.toBeNull();
    expect(found!.letterboxd_username).toBe('uctest3');
  });

  it('returns null for nonexistent user', () => {
    const found = findUserById('nonexistent-id');
    expect(found).toBeNull();
  });

  it('throws on decrypt when user has no refresh token (Tier 1)', () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO users (letterboxd_id, letterboxd_username, encrypted_refresh_token, tier) VALUES (?, ?, NULL, 1)"
    ).run('tier1-test', 'tier1user');

    const user = db.prepare("SELECT * FROM users WHERE letterboxd_id = 'tier1-test'").get() as {
      encrypted_refresh_token: string | null;
    };

    expect(() =>
      getDecryptedRefreshToken(user as never)
    ).toThrow('Tier 1');
  });
});
