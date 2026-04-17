import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../../../src/db/index.js';
import { findUserByLetterboxdId } from '../../../../src/db/repositories/user.repository.js';

// Mock the client module before importing the service
vi.mock('../../../../src/modules/letterboxd/letterboxd.client.js', () => {
  class LetterboxdApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'LetterboxdApiError';
      this.status = status;
    }
  }

  class TwoFactorRequiredError extends Error {
    constructor() {
      super('2FA required');
      this.name = 'TwoFactorRequiredError';
    }
  }

  return {
    authenticateWithPassword: vi.fn(),
    getCurrentUser: vi.fn(),
    createAuthenticatedClient: vi.fn(),
    LetterboxdApiError,
    TwoFactorRequiredError,
  };
});

import { loginUser, AuthenticationError } from '../../../../src/modules/auth/auth.service.js';
import {
  authenticateWithPassword,
  getCurrentUser,
  createAuthenticatedClient,
  LetterboxdApiError,
  TwoFactorRequiredError,
} from '../../../../src/modules/letterboxd/letterboxd.client.js';

const mockAuth = vi.mocked(authenticateWithPassword);
const mockGetUser = vi.mocked(getCurrentUser);
const mockCreateClient = vi.mocked(createAuthenticatedClient);

function stubSuccessfulAuth() {
  mockAuth.mockResolvedValue({
    access_token: 'test-access',
    refresh_token: 'test-refresh',
    token_type: 'Bearer',
    expires_in: 3600,
  });

  mockGetUser.mockResolvedValue({
    member: {
      id: 'lbxd-user-1',
      username: 'alice',
      displayName: 'Alice',
    },
  } as never);

  mockCreateClient.mockReturnValue({
    getUserLists: vi.fn().mockResolvedValue({
      items: [{ id: 'list-1', name: 'Favorites', filmCount: 5 }],
    }),
  } as never);
}

describe('auth.service — loginUser', () => {
  beforeEach(() => {
    initDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    closeDb();
  });

  it('returns AuthResult on successful login', async () => {
    stubSuccessfulAuth();

    const result = await loginUser('alice', 'password123');

    expect(result.userToken).toBeDefined();
    expect(result.manifestUrl).toContain('/stremio/');
    expect(result.manifestUrl).toContain('/manifest.json');
    expect(result.user.username).toBe('alice');
    expect(result.user.displayName).toBe('Alice');
    expect(result.lists).toHaveLength(1);
    expect(result.lists[0]!.name).toBe('Favorites');
  });

  it('upserts user in DB on success', async () => {
    stubSuccessfulAuth();

    await loginUser('alice', 'password123');

    const dbUser = findUserByLetterboxdId('lbxd-user-1');
    expect(dbUser).not.toBeNull();
    expect(dbUser!.letterboxd_username).toBe('alice');
  });

  it('throws 2FA_REQUIRED when two-factor is needed', async () => {
    mockAuth.mockRejectedValue(new TwoFactorRequiredError());

    await expect(loginUser('alice', 'password123')).rejects.toThrow(AuthenticationError);
    await expect(loginUser('alice', 'password123')).rejects.toMatchObject({
      code: '2FA_REQUIRED',
    });
  });

  it('throws INVALID_CREDENTIALS on 401 response', async () => {
    mockAuth.mockRejectedValue(new LetterboxdApiError('Unauthorized', 401));

    await expect(loginUser('alice', 'wrong')).rejects.toThrow(AuthenticationError);
    await expect(loginUser('alice', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('throws INVALID_CREDENTIALS on 400 response', async () => {
    mockAuth.mockRejectedValue(new LetterboxdApiError('Bad request', 400));

    await expect(loginUser('alice', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('throws SERVICE_ERROR on unexpected errors', async () => {
    mockAuth.mockRejectedValue(new Error('Network failure'));

    await expect(loginUser('alice', 'password123')).rejects.toThrow(AuthenticationError);
    await expect(loginUser('alice', 'password123')).rejects.toMatchObject({
      code: 'SERVICE_ERROR',
    });
  });

  it('throws PROFILE_ERROR when user profile fetch fails', async () => {
    mockAuth.mockResolvedValue({
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    mockGetUser.mockRejectedValue(new Error('profile fetch failed'));

    await expect(loginUser('alice', 'password123')).rejects.toMatchObject({
      code: 'PROFILE_ERROR',
    });
  });

  it('still succeeds when list fetch fails', async () => {
    stubSuccessfulAuth();
    mockCreateClient.mockReturnValue({
      getUserLists: vi.fn().mockRejectedValue(new Error('lists unavailable')),
    } as never);

    const result = await loginUser('alice', 'password123');

    expect(result.lists).toEqual([]);
    expect(result.userToken).toBeDefined();
  });

  it('forwards totp parameter to authenticateWithPassword', async () => {
    stubSuccessfulAuth();

    await loginUser('alice', 'password123', '123456');

    expect(mockAuth).toHaveBeenCalledWith('alice', 'password123', '123456');
  });
});
