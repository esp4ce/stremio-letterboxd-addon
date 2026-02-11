import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authenticateWithPassword,
  getCurrentUser,
  searchFilms,
  LetterboxdApiError,
} from '../../src/modules/letterboxd/letterboxd.client.js';
import {
  createMockFetch,
  mockTokenResponse,
  mockUser,
  mockFilm,
} from '../mocks/letterboxd.mock.js';

describe('letterboxd client', () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockFetch = createMockFetch();
    vi.stubGlobal('fetch', mockFetch);
  });

  describe('authenticateWithPassword', () => {
    it('should authenticate with correct credentials', async () => {
      const result = await authenticateWithPassword('testuser', 'password123');

      expect(result).toEqual(mockTokenResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/token');
      expect(options.method).toBe('POST');
      expect(options.headers).toHaveProperty(
        'Content-Type',
        'application/x-www-form-urlencoded'
      );
      expect(options.headers).not.toHaveProperty('Authorization');
    });

    it('should include client credentials in body', async () => {
      await authenticateWithPassword('testuser', 'password123');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = options.body as string;

      expect(body).toContain('grant_type=password');
      expect(body).toContain('username=testuser');
      expect(body).toContain('password=password123');
      expect(body).toContain('client_id=');
      expect(body).toContain('client_secret=');
    });

    it('should throw LetterboxdApiError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid credentials' }),
      });

      await expect(
        authenticateWithPassword('wrong', 'credentials')
      ).rejects.toThrow(LetterboxdApiError);
    });
  });

  describe('getCurrentUser', () => {
    it('should fetch current user with bearer token', async () => {
      const result = await getCurrentUser('access-token-123');

      expect(result).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/me');
      expect(options.headers).toHaveProperty(
        'Authorization',
        'Bearer access-token-123'
      );
    });
  });

  describe('searchFilms', () => {
    it('should search films with query', async () => {
      const result = await searchFilms('access-token', 'Test Movie');

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(mockFilm);
    });

    it('should include authorization header', async () => {
      await searchFilms('access-token', 'Test Movie');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.headers).toHaveProperty(
        'Authorization',
        'Bearer access-token'
      );
    });

    it('should include year filter when provided', async () => {
      await searchFilms('access-token', 'Test Movie', { year: 2023 });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('decade=2020s');
    });
  });
});
