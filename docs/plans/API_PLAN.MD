# LettrSuggest API — Implementation Plan

A first-party REST API for LettrSuggest that allows programmatic access to all site functionality. Keys are self-service (managed from the Settings page) and follow industry-standard security practices.

**Primary use-cases:**

- Site administration & diagnostics
- AI agent integration
- Developer tooling / scripting

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [RBAC Role System](#2-rbac-role-system)
3. [API Key Infrastructure](#3-api-key-infrastructure)
4. [API Versioning & Routing](#4-api-versioning--routing)
5. [Authentication & Middleware](#5-authentication--middleware)
6. [Rate Limiting](#6-rate-limiting)
7. [Standard Response Envelope](#7-standard-response-envelope)
8. [Endpoint Catalog](#8-endpoint-catalog)
9. [Webhook System](#9-webhook-system)
10. [Key Management UI](#10-key-management-ui)
11. [Database Migrations](#11-database-migrations)
12. [Security Considerations](#12-security-considerations)
13. [File Manifest](#13-file-manifest)
14. [Verification Plan](#14-verification-plan)

---

## 1. Architecture Overview

```
Client (curl / AI agent / script)
  │
  │  Authorization: Bearer ls_xxxx...
  │
  ▼
┌──────────────────────────────────────┐
│  Next.js API Route: /api/v1/*        │
│  ┌────────────────────────────────┐  │
│  │  apiKeyAuth middleware         │  │
│  │  • Validate key (SHA-256 hash) │  │
│  │  • Resolve user + role         │  │
│  │  • Check permission scope      │  │
│  │  • Enforce rate limit          │  │
│  └────────────────────────────────┘  │
│              │                       │
│  ┌───────────▼───────────────────┐   │
│  │  Route handler                │   │
│  │  • Business logic             │   │
│  │  • Uses supabaseAdmin client  │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
              │
              ▼
        Supabase (DB)
```

The API runs as standard Next.js API routes under `/api/v1/`. A shared middleware layer (`apiKeyAuth`) sits in front of every route, handling:

1. Key extraction from `Authorization: Bearer <key>` header
2. Key validation via SHA-256 hash lookup in `api_keys` table
3. User + role resolution from `user_roles` table
4. Permission scope enforcement (user vs admin endpoints)
5. Rate-limit checking via a sliding-window counter in `api_rate_limits` table

A **service-role Supabase client** (`supabaseAdmin`) is used for API operations to bypass RLS, since the API key auth is handled at the application layer.

---

## 2. RBAC Role System

### Roles

| Role        | Description                              | Can create key types |
|-------------|------------------------------------------|----------------------|
| `user`      | Default for all registered users         | `user`               |
| `developer` | Extended access (future use)             | `user`, `developer`  |
| `admin`     | Full system access                       | `user`, `admin`      |

### Permissions Matrix

| Resource                     | `user` key | `developer` key | `admin` key |
|------------------------------|:----------:|:----------------:|:-----------:|
| Own profile & settings       | ✅          | ✅                | ✅           |
| Own film events & ratings    | ✅          | ✅                | ✅           |
| Own suggestions & feedback   | ✅          | ✅                | ✅           |
| Own taste profile            | ✅          | ✅                | ✅           |
| Own blocked/liked lists      | ✅          | ✅                | ✅           |
| Own watchlist & diary        | ✅          | ✅                | ✅           |
| Own API keys (CRUD)          | ✅          | ✅                | ✅           |
| Search movies (TMDB proxy)   | ✅          | ✅                | ✅           |
| Trigger recommendations      | ✅          | ✅                | ✅           |
| Any user's data (by uid)     | ❌          | ❌                | ✅           |
| System cache management      | ❌          | ❌                | ✅           |
| User management              | ❌          | ❌                | ✅           |
| System diagnostics / health  | ❌          | ❌                | ✅           |
| Webhook management           | ❌          | ❌                | ✅           |
| Role assignments             | ❌          | ❌                | ✅           |

### Database Table: `user_roles`

```sql
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'user'
               CHECK (role IN ('user', 'developer', 'admin')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

> [!NOTE]
> All existing users default to `user` role. Admin roles must be granted manually via Supabase SQL or through the admin API once the first admin is seeded.

---

## 3. API Key Infrastructure

### Key Format

Keys follow a prefixed format for easy identification:

| Key type  | Prefix    | Example                            |
|-----------|-----------|------------------------------------|
| User key  | `ls_u_`   | `ls_u_a1b2c3d4e5f6...` (64 hex)   |
| Admin key | `ls_a_`   | `ls_a_f6e5d4c3b2a1...` (64 hex)   |
| Dev key   | `ls_d_`   | `ls_d_9f8e7d6c5b4a...` (64 hex)   |

- **Raw key** = prefix + 64 hex chars (generated with `crypto.randomBytes(32)`)
- **Stored hash** = SHA-256 of the raw key (the raw key is **never stored**)
- The raw key is shown **once** at creation, then never again

### Key Features

- **Multiple keys per user** — each with a unique label
- **Optional labels** — e.g. "My AI Agent", "Dev Script", "Postman"
- **Optional expiry** — keys can optionally have an expiration date
- **Revocation** — keys can be revoked (soft-deleted) instantly
- **Last-used tracking** — `last_used_at` updated on each request
- **Key preview** — first 8 chars stored as `key_prefix` for identification in UI

### Database Table: `api_keys`

```sql
CREATE TABLE IF NOT EXISTS public.api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,           -- SHA-256 of the raw key
  key_prefix  TEXT NOT NULL,                  -- First 8 chars for display (e.g. "ls_u_a1b2")
  key_type    TEXT NOT NULL DEFAULT 'user'
                CHECK (key_type IN ('user', 'admin', 'developer')),
  label       TEXT,                           -- Optional user-friendly label
  scopes      TEXT[] DEFAULT '{}',            -- Reserved for future fine-grained scopes
  expires_at  TIMESTAMPTZ,                    -- NULL = never expires
  revoked_at  TIMESTAMPTZ,                    -- NULL = active
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_key_prefix CHECK (char_length(key_prefix) >= 6)
);

-- Index for fast hash lookups during auth
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys (key_hash);
-- Index for user's key listing
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys (user_id);
```

### Key Lifecycle

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌─────────┐
│ Created  │───▶│  Active  │───▶│ Expired  │    │ Revoked │
│ (shown   │    │ (in use) │    │ (auto)   │    │ (manual)│
│  once)   │    │          │───▶│          │    │         │
└─────────┘    └──────────┘    └──────────┘    └─────────┘
                    │                              ▲
                    └──────────────────────────────┘
                         (user revokes)
```

---

## 4. API Versioning & Routing

All public API routes live under `/api/v1/`:

```
src/app/api/v1/
├── _lib/
│   ├── apiKeyAuth.ts          # Auth middleware
│   ├── rateLimiter.ts         # Rate limiting logic
│   ├── responseEnvelope.ts    # Standard response helpers
│   └── supabaseAdmin.ts      # Service-role Supabase client
├── auth/
│   └── me/route.ts            # GET — current user info
├── keys/
│   └── route.ts               # GET (list), POST (create)
│   └── [keyId]/route.ts       # GET (detail), DELETE (revoke)
├── movies/
│   ├── search/route.ts        # GET — search movies
│   └── [tmdbId]/route.ts      # GET — movie details
├── suggestions/
│   ├── route.ts               # GET — get recommendations
│   ├── blocked/route.ts       # GET, POST, DELETE 
│   └── liked/route.ts         # GET, POST, DELETE
├── profile/
│   ├── route.ts               # GET — taste profile summary
│   ├── films/route.ts         # GET — film events / ratings
│   ├── watchlist/route.ts     # GET — watchlist
│   └── diary/route.ts         # GET — diary entries
├── stats/route.ts             # GET — user stats
├── webhooks/
│   └── route.ts               # GET, POST, DELETE
├── admin/
│   ├── users/route.ts         # GET — list users (admin only)
│   ├── users/[userId]/route.ts # GET, PATCH — user detail / role
│   ├── cache/route.ts         # GET, POST (refresh)
│   └── diagnostics/route.ts   # GET — system health
└── health/route.ts            # GET — public health check (no auth)
```

> [!IMPORTANT]
> The existing internal routes (`/api/tmdb/`, `/api/trakt/`, etc.) remain unchanged. The `/api/v1/` namespace is entirely separate — it wraps and extends the internal route logic for external consumption with proper auth and response formatting.

---

## 5. Authentication & Middleware

### `apiKeyAuth.ts` — Core Auth Middleware

```typescript
// Pseudocode for the middleware flow
export async function authenticateApiKey(req: Request): Promise<ApiAuthResult> {
  // 1. Extract key from Authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) 
    return { error: 'Missing or invalid Authorization header', status: 401 };
  
  const rawKey = authHeader.slice(7);
  
  // 2. Validate key format (must start with ls_u_, ls_a_, or ls_d_)
  if (!isValidKeyFormat(rawKey))
    return { error: 'Invalid API key format', status: 401 };
  
  // 3. Hash and lookup
  const keyHash = sha256(rawKey);
  const keyRecord = await supabaseAdmin
    .from('api_keys')
    .select('*, user_roles!inner(role)')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();
  
  if (!keyRecord) 
    return { error: 'Invalid or revoked API key', status: 401 };
  
  // 4. Check expiry
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date())
    return { error: 'API key has expired', status: 401 };
  
  // 5. Check rate limit
  const rateLimitResult = await checkRateLimit(keyRecord);
  if (rateLimitResult.exceeded)
    return { error: 'Rate limit exceeded', status: 429, retryAfter: rateLimitResult.retryAfter };
  
  // 6. Update last_used_at (fire-and-forget)
  void supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRecord.id);
  
  // 7. Return auth context
  return {
    userId: keyRecord.user_id,
    keyId: keyRecord.id,
    keyType: keyRecord.key_type,  // 'user' | 'admin' | 'developer'
    userRole: keyRecord.user_roles.role,
    scopes: keyRecord.scopes,
  };
}
```

### Permission Check Helpers

```typescript
export function requireAdmin(auth: ApiAuthContext) {
  if (auth.keyType !== 'admin' || auth.userRole !== 'admin')
    throw new ApiError(403, 'Admin API key required');
}

export function requireSelfOrAdmin(auth: ApiAuthContext, targetUserId: string) {
  if (auth.userId !== targetUserId && auth.keyType !== 'admin')
    throw new ApiError(403, 'Access denied');
}
```

---

## 6. Rate Limiting

### Strategy: Sliding Window Counter (in-memory + DB fallback)

| Key Type    | Requests/Minute | Requests/Hour | Requests/Day |
|-------------|:---------------:|:-------------:|:------------:|
| `user`      | 60              | 1,000         | 10,000       |
| `developer` | 120             | 3,000         | 30,000       |
| `admin`     | 300             | 10,000        | 100,000      |

### Implementation

- Primary: **In-memory Map** with sliding window (for single-server deployments)
- Fallback: **Supabase table** `api_rate_limits` for persistence across restarts
- Response headers on every request:
  ```
  X-RateLimit-Limit: 60
  X-RateLimit-Remaining: 45
  X-RateLimit-Reset: 1711054500
  ```
- When exceeded: `429 Too Many Requests` with `Retry-After` header

### Database Table: `api_rate_limits`

```sql
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key_id       UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (key_id, window_start)
);
```

---

## 7. Standard Response Envelope

All API responses follow this envelope:

### Success

```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2026-03-21T20:00:00Z",
    "requestId": "req_abc123",
    "pagination": {           // only if paginated
      "page": 1,
      "perPage": 20,
      "total": 142,
      "totalPages": 8
    }
  },
  "error": null
}
```

### Error

```json
{
  "data": null,
  "meta": {
    "timestamp": "2026-03-21T20:00:00Z",
    "requestId": "req_abc123"
  },
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired API key",
    "details": null
  }
}
```

### Error Codes

| HTTP Status | Code                  | Meaning                    |
|:-----------:|-----------------------|----------------------------|
| 400         | `BAD_REQUEST`         | Invalid parameters         |
| 401         | `UNAUTHORIZED`        | Missing / invalid key      |
| 403         | `FORBIDDEN`           | Insufficient permissions   |
| 404         | `NOT_FOUND`           | Resource not found         |
| 429         | `RATE_LIMITED`        | Too many requests          |
| 500         | `INTERNAL_ERROR`      | Unexpected server error    |

### Helper Functions

```typescript
// responseEnvelope.ts
export function apiSuccess(data: unknown, meta?: Partial<ApiMeta>) { ... }
export function apiError(status: number, code: string, message: string, details?: unknown) { ... }
export function apiPaginated(data: unknown[], pagination: Pagination) { ... }
```

---

## 8. Endpoint Catalog

### Public (No Auth)

| Method | Path               | Description        |
|--------|--------------------|--------------------|
| GET    | `/api/v1/health`   | System health check |

### User Endpoints (any valid key)

| Method | Path                              | Description                         |
|--------|-----------------------------------|-------------------------------------|
| GET    | `/api/v1/auth/me`                 | Current user info + role            |
| GET    | `/api/v1/keys`                    | List your API keys                  |
| POST   | `/api/v1/keys`                    | Create a new API key                |
| GET    | `/api/v1/keys/:keyId`             | API key details                     |
| DELETE | `/api/v1/keys/:keyId`             | Revoke an API key                   |
| GET    | `/api/v1/movies/search?q=...`     | Search movies via TMDB              |
| GET    | `/api/v1/movies/:tmdbId`          | Movie details                       |
| GET    | `/api/v1/suggestions`             | Get personalized recommendations    |
| GET    | `/api/v1/suggestions/blocked`     | List blocked suggestions            |
| POST   | `/api/v1/suggestions/blocked`     | Block a suggestion                  |
| DELETE | `/api/v1/suggestions/blocked/:id` | Unblock a suggestion                |
| GET    | `/api/v1/suggestions/liked`       | List liked suggestions              |
| POST   | `/api/v1/suggestions/liked`       | Like a suggestion                   |
| DELETE | `/api/v1/suggestions/liked/:id`   | Remove liked suggestion             |
| GET    | `/api/v1/profile`                 | Taste profile summary               |
| GET    | `/api/v1/profile/films`           | Film events & ratings               |
| GET    | `/api/v1/profile/watchlist`       | Watchlist                           |
| GET    | `/api/v1/profile/diary`           | Diary entries                       |
| GET    | `/api/v1/stats`                   | User statistics                     |

### Admin Endpoints (admin key only)

| Method | Path                                  | Description                        |
|--------|---------------------------------------|------------------------------------|
| GET    | `/api/v1/admin/users`                 | List all users                     |
| GET    | `/api/v1/admin/users/:userId`         | User detail (any user's data)      |
| PATCH  | `/api/v1/admin/users/:userId`         | Update user role                   |
| GET    | `/api/v1/admin/cache`                 | Cache table stats                  |
| POST   | `/api/v1/admin/cache/refresh`         | Force-refresh caches               |
| GET    | `/api/v1/admin/diagnostics`           | System health & diagnostics        |
| GET    | `/api/v1/admin/users/:userId/films`   | Any user's film data               |
| GET    | `/api/v1/admin/users/:userId/profile` | Any user's taste profile           |

### Webhook Endpoints (admin key only)

| Method | Path                           | Description                   |
|--------|--------------------------------|-------------------------------|
| GET    | `/api/v1/webhooks`             | List registered webhooks      |
| POST   | `/api/v1/webhooks`             | Register a webhook            |
| DELETE | `/api/v1/webhooks/:webhookId`  | Remove a webhook              |

---

## 9. Webhook System

### Supported Events (Phase 1)

| Event                         | Trigger                                |
|-------------------------------|----------------------------------------|
| `import.completed`           | User finishes a Letterboxd import      |
| `suggestions.generated`      | New recommendations are computed       |
| `feedback.created`           | User gives suggestion feedback         |

### Webhook Payload

```json
{
  "event": "suggestions.generated",
  "timestamp": "2026-03-21T20:00:00Z",
  "data": {
    "userId": "uuid",
    "count": 25
  },
  "signature": "sha256=..."
}
```

- Payloads are signed with HMAC-SHA256 using a per-webhook secret
- 3 retry attempts with exponential backoff on failure

### Database Table: `webhooks`

```sql
CREATE TABLE IF NOT EXISTS public.webhooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,          -- HMAC signing secret
  events      TEXT[] NOT NULL,        -- Array of subscribed events
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 10. Key Management UI

### Location: `/settings` page

A new **"API Keys"** section will be added to the existing Settings page, below the Appearance section (replacing the "More Settings Coming Soon" placeholder).

### UI Components

1. **Key List** — Table showing all keys for the current user:
   - Key prefix (e.g. `ls_u_a1b2****`)
   - Label
   - Type badge (`user` / `admin`)
   - Created date
   - Last used date (or "Never")
   - Status (Active / Expired / Revoked)
   - Revoke button

2. **Create Key Modal** — Form with:
   - Label input (optional)
   - Key type selector (only shows types the user's role allows)
   - Optional expiry date picker
   - Creates key → shows raw key in a copyable box with warning: *"This key will only be shown once. Copy it now."*

3. **Role Badge** — If the user is an admin, show their role badge in the section header

### Wireframe

```
┌──────────────────────────────────────────────────┐
│ 🔑 API Keys                          [+ New Key] │
├──────────────────────────────────────────────────┤
│ Key            Label         Type  Last Used  ⚡  │
│ ls_u_a1b2****  My AI Agent   user  2h ago     [×] │
│ ls_a_f6e5****  Admin CLI     admin 5m ago     [×] │
│ ls_u_9f8e****  (no label)    user  Never      [×] │
└──────────────────────────────────────────────────┘

┌──────────── Create API Key ─────────────────────┐
│ Label:  [My AI Agent_________]                   │
│ Type:   (●) User  ( ) Admin                      │
│ Expires: [ Never ▾ ]                             │
│                                 [Cancel] [Create]│
└──────────────────────────────────────────────────┘

┌─────────── Key Created! ────────────────────────┐
│ ⚠️ Copy this key now — it won't be shown again: │
│ ┌──────────────────────────────────────────────┐ │
│ │ ls_u_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8  │ │
│ │                                     [📋 Copy]│ │
│ └──────────────────────────────────────────────┘ │
│                                          [Done]  │
└──────────────────────────────────────────────────┘
```

---

## 11. Database Migrations

### Migration Files (3 total)

#### 1. `TIMESTAMP_user_roles.sql`
- Creates `user_roles` table
- Seeds all existing users with `user` role
- RLS policies: users can read own role, admins can read/write all

#### 2. `TIMESTAMP_api_keys.sql`
- Creates `api_keys` table with indexes
- Creates `api_rate_limits` table
- RLS policies: users manage own keys, service role bypasses for API layer

#### 3. `TIMESTAMP_webhooks.sql`
- Creates `webhooks` table
- RLS policies: users manage own webhooks

> [!NOTE]
> All migrations use `IF NOT EXISTS` and `DROP POLICY IF EXISTS` for idempotency, per project conventions.

---

## 12. Security Considerations

| Concern                | Mitigation                                                   |
|------------------------|--------------------------------------------------------------|
| Key storage            | Only SHA-256 hashes stored; raw key never persisted          |
| Key in transit         | HTTPS only; keys sent in `Authorization` header (not URL)    |
| Key leakage            | Shown once at creation; prefix-only in UI & logs             |
| Brute force            | Rate limiting + key length (32 bytes = 256 bits of entropy)  |
| Privilege escalation   | Key type validated against user role on every request         |
| Admin key creation     | Only users with `admin` role can create `admin` type keys    |
| Expired keys           | Checked on every auth request; rejected with 401             |
| Revoked keys           | `revoked_at IS NOT NULL` excluded from all lookups           |
| Webhook secrets        | HMAC-SHA256 signing; secrets per-webhook, never in payloads  |
| Service role client    | `supabaseAdmin` key stored server-side only (`env` not `NEXT_PUBLIC_`) |
| Timing attacks         | Use `crypto.timingSafeEqual` for hash comparisons            |

---

## 13. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `src/app/api/v1/_lib/apiKeyAuth.ts` | API key authentication middleware |
| `src/app/api/v1/_lib/rateLimiter.ts` | Rate limiting logic |
| `src/app/api/v1/_lib/responseEnvelope.ts` | Standard response envelope helpers |
| `src/app/api/v1/_lib/supabaseAdmin.ts` | Service-role Supabase client |
| `src/app/api/v1/_lib/permissions.ts` | Permission check helpers |
| `src/app/api/v1/health/route.ts` | Health check endpoint |
| `src/app/api/v1/auth/me/route.ts` | Current user endpoint |
| `src/app/api/v1/keys/route.ts` | Key list + create |
| `src/app/api/v1/keys/[keyId]/route.ts` | Key detail + revoke |
| `src/app/api/v1/movies/search/route.ts` | Movie search proxy |
| `src/app/api/v1/movies/[tmdbId]/route.ts` | Movie detail proxy |
| `src/app/api/v1/suggestions/route.ts` | Recommendations |
| `src/app/api/v1/suggestions/blocked/route.ts` | Blocked suggestions |
| `src/app/api/v1/suggestions/liked/route.ts` | Liked suggestions |
| `src/app/api/v1/profile/route.ts` | Taste profile |
| `src/app/api/v1/profile/films/route.ts` | Film events |
| `src/app/api/v1/profile/watchlist/route.ts` | Watchlist |
| `src/app/api/v1/profile/diary/route.ts` | Diary |
| `src/app/api/v1/stats/route.ts` | User stats |
| `src/app/api/v1/admin/users/route.ts` | User management |
| `src/app/api/v1/admin/users/[userId]/route.ts` | User detail + role |
| `src/app/api/v1/admin/cache/route.ts` | Cache management |
| `src/app/api/v1/admin/diagnostics/route.ts` | System diagnostics |
| `src/app/api/v1/webhooks/route.ts` | Webhook CRUD |
| `src/app/api/v1/webhooks/[webhookId]/route.ts` | Webhook detail + delete |
| `src/lib/webhookDispatcher.ts` | Webhook event dispatcher |
| `src/components/ApiKeyManager.tsx` | Key management UI component |
| `supabase/migrations/TIMESTAMP_user_roles.sql` | User roles table |
| `supabase/migrations/TIMESTAMP_api_keys_and_rate_limits.sql` | API keys + rate limits |
| `supabase/migrations/TIMESTAMP_webhooks.sql` | Webhooks table |
| `Docs/API.md` | API documentation (markdown) |

### Modified Files

| File | Changes |
|------|---------|
| `src/app/settings/page.tsx` | Add API Keys section (replace placeholder) |
| `.env.local` | Add `SUPABASE_SERVICE_ROLE_KEY` |

---

## 14. Verification Plan

### Automated Tests

Since the project uses Playwright for E2E, we will verify via:

1. **API endpoint tests** — A new Playwright test file `tests/api-v1.spec.ts` that:
   - Creates an API key via the Settings UI
   - Tests all major endpoints via `fetch()` with the key
   - Verifies unauthorized access is rejected
   - Verifies admin-only endpoints reject user keys
   - Verifies rate limit headers are present
   - Verifies response envelope format

   ```bash
   npx playwright test tests/api-v1.spec.ts
   ```

2. **Build verification** — Ensure no type/lint errors:
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

### Manual Verification

1. **Key creation flow:**
   - Log in → Go to Settings → Create an API key → Verify key is shown once → Copy it → Verify it disappears on modal close

2. **API access with curl:**
   ```bash
   # Health check (no auth)
   curl https://lettrsuggest.netlify.app/api/v1/health

   # User data (with key)
   curl -H "Authorization: Bearer ls_u_<key>" https://lettrsuggest.netlify.app/api/v1/auth/me

   # Should be rejected (no key)
   curl https://lettrsuggest.netlify.app/api/v1/auth/me

   # Admin endpoint with user key (should be 403)
   curl -H "Authorization: Bearer ls_u_<key>" https://lettrsuggest.netlify.app/api/v1/admin/users
   ```

3. **Rate limiting:**
   - Send rapid requests in a loop and verify 429 response after exceeding the limit

4. **Key revocation:**
   - Create key → use it → revoke it → verify it returns 401

---

## Implementation Order

> [!TIP]
> Recommended phased approach:

**Phase 1 — Foundation (Core)**
1. Database migrations (roles, API keys, rate limits)
2. `supabaseAdmin` service-role client
3. `apiKeyAuth` middleware + `rateLimiter` + `responseEnvelope`
4. `/api/v1/health` endpoint
5. Key management UI on Settings page
6. `/api/v1/keys` endpoints
7. `/api/v1/auth/me` endpoint

**Phase 2 — User Endpoints**
8. Movie search & detail endpoints
9. Suggestions endpoints (list, blocked, liked)
10. Profile endpoints (taste profile, films, watchlist, diary)
11. Stats endpoint

**Phase 3 — Admin Endpoints**
12. User management (`/admin/users`)
13. Cache management (`/admin/cache`)
14. Diagnostics (`/admin/diagnostics`)

**Phase 4 — Webhooks**
15. Webhook table migration
16. Webhook CRUD endpoints
17. Webhook dispatcher integration

**Phase 5 — Documentation & Testing**
18. `Docs/API.md` documentation
19. Playwright E2E tests
20. Final lint/typecheck/build verification
