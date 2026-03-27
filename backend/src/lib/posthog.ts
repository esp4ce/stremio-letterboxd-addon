import { PostHog } from 'posthog-node';
import { config } from '../config/index.js';

const client = config.POSTHOG_API_KEY
  ? new PostHog(config.POSTHOG_API_KEY, { host: config.POSTHOG_HOST })
  : null;

export function capture(event: string, distinctId?: string, properties?: Record<string, unknown>): void {
  if (!client) return;
  client.capture({
    distinctId: distinctId ?? 'anonymous',
    event,
    properties,
  });
}

export async function shutdownPosthog(): Promise<void> {
  await client?.shutdown();
}
