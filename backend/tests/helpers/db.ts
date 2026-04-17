import { createUser, type CreateUserInput, type User } from '../../src/db/repositories/user.repository.js';

let seedCounter = 0;

/** Creates a test user with sensible defaults. Override any field as needed. */
export function seedUser(overrides: Partial<CreateUserInput> = {}): User {
  seedCounter++;
  return createUser({
    letterboxdId: `test-lbxd-${seedCounter}`,
    letterboxdUsername: `testuser${seedCounter}`,
    refreshToken: `fake-refresh-token-${seedCounter}`,
    ...overrides,
  });
}
