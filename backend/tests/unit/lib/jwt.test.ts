import { describe, it, expect, vi, afterEach } from 'vitest';
import { signUserToken, verifyUserToken, signJwtToken, verifyJwtToken } from '../../../src/lib/jwt.js';

describe('jwt (user + dashboard tokens)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('user tokens', () => {
    const payload = {
      userId: 'user-123',
      letterboxdId: 'lbxd-456',
      username: 'testuser',
    };

    it('signs then verifies a user token', async () => {
      const token = await signUserToken(payload);
      const result = await verifyUserToken(token);

      expect(result).not.toBeNull();
      expect(result!.sub).toBe('user-123');
      expect(result!.letterboxdId).toBe('lbxd-456');
      expect(result!.username).toBe('testuser');
    });

    it('rejects expired token', async () => {
      vi.useFakeTimers();
      const token = await signUserToken(payload);

      // Advance past 7d default TTL
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

      const result = await verifyUserToken(token);
      expect(result).toBeNull();
    });

    it('rejects tampered token', async () => {
      const token = await signUserToken(payload);
      // Tamper with the payload portion (middle segment)
      const parts = token.split('.');
      parts[1] = parts[1]!.slice(0, -2) + 'xx';
      const tampered = parts.join('.');

      const result = await verifyUserToken(tampered);
      expect(result).toBeNull();
    });

    it('rejects garbage input', async () => {
      const result = await verifyUserToken('not.a.jwt');
      expect(result).toBeNull();
    });
  });

  describe('generic JWT tokens', () => {
    it('signs then verifies a generic payload', async () => {
      const token = await signJwtToken({ role: 'admin' }, '1h');
      const result = await verifyJwtToken(token);

      expect(result).not.toBeNull();
      expect(result!['role']).toBe('admin');
    });

    it('rejects expired generic token', async () => {
      vi.useFakeTimers();
      const token = await signJwtToken({ role: 'admin' }, '1s');

      vi.advanceTimersByTime(5000);

      const result = await verifyJwtToken(token);
      expect(result).toBeNull();
    });
  });
});
