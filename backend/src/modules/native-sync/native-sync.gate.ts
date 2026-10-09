import { getEntitlement } from '../billing/billing.service.js';
import type { UserPreferences } from '../../db/repositories/user.repository.js';

/** Opt-in first: members who never turned it on cost no Polar call. Fails closed. */
export async function isNativeSyncActive(userId: string, preferences: UserPreferences | null): Promise<boolean> {
  if (preferences?.nativeSync !== true) return false;
  return getEntitlement(userId);
}
