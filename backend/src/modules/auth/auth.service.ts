import {
  authenticateWithPassword,
  getCurrentUser,
  createAuthenticatedClient,
  LetterboxdApiError,
  TwoFactorRequiredError,
} from '../letterboxd/letterboxd.client.js';
import {
  upsertUser,
  getUserPreferences,
  type UserPreferences,
} from '../../db/repositories/user.repository.js';
import { signUserToken } from '../../lib/jwt.js';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { ENTITLED_SESSION_TTL_SECONDS } from '../../lib/entitlement.js';
import { getEntitlement } from '../billing/billing.service.js';

const logger = createChildLogger('auth-service');

export interface AuthResult {
  userToken?: string; // present only when the session isn't persisted server-side (see below)
  entitled: boolean;
  persisted: boolean; // entitled AND the user opted into a persistent session

  manifestUrl: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
  };
  lists: Array<{
    id: string;
    name: string;
    filmCount: number;
    description?: string;
  }>;
  preferences: UserPreferences | null;
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export async function loginUser(
  username: string,
  password: string,
  totp?: string,
  rememberMe = true
): Promise<AuthResult> {
  logger.info({ username, has2fa: !!totp }, 'Login attempt');

  let tokens;
  try {
    tokens = await authenticateWithPassword(username, password, totp);
  } catch (error) {
    if (error instanceof TwoFactorRequiredError) {
      throw new AuthenticationError(
        '2FA required',
        '2FA_REQUIRED'
      );
    }
    if (error instanceof LetterboxdApiError) {
      if (error.status === 401 || error.status === 400) {
        logger.warn({ username }, 'Invalid credentials');
        throw new AuthenticationError(
          'Invalid username or password',
          'INVALID_CREDENTIALS'
        );
      }
    }
    logger.error({ err: error, username }, 'Authentication failed');
    throw new AuthenticationError(
      'Authentication service unavailable',
      'SERVICE_ERROR'
    );
  }

  let letterboxdUser;
  try {
    letterboxdUser = await getCurrentUser(tokens.access_token);
    logger.info({ letterboxdId: letterboxdUser.member.id }, 'Letterboxd user profile received');
  } catch (error) {
    logger.error({ err: error, username }, 'Failed to fetch user profile');
    throw new AuthenticationError(
      'Failed to fetch user profile',
      'PROFILE_ERROR'
    );
  }

  const user = upsertUser({
    letterboxdId: letterboxdUser.member.id,
    letterboxdUsername: letterboxdUser.member.username,
    letterboxdDisplayName: letterboxdUser.member.displayName,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  });

  // A login is rare and decides the cookie TTL, so always ask Polar.
  const entitled = await getEntitlement(user.id, { fresh: true });
  // Entitlement unlocks a persistent cookie; the user still has to opt in.
  const persisted = entitled && rememberMe;

  const signedToken = await signUserToken(
    {
      userId: user.id,
      letterboxdId: user.letterboxd_id,
      username: user.letterboxd_username,
    },
    persisted ? ENTITLED_SESSION_TTL_SECONDS : undefined
  );

  let lists: AuthResult['lists'] = [];
  try {
    const client = createAuthenticatedClient(
      tokens.access_token,
      tokens.refresh_token,
      letterboxdUser.member.id
    );
    const listsResponse = await client.getUserLists({ perPage: 50 });
    lists = listsResponse.items.map((l) => ({
      id: l.id,
      name: l.name,
      filmCount: l.filmCount,
      ...(l.description ? { description: l.description } : {}),
    }));
  } catch (error) {
    logger.warn({ err: error, username }, 'Failed to fetch user lists during login');
  }

  const preferences = getUserPreferences(user);

  const manifestUrl = `${config.PUBLIC_URL}/stremio/${user.id}/manifest.json`;

  logger.info(
    { username, letterboxdId: letterboxdUser.member.id },
    'Login successful'
  );

  return {
    userToken: persisted ? undefined : signedToken,
    entitled,
    persisted,
    manifestUrl,
    user: {
      id: user.id,
      username: user.letterboxd_username,
      displayName: user.letterboxd_display_name,
    },
    lists,
    preferences,
    // Internal field, stripped by the route before the response is sent —
    // see auth.routes.ts. Needed there to set the cookie for entitled users.
    _cookieToken: signedToken,
  } as AuthResult & { _cookieToken: string };
}
