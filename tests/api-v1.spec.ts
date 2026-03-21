/**
 * E2E tests for the LettrSuggest REST API v1
 *
 * Prerequisites:
 *   - Dev server running at http://localhost:3000 (or started via playwright.config.ts)
 *   - TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local for authenticated tests
 *   - Optional: TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD for admin endpoint tests
 *
 * Run: npx playwright test tests/api-v1.spec.ts
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api/v1";

/** Fetch a Supabase JWT using email/password */
async function getJwt(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in test environment");
  }

  const res = await request.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        "Content-Type": "application/json",
      },
      data: { email, password },
    },
  );

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Auth failed (${res.status()}): ${body.slice(0, 200)}`);
  }

  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("No access_token in auth response");
  }

  return body.access_token;
}

/** GET helper returning parsed JSON */
async function apiGet(
  request: APIRequestContext,
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.get(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status(), body };
}

/** POST helper returning parsed JSON */
async function apiPost(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post(`${BASE}${path}`, {
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    data,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status(), body };
}

/** DELETE helper returning parsed JSON */
async function apiDelete(
  request: APIRequestContext,
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.delete(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status(), body };
}

/** Assert standard envelope shape */
function expectEnvelope(body: Record<string, unknown>) {
  expect(body).toHaveProperty("meta");
  expect(body).toHaveProperty("error");
  const meta = body.meta as Record<string, unknown>;
  expect(typeof meta.timestamp).toBe("string");
  expect(typeof meta.requestId).toBe("string");
  expect(meta.requestId).toMatch(/^req_[0-9a-f]+$/);
}

// ---------------------------------------------------------------------------
// Public Endpoints
// ---------------------------------------------------------------------------

test.describe("GET /api/v1/health", () => {
  test("returns 200 with ok status and correct envelope", async ({
    request,
  }) => {
    const { status, body } = await apiGet(request, "/health");
    expect(status).toBe(200);
    expectEnvelope(body);

    expect(body.error).toBeNull();
    const data = body.data as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.version).toBe("v1");
    expect(data.db).toBe("connected");
    expect(typeof data.timestamp).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Authentication Rejection Tests (no credentials required)
// ---------------------------------------------------------------------------

test.describe("Unauthenticated access", () => {
  const protectedRoutes = [
    "/auth/me",
    "/keys",
    "/movies/search?q=inception",
    "/movies/12345",
    "/suggestions",
    "/suggestions/blocked",
    "/suggestions/liked",
    "/profile",
    "/profile/films",
    "/profile/watchlist",
    "/profile/diary",
    "/stats",
  ];

  for (const route of protectedRoutes) {
    test(`GET ${route} → 401 without token`, async ({ request }) => {
      const { status, body } = await apiGet(request, route);
      expect(status).toBe(401);
      expectEnvelope(body);
      expect(body.data).toBeNull();
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("UNAUTHORIZED");
    });
  }

  test("GET /admin/users → 401 without token", async ({ request }) => {
    const { status, body } = await apiGet(request, "/admin/users");
    expect(status).toBe(401);
    expectEnvelope(body);
  });

  test("POST /keys → 401 without token", async ({ request }) => {
    const { status, body } = await apiPost(request, "/keys", {
      key_type: "user",
    });
    expect(status).toBe(401);
    expectEnvelope(body);
  });
});

test.describe("Invalid API key format", () => {
  test("returns 401 for malformed API key", async ({ request }) => {
    const res = await request.get(`${BASE}/auth/me`, {
      headers: { Authorization: "Bearer ls_u_tooshort" },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status()).toBe(401);
    const error = body.error as Record<string, unknown>;
    expect(error.code).toBe("UNAUTHORIZED");
  });

  test("returns 401 for completely invalid token", async ({ request }) => {
    const res = await request.get(`${BASE}/auth/me`, {
      headers: { Authorization: "Bearer definitely-not-a-valid-token" },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Authenticated Tests
// ---------------------------------------------------------------------------

test.describe("Authenticated tests", () => {
  let jwt: string;

  test.beforeAll(async ({ request }) => {
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;

    if (!email || !password) {
      test.skip();
      return;
    }

    jwt = await getJwt(request, email, password);
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  test("GET /auth/me returns user info", async ({ request }) => {
    const { status, body } = await apiGet(request, "/auth/me", jwt);
    expect(status).toBe(200);
    expectEnvelope(body);
    expect(body.error).toBeNull();

    const data = body.data as Record<string, unknown>;
    expect(typeof data.userId).toBe("string");
    expect(typeof data.email).toBe("string");
    expect(["user", "developer", "admin"]).toContain(data.role);
    expect(["user", "developer", "admin"]).toContain(data.keyType);
    expect(typeof data.createdAt).toBe("string");
  });

  // -------------------------------------------------------------------------
  // API Key Management (CRUD flow)
  // -------------------------------------------------------------------------

  test.describe("Key management flow", () => {
    let createdKeyId: string;
    let apiKey: string;

    test("POST /keys creates a new user key with rawKey", async ({
      request,
    }) => {
      const { status, body } = await apiPost(
        request,
        "/keys",
        { key_type: "user", label: "Playwright Test Key" },
        jwt,
      );

      expect(status).toBe(200);
      expectEnvelope(body);
      expect(body.error).toBeNull();

      const data = body.data as Record<string, unknown>;
      expect(typeof data.id).toBe("string");
      expect(typeof data.rawKey).toBe("string");
      expect((data.rawKey as string).startsWith("ls_u_")).toBe(true);
      expect((data.rawKey as string).length).toBe(69);
      expect(data.key_type).toBe("user");
      expect(data.label).toBe("Playwright Test Key");
      expect(data.status).toBe("active");

      createdKeyId = data.id as string;
      apiKey = data.rawKey as string;
    });

    test("GET /keys lists keys including the new one", async ({ request }) => {
      const { status, body } = await apiGet(request, "/keys", jwt);
      expect(status).toBe(200);
      expectEnvelope(body);

      const data = body.data as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);

      const found = data.find((k) => k.id === createdKeyId);
      expect(found).toBeDefined();
      expect(found!.label).toBe("Playwright Test Key");
      expect(found!.rawKey).toBeUndefined(); // rawKey NOT present in list
    });

    test("GET /keys/:id returns key detail", async ({ request }) => {
      const { status, body } = await apiGet(
        request,
        `/keys/${createdKeyId}`,
        jwt,
      );
      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(data.id).toBe(createdKeyId);
      expect(data.rawKey).toBeUndefined();
    });

    test("Can use rawKey to authenticate — GET /auth/me", async ({
      request,
    }) => {
      const { status, body } = await apiGet(request, "/auth/me", apiKey);
      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(typeof data.userId).toBe("string");
    });

    test("Rate limit headers present when using API key", async ({
      request,
    }) => {
      const res = await request.get(`${BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["x-ratelimit-limit"]).toBeTruthy();
      expect(res.headers()["x-ratelimit-remaining"]).toBeTruthy();
      expect(res.headers()["x-ratelimit-reset"]).toBeTruthy();
    });

    test("DELETE /keys/:id revokes the key", async ({ request }) => {
      const { status, body } = await apiDelete(
        request,
        `/keys/${createdKeyId}`,
        jwt,
      );
      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(data.revoked).toBe(true);
    });

    test("Revoked key can no longer authenticate", async ({ request }) => {
      const { status } = await apiGet(request, "/auth/me", apiKey);
      expect(status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Movie Endpoints
  // -------------------------------------------------------------------------

  test.describe("Movies", () => {
    test("GET /movies/search returns paginated results for valid query", async ({
      request,
    }) => {
      const { status, body } = await apiGet(
        request,
        "/movies/search?q=inception",
        jwt,
      );
      expect(status).toBe(200);
      expectEnvelope(body);
      expect(body.error).toBeNull();

      const data = body.data as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      const meta = body.meta as Record<string, unknown>;
      const pagination = meta.pagination as Record<string, unknown>;
      expect(typeof pagination.total).toBe("number");
      expect(pagination.page).toBe(1);
    });

    test("GET /movies/search returns 400 for missing q", async ({
      request,
    }) => {
      const { status, body } = await apiGet(request, "/movies/search", jwt);
      expect(status).toBe(400);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("BAD_REQUEST");
    });

    test("GET /movies/:tmdbId returns movie detail for valid ID", async ({
      request,
    }) => {
      // 27205 = Inception
      const { status, body } = await apiGet(request, "/movies/27205", jwt);
      expect(status).toBe(200);
      expectEnvelope(body);

      const data = body.data as Record<string, unknown>;
      expect(data.id).toBe(27205);
      expect(data.title).toBe("Inception");
    });

    test("GET /movies/:tmdbId returns 404 for non-existent movie", async ({
      request,
    }) => {
      const { status, body } = await apiGet(request, "/movies/999999999", jwt);
      expect([404, 502]).toContain(status); // TMDB may return 404 or error
      expect(body.error).not.toBeNull();
    });

    test("GET /movies/0 returns 400 for invalid ID", async ({ request }) => {
      const { status, body } = await apiGet(request, "/movies/0", jwt);
      expect(status).toBe(400);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("BAD_REQUEST");
    });
  });

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  test.describe("Suggestions", () => {
    test("GET /suggestions returns paginated list", async ({ request }) => {
      const { status, body } = await apiGet(request, "/suggestions", jwt);
      expect(status).toBe(200);
      expectEnvelope(body);
      expect(Array.isArray(body.data)).toBe(true);

      const meta = body.meta as Record<string, unknown>;
      expect(meta.pagination).toBeDefined();
    });

    test("GET /suggestions/blocked returns list", async ({ request }) => {
      const { status, body } = await apiGet(
        request,
        "/suggestions/blocked",
        jwt,
      );
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    test("GET /suggestions/liked returns list", async ({ request }) => {
      const { status, body } = await apiGet(request, "/suggestions/liked", jwt);
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    test.describe("Blocked suggestions CRUD", () => {
      const testTmdbId = 99999901; // unlikely to clash

      test("POST /suggestions/blocked blocks a movie", async ({ request }) => {
        const { status, body } = await apiPost(
          request,
          "/suggestions/blocked",
          {
            tmdb_id: testTmdbId,
            title: "Playwright Test Movie",
            year: "2026",
          },
          jwt,
        );
        expect(status).toBe(200);
        const data = body.data as Record<string, unknown>;
        expect(data.blocked).toBe(true);
        expect(data.tmdb_id).toBe(testTmdbId);
      });

      test("POST /suggestions/blocked is idempotent", async ({ request }) => {
        const { status } = await apiPost(
          request,
          "/suggestions/blocked",
          {
            tmdb_id: testTmdbId,
            title: "Playwright Test Movie",
          },
          jwt,
        );
        expect(status).toBe(200);
      });

      test("DELETE /suggestions/blocked/:id unblocks a movie", async ({
        request,
      }) => {
        const { status, body } = await apiDelete(
          request,
          `/suggestions/blocked/${testTmdbId}`,
          jwt,
        );
        expect(status).toBe(200);
        const data = body.data as Record<string, unknown>;
        expect(data.unblocked).toBe(true);
      });
    });

    test.describe("Liked suggestions CRUD", () => {
      const testTmdbId = 99999902;
      let likedId: string;

      test("POST /suggestions/liked likes a movie", async ({ request }) => {
        // Clean up first (in case prior run left it)
        await request.delete(`${BASE}/suggestions/liked/${likedId}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });

        const { status, body } = await apiPost(
          request,
          "/suggestions/liked",
          {
            tmdb_id: testTmdbId,
            title: "Playwright Test Movie Liked",
            year: "2026",
          },
          jwt,
        );

        if (status === 409) {
          // Already exists from a previous partial run — find and delete
          const listRes = await apiGet(request, "/suggestions/liked", jwt);
          const list = listRes.body.data as Array<Record<string, unknown>>;
          const existing = list.find((item) => item.tmdb_id === testTmdbId);
          if (existing) likedId = existing.id as string;
          return;
        }

        expect(status).toBe(200);
        const data = body.data as Record<string, unknown>;
        expect(data.tmdb_id).toBe(testTmdbId);
        likedId = data.id as string;
      });

      test("DELETE /suggestions/liked/:id removes liked movie", async ({
        request,
      }) => {
        if (!likedId) test.skip();
        const { status, body } = await apiDelete(
          request,
          `/suggestions/liked/${likedId}`,
          jwt,
        );
        expect(status).toBe(200);
        const data = body.data as Record<string, unknown>;
        expect(data.unliked).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  test.describe("Profile", () => {
    test("GET /profile returns profile and stats", async ({ request }) => {
      const { status, body } = await apiGet(request, "/profile", jwt);
      expect(status).toBe(200);
      expectEnvelope(body);

      const data = body.data as Record<string, unknown>;
      expect(data.profile).toBeDefined();
      expect(data.stats).toBeDefined();

      const profile = data.profile as Record<string, unknown>;
      expect(typeof profile.id).toBe("string");

      const stats = data.stats as Record<string, unknown>;
      expect(typeof stats.filmCount).toBe("number");
      expect(Array.isArray(stats.topGenres)).toBe(true);
    });

    test("GET /profile/films returns paginated films", async ({ request }) => {
      const { status, body } = await apiGet(request, "/profile/films", jwt);
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      const meta = body.meta as Record<string, unknown>;
      expect(meta.pagination).toBeDefined();
    });

    test("GET /profile/watchlist returns watchlist items", async ({
      request,
    }) => {
      const { status, body } = await apiGet(request, "/profile/watchlist", jwt);
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    test("GET /profile/diary returns diary entries", async ({ request }) => {
      const { status, body } = await apiGet(request, "/profile/diary", jwt);
      expect(status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  test.describe("Stats", () => {
    test("GET /stats returns film and exploration stats", async ({
      request,
    }) => {
      const { status, body } = await apiGet(request, "/stats", jwt);
      expect(status).toBe(200);
      expectEnvelope(body);

      const data = body.data as Record<string, unknown>;
      expect(data.filmStats).toBeDefined();

      const filmStats = data.filmStats as Record<string, unknown>;
      expect(typeof filmStats.total_films).toBe("number");
      expect(typeof filmStats.total_rated).toBe("number");
      expect(typeof filmStats.avg_rating).toBe("number");
      expect(typeof filmStats.total_liked).toBe("number");
      expect(typeof filmStats.on_watchlist).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // Admin tests (requires TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD)
  // -------------------------------------------------------------------------

  test.describe("Admin endpoints", () => {
    let adminJwt: string;

    test.beforeAll(async ({ request }) => {
      const email = process.env.TEST_ADMIN_EMAIL;
      const password = process.env.TEST_ADMIN_PASSWORD;

      if (!email || !password) {
        test.skip();
        return;
      }

      adminJwt = await getJwt(request, email, password);
    });

    test("Regular user gets 403 on admin endpoints", async ({ request }) => {
      const { status, body } = await apiGet(request, "/admin/users", jwt);
      // Could be 403 (forbidden) if user role != admin, or 401 if key type != admin
      expect([401, 403]).toContain(status);
      expect(body.error).not.toBeNull();
    });

    test("GET /admin/users returns paginated user list", async ({
      request,
    }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiGet(request, "/admin/users", adminJwt);
      expect(status).toBe(200);
      expectEnvelope(body);

      const data = body.data as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        const user = data[0];
        expect(typeof user.id).toBe("string");
        expect(typeof user.email).toBe("string");
        expect(["user", "developer", "admin"]).toContain(user.role);
      }
    });

    test("GET /admin/users?q=filter returns filtered results", async ({
      request,
    }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiGet(
        request,
        "/admin/users?q=@",
        adminJwt,
      );
      expect(status).toBe(200);
      const data = body.data as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      // All results should contain @ in email
      for (const user of data) {
        expect((user.email as string).includes("@")).toBe(true);
      }
    });

    test("GET /admin/cache returns cache table stats", async ({ request }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiGet(request, "/admin/cache", adminJwt);
      expect(status).toBe(200);

      const data = body.data as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      for (const table of data) {
        expect(typeof table.name).toBe("string");
        expect(typeof table.count).toBe("number");
        expect(typeof table.expiredCount).toBe("number");
      }
    });

    test("GET /admin/diagnostics returns system overview", async ({
      request,
    }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiGet(
        request,
        "/admin/diagnostics",
        adminJwt,
      );
      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(data.db).toBe("ok");
      expect(typeof data.timestamp).toBe("string");

      const stats = data.stats as Record<string, unknown>;
      expect(typeof stats.totalUsers).toBe("number");
      expect(typeof stats.activeKeys).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // Webhooks (requires admin)
  // -------------------------------------------------------------------------

  test.describe("Webhooks", () => {
    let adminJwt: string;
    let webhookId: string;

    test.beforeAll(async ({ request }) => {
      const email = process.env.TEST_ADMIN_EMAIL;
      const password = process.env.TEST_ADMIN_PASSWORD;

      if (!email || !password) {
        test.skip();
        return;
      }

      adminJwt = await getJwt(request, email, password);
    });

    test("POST /webhooks creates a webhook with secret shown once", async ({
      request,
    }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiPost(
        request,
        "/webhooks",
        {
          url: "https://example.com/webhook-test",
          events: ["import.completed"],
          active: true,
        },
        adminJwt,
      );

      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(typeof data.id).toBe("string");
      expect(typeof data.secret).toBe("string");
      expect((data.secret as string).length).toBeGreaterThan(0);
      expect(data.url).toBe("https://example.com/webhook-test");
      expect(data.active).toBe(true);

      webhookId = data.id as string;
    });

    test("GET /webhooks lists webhooks (no secret)", async ({ request }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiGet(request, "/webhooks", adminJwt);
      expect(status).toBe(200);

      const data = body.data as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);

      for (const webhook of data) {
        expect(webhook.secret).toBeUndefined();
      }
    });

    test("GET /webhooks/:id returns detail without secret", async ({
      request,
    }) => {
      if (!adminJwt || !webhookId) test.skip();
      const { status, body } = await apiGet(
        request,
        `/webhooks/${webhookId}`,
        adminJwt,
      );
      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(data.id).toBe(webhookId);
      expect(data.secret).toBeUndefined();
    });

    test("POST /webhooks returns 400 for non-HTTPS URL", async ({
      request,
    }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiPost(
        request,
        "/webhooks",
        {
          url: "http://example.com/insecure",
          events: ["import.completed"],
        },
        adminJwt,
      );
      expect(status).toBe(400);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("BAD_REQUEST");
    });

    test("POST /webhooks returns 400 for invalid event type", async ({
      request,
    }) => {
      if (!adminJwt) test.skip();
      const { status, body } = await apiPost(
        request,
        "/webhooks",
        {
          url: "https://example.com/webhook",
          events: ["not.a.real.event"],
        },
        adminJwt,
      );
      expect(status).toBe(400);
      const error = body.error as Record<string, unknown>;
      expect(error.code).toBe("BAD_REQUEST");
    });

    test("DELETE /webhooks/:id removes the webhook", async ({ request }) => {
      if (!adminJwt || !webhookId) test.skip();
      const { status, body } = await apiDelete(
        request,
        `/webhooks/${webhookId}`,
        adminJwt,
      );
      expect(status).toBe(200);
      const data = body.data as Record<string, unknown>;
      expect(data.deleted).toBe(true);
    });

    test("GET /webhooks/:id returns 404 after deletion", async ({
      request,
    }) => {
      if (!adminJwt || !webhookId) test.skip();
      const { status } = await apiGet(
        request,
        `/webhooks/${webhookId}`,
        adminJwt,
      );
      expect(status).toBe(404);
    });
  });
});
