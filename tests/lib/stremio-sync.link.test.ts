import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { mswServer, LINK_API } from "../helpers/stremio-msw";
import { createLinkCode, pollAuthKey } from "../../src/lib/stremio-sync";

beforeAll(() => mswServer.listen({ onUnhandledFrame: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe("createLinkCode", () => {
  it("returns the code, link and qrcode from the API result envelope", async () => {
    mswServer.use(
      http.get(`${LINK_API}/create`, () =>
        HttpResponse.json({
          result: {
            success: true,
            code: "EBZS",
            link: "https://link.stremio.com/EBZS",
            qrcode: "https://link.stremio.com/qr?data=x",
          },
        }),
      ),
    );

    const result = await createLinkCode();

    expect(result).toEqual({
      code: "EBZS",
      link: "https://link.stremio.com/EBZS",
      qrcode: "https://link.stremio.com/qr?data=x",
    });
  });

  it("throws when the API returns an error envelope", async () => {
    mswServer.use(
      http.get(`${LINK_API}/create`, () =>
        HttpResponse.json({ error: { message: "Unknown method", code: 100 } }),
      ),
    );

    await expect(createLinkCode()).rejects.toThrow("Unknown method");
  });
});

describe("pollAuthKey", () => {
  it("keeps polling while the code is not validated, then returns the auth key", async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${LINK_API}/read`, () => {
        calls += 1;
        if (calls < 3) {
          return HttpResponse.json({
            error: { message: "Invalid or expired token", code: 101 },
          });
        }
        return HttpResponse.json({ result: { authKey: "auth-123" } });
      }),
    );

    const controller = new AbortController();
    const key = await pollAuthKey("EBZS", controller.signal, {
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(key).toBe("auth-123");
    expect(calls).toBe(3);
  });

  it("throws once the timeout elapses without validation", async () => {
    mswServer.use(
      http.get(`${LINK_API}/read`, () =>
        HttpResponse.json({ error: { message: "Invalid or expired token", code: 101 } }),
      ),
    );

    const controller = new AbortController();

    await expect(
      pollAuthKey("EBZS", controller.signal, { intervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow("timed out");
  });

  it("stops when the caller aborts", async () => {
    mswServer.use(
      http.get(`${LINK_API}/read`, () =>
        HttpResponse.json({ error: { message: "Invalid or expired token", code: 101 } }),
      ),
    );

    const controller = new AbortController();
    const promise = pollAuthKey("EBZS", controller.signal, {
      intervalMs: 1,
      timeoutMs: 1000,
    });
    controller.abort();

    await expect(promise).rejects.toThrow("aborted");
  });

  it("cancels an in-flight request when the caller aborts mid-poll", async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${LINK_API}/read`, async () => {
        calls += 1;
        await delay(50);
        return HttpResponse.json({
          error: { message: "Invalid or expired token", code: 101 },
        });
      }),
    );

    const controller = new AbortController();
    const promise = pollAuthKey("EBZS", controller.signal, {
      intervalMs: 1,
      timeoutMs: 1000,
    });

    // Let the first request actually start before aborting mid-flight.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    await expect(promise).rejects.toThrow("aborted");
    expect(calls).toBe(1);
  });
});
