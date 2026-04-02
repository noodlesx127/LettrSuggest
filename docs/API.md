# LettrSuggest REST API v1

> **Base URL:** `/api/v1`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Response Envelope](#response-envelope)
3. [Rate Limiting](#rate-limiting)
4. [Error Codes](#error-codes)
5. [Endpoints](#endpoints)
   - [Health](#health)
   - [Auth](#auth)
   - [Keys](#keys)
   - [Movies](#movies)
   - [Suggestions](#suggestions)
   - [Profile](#profile)
   - [Stats](#stats)
   - [Admin — Users](#admin--users)
   - [Admin — Cache](#admin--cache)
   - [Admin — Diagnostics](#admin--diagnostics)
   - [Webhooks](#webhooks)
6. [Webhook Events](#webhook-events)
7. [Key Types & Roles](#key-types--roles)

---

## Authentication

All endpoints except `GET /api/v1/health` require a `Bearer` token in the `Authorization` header.

Two token formats are accepted:

| Format       | Description                                                            |
| ------------ | ---------------------------------------------------------------------- |
| API Key      | `ls_u_<64 hex chars>`, `ls_a_<64 hex chars>`, or `ls_d_<64 hex chars>` |
| Supabase JWT | Session token from `supabase.auth.getSession()`                        |

```http
Authorization: Bearer ls_u_a1b2c3d4...
```

API keys are subject to [rate limiting](#rate-limiting). JWT-authenticated requests skip rate limiting (used by the settings UI only).

---

## Response Envelope

All responses use a standard JSON envelope:

```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2026-03-21T12:00:00.000Z",
    "requestId": "req_a1b2c3d4e5f6"
  },
  "error": null
}
```

**Paginated responses** include pagination info in `meta`:

```json
{
  "data": [ ... ],
  "meta": {
    "timestamp": "2026-03-21T12:00:00.000Z",
    "requestId": "req_a1b2c3d4e5f6",
    "pagination": {
      "page": 1,
      "perPage": 20,
      "total": 150,
      "totalPages": 8,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  },
  "error": null
}
```

**Error responses** set `data: null` and populate `error`:

```json
{
  "data": null,
  "meta": {
    "timestamp": "2026-03-21T12:00:00.000Z",
    "requestId": "req_a1b2c3d4e5f6"
  },
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key",
    "details": null
  }
}
```

**Pagination query parameters** (supported on all paginated endpoints):

| Parameter  | Type    | Default | Max   | Description             |
| ---------- | ------- | ------- | ----- | ----------------------- |
| `page`     | integer | `1`     | —     | Page number (1-indexed) |
| `per_page` | integer | `20`    | `100` | Results per page        |

---

## Rate Limiting

Rate limits are applied per API key across three windows simultaneously. The tightest window that is closest to its limit governs the headers returned.

| Key Type    | Per Minute | Per Hour | Per Day |
| ----------- | ---------- | -------- | ------- |
| `user`      | 60         | 1,000    | 10,000  |
| `developer` | 120        | 3,000    | 30,000  |
| `admin`     | 300        | 10,000   | 100,000 |

**Rate limit headers** are included on every API-key-authenticated response:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1742558460
```

When a limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 37
```

---

## Error Codes

| HTTP Status | Code                  | Description                                       |
| ----------- | --------------------- | ------------------------------------------------- |
| 400         | `BAD_REQUEST`         | Invalid request parameters or body                |
| 401         | `UNAUTHORIZED`        | Missing, invalid, or expired API key              |
| 403         | `FORBIDDEN`           | Insufficient permissions for the requested action |
| 404         | `NOT_FOUND`           | Resource does not exist or is not accessible      |
| 429         | `RATE_LIMITED`        | Rate limit exceeded                               |
| 500         | `INTERNAL_ERROR`      | Unexpected server error                           |
| 503         | `SERVICE_UNAVAILABLE` | Database or critical service unavailable          |

---

## Endpoints

### Health

#### `GET /api/v1/health`

Public endpoint. Returns the current service status. Returns `503` if the database is unreachable.

**Authentication:** None required.

**Response:**

```json
{
  "data": {
    "status": "ok",
    "version": "v1",
    "timestamp": "2026-03-21T12:00:00.000Z",
    "db": "connected"
  },
  "meta": { ... },
  "error": null
}
```

| Field     | Type   | Values                     |
| --------- | ------ | -------------------------- |
| `status`  | string | `"ok"`                     |
| `version` | string | `"v1"`                     |
| `db`      | string | `"connected"` \| `"error"` |

---

### Auth

#### `GET /api/v1/auth/me`

Returns information about the currently authenticated user.

**Authentication:** Any valid API key or JWT.

**Response:**

```json
{
  "data": {
    "userId": "uuid",
    "email": "user@example.com",
    "role": "user",
    "keyType": "user",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

| Field       | Type           | Description                            |
| ----------- | -------------- | -------------------------------------- |
| `userId`    | string         | User UUID                              |
| `email`     | string \| null | User email address                     |
| `role`      | string         | `"user"` \| `"developer"` \| `"admin"` |
| `keyType`   | string         | `"user"` \| `"developer"` \| `"admin"` |
| `createdAt` | string         | ISO 8601 timestamp                     |

---

### Keys

#### `GET /api/v1/keys`

Lists all API keys for the authenticated user. The raw key is never returned — only the prefix.

**Authentication:** Any valid API key or JWT.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "key_prefix": "ls_u_a1b2c3",
      "label": "My App",
      "key_type": "user",
      "status": "active",
      "created_at": "2026-01-01T00:00:00.000Z",
      "last_used_at": "2026-03-21T10:00:00.000Z",
      "expires_at": null,
      "revoked_at": null
    }
  ]
}
```

**Key status values:**

| Status    | Description                          |
| --------- | ------------------------------------ |
| `active`  | Key is valid and usable              |
| `expired` | Key has passed its `expires_at` date |
| `revoked` | Key has been explicitly revoked      |

---

#### `POST /api/v1/keys`

Creates a new API key. The raw key is returned **only once** in the response and cannot be retrieved again.

**Authentication:** Any valid API key or JWT. Creating `developer` keys requires `developer` or `admin` role. Creating `admin` keys requires `admin` role.

**Request Body:**

```json
{
  "key_type": "user",
  "label": "My App",
  "expires_at": "2027-01-01T00:00:00.000Z"
}
```

| Field        | Type   | Required | Description                                      |
| ------------ | ------ | -------- | ------------------------------------------------ |
| `key_type`   | string | Yes      | `"user"` \| `"developer"` \| `"admin"`           |
| `label`      | string | No       | Human-readable label (max display use)           |
| `expires_at` | string | No       | ISO 8601 expiry datetime (must be in the future) |

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "key_prefix": "ls_u_a1b2c3",
    "label": "My App",
    "key_type": "user",
    "status": "active",
    "rawKey": "ls_u_a1b2c3d4...",
    "created_at": "2026-03-21T12:00:00.000Z",
    "last_used_at": null,
    "expires_at": null,
    "revoked_at": null
  }
}
```

> **Important:** `rawKey` is returned exactly once. Store it securely — it cannot be retrieved again.

---

#### `GET /api/v1/keys/:keyId`

Returns details for a specific API key.

**Authentication:** Any valid API key or JWT. Users can only access their own keys.

**Path Parameters:**

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `keyId`   | UUID | API key ID  |

**Response:** Same shape as a single item from `GET /api/v1/keys`.

---

#### `DELETE /api/v1/keys/:keyId`

Revokes an API key. Once revoked, the key cannot be used for authentication.

**Authentication:** Any valid API key or JWT. Users can only revoke their own keys.

**Path Parameters:**

| Parameter | Type | Description |
| --------- | ---- | ----------- |
| `keyId`   | UUID | API key ID  |

**Response:**

```json
{
  "data": { "revoked": true }
}
```

---

### Movies

#### `GET /api/v1/movies/search`

Searches for movies using TMDB. Results are paginated (20 per page, TMDB-controlled).

**Authentication:** Any valid API key or JWT.

**Query Parameters:**

| Parameter | Type    | Required | Description              |
| --------- | ------- | -------- | ------------------------ |
| `q`       | string  | Yes      | Search query             |
| `year`    | integer | No       | Filter by release year   |
| `page`    | integer | No       | Page number (default: 1) |

**Response:**

```json
{
  "data": [
    {
      "id": 27205,
      "title": "Inception",
      "release_date": "2010-07-16",
      "poster_path": "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
      "vote_average": 8.4,
      "overview": "Cobb, a skilled thief..."
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "perPage": 20,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

---

#### `GET /api/v1/movies/:tmdbId`

Returns detailed information for a specific movie from TMDB, including credits, keywords, videos, similar movies, and recommendations.

**Authentication:** Any valid API key or JWT.

**Path Parameters:**

| Parameter | Type    | Description                      |
| --------- | ------- | -------------------------------- |
| `tmdbId`  | integer | TMDB movie ID (positive integer) |

**Response:**

```json
{
  "data": {
    "id": 27205,
    "title": "Inception",
    "release_date": "2010-07-16",
    "runtime": 148,
    "genres": [ { "id": 28, "name": "Action" } ],
    "credits": { "cast": [...], "crew": [...] },
    "keywords": { "keywords": [...] },
    "videos": { "results": [...] },
    "similar": { "results": [...] },
    "recommendations": { "results": [...] }
  }
}
```

---

### Suggestions

#### `GET /api/v1/suggestions`

Lists the authenticated user's saved-for-later movie suggestions, ordered by creation date (newest first).

**Authentication:** Any valid API key or JWT.

**Query Parameters:** Supports `page` and `per_page`.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "tmdb_id": 27205,
      "title": "Inception",
      "year": "2010",
      "poster_path": "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
      "order_index": 0,
      "created_at": "2026-03-21T12:00:00.000Z"
    }
  ]
}
```

---

#### `GET /api/v1/suggestions/blocked`

Lists movies the user has blocked from suggestions.

**Authentication:** Any valid API key or JWT.

**Query Parameters:** Supports `page` and `per_page`.

**Response:**

```json
{
  "data": [
    {
      "tmdb_id": 27205,
      "title": "Inception",
      "year": "2010",
      "poster_path": "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
      "created_at": "2026-03-21T12:00:00.000Z"
    }
  ]
}
```

---

#### `POST /api/v1/suggestions/blocked`

Blocks a movie from appearing in suggestions. Idempotent — blocking an already-blocked movie is a no-op.

**Authentication:** Any valid API key or JWT.

**Request Body:**

```json
{
  "tmdb_id": 27205,
  "title": "Inception",
  "year": "2010",
  "poster_path": "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg"
}
```

| Field         | Type    | Required | Description      |
| ------------- | ------- | -------- | ---------------- |
| `tmdb_id`     | integer | Yes      | TMDB movie ID    |
| `title`       | string  | Yes      | Movie title      |
| `year`        | string  | No       | Release year     |
| `poster_path` | string  | No       | TMDB poster path |

**Response:**

```json
{
  "data": { "blocked": true, "tmdb_id": 27205 }
}
```

---

#### `DELETE /api/v1/suggestions/blocked/:tmdbId`

Unblocks a previously blocked movie.

**Authentication:** Any valid API key or JWT.

**Path Parameters:**

| Parameter | Type    | Description   |
| --------- | ------- | ------------- |
| `tmdbId`  | integer | TMDB movie ID |

**Response:**

```json
{
  "data": { "unblocked": true }
}
```

---

#### `GET /api/v1/suggestions/liked`

Lists movies the user has explicitly liked, ordered by creation date (newest first).

**Authentication:** Any valid API key or JWT.

**Query Parameters:** Supports `page` and `per_page`.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "tmdb_id": 27205,
      "title": "Inception",
      "year": "2010",
      "poster_path": "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg",
      "order_index": 1,
      "created_at": "2026-03-21T12:00:00.000Z"
    }
  ]
}
```

---

#### `POST /api/v1/suggestions/liked`

Likes/saves a movie suggestion. Returns `409 CONFLICT` if the movie is already liked.

**Authentication:** Any valid API key or JWT.

**Request Body:**

```json
{
  "tmdb_id": 27205,
  "title": "Inception",
  "year": "2010",
  "poster_path": "/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg"
}
```

| Field         | Type    | Required | Description      |
| ------------- | ------- | -------- | ---------------- |
| `tmdb_id`     | integer | Yes      | TMDB movie ID    |
| `title`       | string  | Yes      | Movie title      |
| `year`        | string  | No       | Release year     |
| `poster_path` | string  | No       | TMDB poster path |

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "tmdb_id": 27205,
    "title": "Inception",
    "order_index": 5,
    "created_at": "2026-03-21T12:00:00.000Z"
  }
}
```

---

#### `DELETE /api/v1/suggestions/liked/:id`

Removes a liked suggestion.

**Authentication:** Any valid API key or JWT.

**Path Parameters:**

| Parameter | Type | Description                                                       |
| --------- | ---- | ----------------------------------------------------------------- |
| `id`      | UUID | Liked suggestion record ID (from `GET /api/v1/suggestions/liked`) |

**Response:**

```json
{
  "data": { "unliked": true }
}
```

---

### Profile

#### `GET /api/v1/profile`

Returns the authenticated user's profile, film count, and top 10 genres by preference.

**Authentication:** Any valid API key or JWT.

**Response:**

```json
{
  "data": {
    "profile": {
      "id": "uuid",
      "email": "user@example.com",
      "created_at": "2026-01-01T00:00:00.000Z",
      "suspended_at": null
    },
    "stats": {
      "filmCount": 523,
      "topGenres": [
        {
          "feature_id": 18,
          "feature_name": "Drama",
          "inferred_preference": 0.87,
          "positive_count": 45,
          "negative_count": 3,
          "last_updated": "2026-03-21T00:00:00.000Z"
        }
      ]
    }
  }
}
```

---

#### `GET /api/v1/profile/films`

Lists the authenticated user's imported film events.

**Authentication:** Any valid API key or JWT.

**Query Parameters:**

| Parameter  | Type    | Default     | Description                                |
| ---------- | ------- | ----------- | ------------------------------------------ |
| `page`     | integer | `1`         | Page number                                |
| `per_page` | integer | `20`        | Results per page (max 100)                 |
| `sort`     | string  | `last_date` | Sort field: `last_date`, `rating`, `title` |
| `order`    | string  | `desc`      | Sort order: `asc` or `desc`                |

**Response:**

```json
{
  "data": [
    {
      "uri": "letterboxd.com/film/inception",
      "title": "Inception",
      "year": 2010,
      "rating": 4.5,
      "liked": true,
      "rewatch": false,
      "watch_count": 2,
      "on_watchlist": false,
      "last_date": "2024-12-01"
    }
  ]
}
```

---

#### `GET /api/v1/profile/watchlist`

Lists movies currently on the user's watchlist.

**Authentication:** Any valid API key or JWT.

**Query Parameters:** Supports `page` and `per_page`.

**Response:** Same shape as `GET /api/v1/profile/films`, filtered to `on_watchlist = true`.

---

#### `GET /api/v1/profile/diary`

Lists the user's diary entries (watch history), ordered by date descending. Uses the `film_diary_events_enriched` database view when available.

**Authentication:** Any valid API key or JWT.

**Query Parameters:** Supports `page`, `per_page`, and optional `year`.

**Response:**

```json
{
  "data": [
    {
      "uri": "letterboxd.com/film/inception",
      "title": "Inception",
      "year": 2010,
      "rating": 4.5,
      "watched_at": "2024-12-01",
      "watch_count": 2,
      "rewatch": false,
      "liked": true,
      "on_watchlist": false
    }
  ]
}
```

---

### Stats

#### `GET /api/v1/stats`

Returns aggregate viewing statistics for the authenticated user.

**Authentication:** Any valid API key or JWT.

**Response:**

```json
{
  "data": {
    "filmStats": {
      "total_films": 523,
      "total_rated": 489,
      "avg_rating": 3.72,
      "total_liked": 142,
      "on_watchlist": 37
    },
    "explorationStats": {
      "exploration_rate": 0.34,
      "exploratory_films_rated": 178,
      "exploratory_avg_rating": 3.51,
      "last_updated": "2026-03-20T00:00:00.000Z"
    }
  }
}
```

`explorationStats` is `null` if no exploration data is available yet.

---

### Admin — Users

All admin endpoints require an admin API key (`ls_a_...`) and the authenticated user must have the `admin` role.

#### `GET /api/v1/admin/users`

Lists all users with their roles, ordered by creation date.

**Authentication:** Admin key + admin role required.

**Query Parameters:**

| Parameter  | Type    | Description                                        |
| ---------- | ------- | -------------------------------------------------- |
| `q`        | string  | Filter by email (case-insensitive substring match) |
| `page`     | integer | Page number                                        |
| `per_page` | integer | Results per page                                   |

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "created_at": "2026-01-01T00:00:00.000Z",
      "suspended_at": null,
      "role": "user"
    }
  ]
}
```

---

#### `GET /api/v1/admin/users/:userId`

Returns detailed information about a specific user.

**Authentication:** Admin key + admin role required.

**Path Parameters:**

| Parameter | Type | Description    |
| --------- | ---- | -------------- |
| `userId`  | UUID | Target user ID |

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-01-01T00:00:00.000Z",
    "suspended_at": null,
    "role": "user"
  }
}
```

---

#### `PATCH /api/v1/admin/users/:userId`

Updates a user's role.

**Authentication:** Admin key + admin role required.

**Path Parameters:**

| Parameter | Type | Description    |
| --------- | ---- | -------------- |
| `userId`  | UUID | Target user ID |

**Request Body:**

```json
{
  "role": "developer"
}
```

| Field  | Type   | Required | Values                                 |
| ------ | ------ | -------- | -------------------------------------- |
| `role` | string | Yes      | `"user"` \| `"developer"` \| `"admin"` |

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "developer",
    "updated_at": "2026-03-21T12:00:00.000Z"
  }
}
```

---

#### `GET /api/v1/admin/users/:userId/films`

Returns any user's film events (admin view).

**Authentication:** Admin key + admin role required.

**Path Parameters:**

| Parameter | Type | Description    |
| --------- | ---- | -------------- |
| `userId`  | UUID | Target user ID |

**Query Parameters:** Supports `page`, `per_page`, `sort`, and `order`.

**Response:** Same shape as `GET /api/v1/profile/films`.

---

#### `GET /api/v1/admin/users/:userId/profile`

Returns any user's taste profile and top genres.

**Authentication:** Admin key + admin role required.

**Path Parameters:**

| Parameter | Type | Description    |
| --------- | ---- | -------------- |
| `userId`  | UUID | Target user ID |

**Response:** Same shape as `GET /api/v1/profile`.

---

### Admin — Cache

#### `GET /api/v1/admin/cache`

Returns statistics for all clearable cache tables (row count and expired row count).

**Authentication:** Admin key + admin role required.

**Response:**

```json
{
  "data": [
    {
      "name": "tmdb_similar_cache",
      "count": 3401,
      "expiredCount": 120
    },
    {
      "name": "tuimdb_uid_cache",
      "count": 8823,
      "expiredCount": 0
    },
    {
      "name": "tastedive_cache",
      "count": 542,
      "expiredCount": 30
    },
    {
      "name": "watchmode_cache",
      "count": 710,
      "expiredCount": 5
    }
  ]
}
```

---

#### `POST /api/v1/admin/cache/refresh`

Clears one or more cache tables. Only whitelisted tables can be cleared.

**Authentication:** Admin key + admin role required.

**Request Body:**

```json
{
  "tables": ["tastedive_cache"]
}
```

**Valid table names:**

- `tmdb_similar_cache`
- `tuimdb_uid_cache`
- `tastedive_cache`
- `watchmode_cache`

**Response:**

```json
{
  "data": [{ "table": "tastedive_cache", "deletedCount": 542 }]
}
```

---

### Admin — Diagnostics

#### `GET /api/v1/admin/diagnostics`

Returns a system health overview including database status and key metrics.

**Authentication:** Admin key + admin role required.

**Response:**

```json
{
  "data": {
    "db": "ok",
    "timestamp": "2026-03-21T12:00:00.000Z",
    "stats": {
      "totalUsers": 412,
      "activeUsers": 87,
      "activeKeys": 203,
      "cacheTableRows": 14680,
      "totalFilmEvents": 287500
    }
  }
}
```

| Field            | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `db`             | `"ok"` or `"error"`                                   |
| `activeUsers`    | Users with an active API key used in the last 30 days |
| `activeKeys`     | Non-revoked API keys                                  |
| `cacheTableRows` | Total rows across all clearable cache tables          |

---

### Webhooks

All webhook endpoints require an admin API key and admin role.

#### `GET /api/v1/webhooks`

Lists the authenticated admin user's webhooks.

**Authentication:** Admin key + admin role required.

**Query Parameters:** Supports `page` and `per_page`.

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "url": "https://example.com/webhook",
      "events": ["import.completed", "suggestions.generated"],
      "active": true,
      "created_at": "2026-03-21T12:00:00.000Z"
    }
  ]
}
```

> The `secret` is never returned on list or detail endpoints.

---

#### `POST /api/v1/webhooks`

Creates a new webhook subscription. The signing secret is returned **only once** at creation.

**Authentication:** Admin key + admin role required.

**Request Body:**

```json
{
  "url": "https://example.com/webhook",
  "events": ["import.completed", "suggestions.generated"],
  "active": true
}
```

| Field    | Type     | Required | Description                                        |
| -------- | -------- | -------- | -------------------------------------------------- |
| `url`    | string   | Yes      | HTTPS endpoint URL                                 |
| `events` | string[] | Yes      | One or more [webhook event types](#webhook-events) |
| `active` | boolean  | No       | Default: `true`                                    |

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "url": "https://example.com/webhook",
    "events": ["import.completed"],
    "active": true,
    "secret": "a1b2c3d4...",
    "created_at": "2026-03-21T12:00:00.000Z"
  }
}
```

> **Important:** `secret` is returned exactly once. Store it securely — it cannot be retrieved again.

---

#### `GET /api/v1/webhooks/:webhookId`

Returns details for a specific webhook (without the secret).

**Authentication:** Admin key + admin role required.

**Path Parameters:**

| Parameter   | Type | Description |
| ----------- | ---- | ----------- |
| `webhookId` | UUID | Webhook ID  |

**Response:** Same shape as a single item from `GET /api/v1/webhooks`.

---

#### `DELETE /api/v1/webhooks/:webhookId`

Permanently deletes a webhook subscription.

**Authentication:** Admin key + admin role required.

**Path Parameters:**

| Parameter   | Type | Description |
| ----------- | ---- | ----------- |
| `webhookId` | UUID | Webhook ID  |

**Response:**

```json
{
  "data": { "deleted": true }
}
```

---

## Webhook Events

When a subscribed event fires, LettrSuggest sends an HTTP POST to your endpoint with the following payload:

```json
{
  "event": "import.completed",
  "timestamp": "2026-03-21T12:00:00.000Z",
  "data": { ... }
}
```

**Headers sent with every webhook delivery:**

```http
Content-Type: application/json
X-LettrSuggest-Signature: sha256=<hmac-hex>
X-LettrSuggest-Event: import.completed
```

### Signature Verification

Verify authenticity by computing `HMAC-SHA256(secret, body)` and comparing to the signature header:

```typescript
import crypto from "node:crypto";

function verifyWebhookSignature(
  body: string,
  secret: string,
  signatureHeader: string,
): boolean {
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")}`;
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  );
}
```

### Retry Policy

Webhooks are retried up to 3 attempts with exponential backoff (2s, 4s). Your endpoint must return a 2xx status to acknowledge receipt. Ensure your handler responds promptly (within 10 seconds).

### Event Reference

| Event                   | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `import.completed`      | A Letterboxd CSV import has finished processing   |
| `suggestions.generated` | A new batch of recommendations has been generated |
| `feedback.created`      | The user provided feedback on a suggestion        |

---

## Key Types & Roles

### API Key Prefixes

| Prefix  | Key Type    | Description                           |
| ------- | ----------- | ------------------------------------- |
| `ls_u_` | `user`      | Standard user key                     |
| `ls_d_` | `developer` | Developer key with higher rate limits |
| `ls_a_` | `admin`     | Admin key with full access            |

### Role Permissions

| Action                 | `user` | `developer` | `admin` |
| ---------------------- | ------ | ----------- | ------- |
| Read own data          | Yes    | Yes         | Yes     |
| Manage own API keys    | Yes    | Yes         | Yes     |
| Create developer keys  | No     | Yes         | Yes     |
| Create admin keys      | No     | No          | Yes     |
| Access admin endpoints | No     | No          | Yes     |
| Manage webhooks        | No     | No          | Yes     |
| View/clear cache       | No     | No          | Yes     |
| Change user roles      | No     | No          | Yes     |

> Both the key type AND the user's current role are verified for admin operations. If a user's role is downgraded after creating an admin key, that key will no longer pass admin-only checks.
