import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer, STREMIO_API } from "../helpers/stremio-msw";
import { getStremioAccountLocale } from "../../src/lib/stremio-sync";

beforeAll(() => mswServer.listen({ onUnhandledFrame: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

describe("getStremioAccountLocale", () => {
  it("reads the locale stored on the Stremio account", async () => {
    let body: { authKey?: string } | null = null;
    mswServer.use(
      http.post(`${STREMIO_API}/getUser`, async ({ request }) => {
        body = (await request.json()) as { authKey?: string };
        return HttpResponse.json({ result: { _id: "u1", lang: "fr-FR" } });
      }),
    );

    expect(await getStremioAccountLocale("auth-123")).toBe("fr-FR");
    expect(body!.authKey).toBe("auth-123");
  });

  it("returns undefined when Stremio refuses or fails, never throwing", async () => {
    mswServer.use(http.post(`${STREMIO_API}/getUser`, () => HttpResponse.json({ error: { code: 1, message: "Session not found" } })));
    expect(await getStremioAccountLocale("stale")).toBeUndefined();

    mswServer.use(http.post(`${STREMIO_API}/getUser`, () => new HttpResponse(null, { status: 500 })));
    expect(await getStremioAccountLocale("auth-123")).toBeUndefined();
  });
});
