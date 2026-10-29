import posthog from "posthog-js";

/**
 * Typed funnel events. The list is closed on purpose: every event and every
 * property is declared here, and properties are limited to enums, booleans
 * and counters. Never add a username, email, token, user id or any config
 * content. Page views (landing, /configure, /pricing) are already covered by
 * the automatic $pageview, so they are not duplicated here.
 */
export interface AnalyticsEvents {
  landing_cta_clicked: { target: "configure" | "pricing" | "faq" };
  configure_mode_chosen: { mode: "public" | "full" };
  login_succeeded: { method: "password" | "totp"; entitled: boolean; remember_me: boolean };
  install_clicked: { mode: "public" | "full"; reinstall: boolean };
  pricing_subscribe_clicked: { offer: "supporter" | "founder" };
  checkout_opened: Record<never, never>;
  checkout_failed: { reason: "not_logged_in" | "sold_out" | "error" };
  checkout_completed: Record<never, never>;
  checkout_returned: Record<never, never>;
  checkout_confirmed: { entitled: boolean };
  supporter_reason_answered: { reason: "auto_log" | "auto_sync" | "stay_signed_in" | "support_project" | "other" };
  native_sync_enabled_from_checkout: Record<never, never>;
  liked_list_added: Record<never, never>;
  liked_lists_blocked: Record<never, never>;
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * Sends an event to PostHog. A no-op when PostHog is not initialised (no
 * project token, SSR, or called before the provider effect ran) and never
 * throws: analytics must not break a user flow.
 */
export function track<E extends AnalyticsEventName>(
  event: E,
  ...args: keyof AnalyticsEvents[E] extends never ? [] : [properties: AnalyticsEvents[E]]
): void {
  try {
    if (typeof window === "undefined" || !posthog.__loaded) return;
    posthog.capture(event, args[0]);
  } catch {
    // swallow: never let telemetry surface as a user-facing error
  }
}
