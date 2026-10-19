import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer, STREMIO_API } from "../helpers/stremio-msw";
import { syncAddon, storeAuthKey, readAuthKey } from "../../src/lib/stremio-sync";

const MANIFEST_URL = "https://api.example.test/stremio/user-1/manifest.json";

beforeAll(() => mswServer.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  mswServer.resetHandlers();
  localStorage.clear();
});
afterAll(() => mswServer.close());

function makeCollection() {
  return [
    { transportUrl: "https://other.test/manifest.json", manifest: { id: "other" }, flags: { official: true } },
    { transportUrl: MANIFEST_URL, manifest: { id: "ours", catalogs: ["old"] }, flags: { protected: false } },
    { transportUrl: "https://third.test/manifest.json", manifest: { id: "third" }, flags: {} },
  ];
}

describe("syncAddon", () => {
  it("replaces only our manifest and keeps every other entry and its position", async () => {
    let body: { authKey?: string; addons?: unknown[] } | null = null;

    mswServer.use(
      http.post(`${STREMIO_API}/addonCollectionGet`, () =>
        HttpResponse.json({ result: { addons: makeCollection(), lastModified: "2026-09-10T00:00:00Z" } }),
      ),
      http.get(MANIFEST_URL, () =>
        HttpResponse.json({ id: "ours", catalogs: ["new"] }),
      ),
      http.post(`${STREMIO_API}/addonCollectionSet`, async ({ request }) => {
        body = (await request.json()) as { authKey?: string; addons?: unknown[] };
        return HttpResponse.json({ result: { success: true } });
      }),
    );

    const result = await syncAddon("auth-123", MANIFEST_URL);

    expect(result).toBe("synced");
    expect(body).not.toBeNull();
    expect(body!.authKey).toBe("auth-123");
    expect(body!.addons).toHaveLength(3);
    expect(body!.addons![1]).toEqual({
      transportUrl: MANIFEST_URL,
      manifest: { id: "ours", catalogs: ["new"] },
      flags: { protected: false },
    });
    expect(body!.addons![0]).toEqual(makeCollection()[0]);
    expect(body!.addons![2]).toEqual(makeCollection()[2]);
  });

  it("never writes when the collection comes back empty", async () => {
    let setCalled = false;

    mswServer.use(
      http.post(`${STREMIO_API}/addonCollectionGet`, () =>
        HttpResponse.json({ result: { addons: [], lastModified: "2026-09-10T00:00:00Z" } }),
      ),
      http.post(`${STREMIO_API}/addonCollectionSet`, () => {
        setCalled = true;
        return HttpResponse.json({ result: { success: true } });
      }),
    );

    await expect(syncAddon("auth-123", MANIFEST_URL)).rejects.toThrow();
    expect(setCalled).toBe(false);
  });

  it("never writes when reading the collection fails", async () => {
    let setCalled = false;

    mswServer.use(
      http.post(`${STREMIO_API}/addonCollectionGet`, () =>
        HttpResponse.json({ error: { message: "Server error", code: 500 } }),
      ),
      http.post(`${STREMIO_API}/addonCollectionSet`, () => {
        setCalled = true;
        return HttpResponse.json({ result: { success: true } });
      }),
    );

    await expect(syncAddon("auth-123", MANIFEST_URL)).rejects.toThrow("Server error");
    expect(setCalled).toBe(false);
  });

  it("returns not-installed and writes nothing when our addon is absent", async () => {
    let setCalled = false;

    mswServer.use(
      http.post(`${STREMIO_API}/addonCollectionGet`, () =>
        HttpResponse.json({
          result: {
            addons: [{ transportUrl: "https://other.test/manifest.json", manifest: { id: "other" }, flags: {} }],
            lastModified: "2026-09-10T00:00:00Z",
          },
        }),
      ),
      http.post(`${STREMIO_API}/addonCollectionSet`, () => {
        setCalled = true;
        return HttpResponse.json({ result: { success: true } });
      }),
    );

    const result = await syncAddon("auth-123", MANIFEST_URL);

    expect(result).toBe("not-installed");
    expect(setCalled).toBe(false);
  });

  it("never writes when the fetched manifest is not a valid manifest", async () => {
    let setCalled = false;

    mswServer.use(
      http.post(`${STREMIO_API}/addonCollectionGet`, () =>
        HttpResponse.json({ result: { addons: makeCollection(), lastModified: "2026-09-10T00:00:00Z" } }),
      ),
      http.get(MANIFEST_URL, () => HttpResponse.json(null)),
      http.post(`${STREMIO_API}/addonCollectionSet`, () => {
        setCalled = true;
        return HttpResponse.json({ result: { success: true } });
      }),
    );

    await expect(syncAddon("auth-123", MANIFEST_URL)).rejects.toThrow();
    expect(setCalled).toBe(false);
  });

  it("returns unauthorized and clears the stored key on an auth error", async () => {
    storeAuthKey("auth-123");

    mswServer.use(
      http.post(`${STREMIO_API}/addonCollectionGet`, () =>
        HttpResponse.json({ error: { message: "User not logged in", code: 1 } }),
      ),
    );

    const result = await syncAddon("auth-123", MANIFEST_URL);

    expect(result).toBe("unauthorized");
    expect(readAuthKey()).toBeNull();
  });
});
