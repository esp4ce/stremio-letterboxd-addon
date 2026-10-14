import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.fn();
const state = { loaded: true };

vi.mock("posthog-js", () => ({
  default: {
    get __loaded() {
      return state.loaded;
    },
    capture: (...a: unknown[]) => capture(...a),
  },
}));

import { track } from "../../src/lib/analytics";

describe("track", () => {
  beforeEach(() => {
    capture.mockReset();
    state.loaded = true;
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  });

  it("captures the event with its properties when PostHog is loaded", () => {
    track("configure_mode_chosen", { mode: "full" });
    expect(capture).toHaveBeenCalledWith("configure_mode_chosen", { mode: "full" });
  });

  it("captures property-less events without properties", () => {
    track("checkout_completed");
    expect(capture).toHaveBeenCalledWith("checkout_completed", undefined);
  });

  it("is a no-op when PostHog is not initialised", () => {
    state.loaded = false;
    track("checkout_opened");
    expect(capture).not.toHaveBeenCalled();
  });

  it("is a no-op without a window (SSR)", () => {
    Reflect.deleteProperty(globalThis, "window");
    track("checkout_opened");
    expect(capture).not.toHaveBeenCalled();
  });

  it("never throws when capture fails", () => {
    capture.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => track("checkout_confirmed", { entitled: true })).not.toThrow();
  });
});
