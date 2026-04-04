# MCP Diagnostic Observability — Implementation Plan

**Source:** `HANDOFF_MCP_OBSERVABILITY.md`
**Review date:** 2026-04-04
**Status:** Reviewed and adjusted

---

## Review Corrections Applied

The following issues were identified during code review and corrected in this plan:

| ID  | Severity | Issue                                                                       | Fix                                                     |
| --- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| C1  | Critical | Import path `@/lib/supabaseAdmin` incorrect for v1 routes                   | Use `../../_lib/supabaseAdmin`                          |
| C2  | Critical | Preference threshold `pref > 0` wrong for 0–1 scale                         | Use `pref >= 0.5`; fallback values `0.8/0.2` not `1/-1` |
| C3  | Critical | Version bump target `1.3.2` already deployed                                | Bump to `1.3.3`                                         |
| M1  | Major    | Admin diagnostics engine health shows admin's own data, not global          | Acceptable for shakedown use case — add doc comment     |
| M2  | Major    | Admin diagnostics file uses `supabaseAdmin` proxy, not `getSupabaseAdmin()` | Match existing file pattern                             |
| M4  | Major    | Missing `console.error` before rethrowing in catch                          | Add error logging                                       |
| m1  | Minor    | Shadow variable `d` in decades formatter                                    | Rename inner to `dec`                                   |
| m2  | Minor    | Missing `top_genres` in taste profile response                              | Add it                                                  |
| m3  | Minor    | `!d.total_signals` check is implicit                                        | Use `d.total_signals === 0`                             |
| m4  | Minor    | `feature_id` not in response entries                                        | Add `id: row.feature_id`                                |
| m6  | Minor    | `"collection"` missing from MCP formatter types list                        | Add it                                                  |

---

## Build Order

1. **Task 1** — Backend: `GET /api/v1/profile/taste-detail`
2. **Task 2** — Backend: `GET /api/v1/profile/feedback`
3. **Task 3** — Backend: debug mode for `/api/v1/suggestions/generate`
4. **Task 4** — Backend: engine health in `/api/v1/admin/diagnostics`
5. **Task 5** — MCP: new tools + updates + version bump to 1.3.3

No schema changes, no migrations needed.

---

## Task 1: `GET /api/v1/profile/taste-detail`

**File:** `src/app/api/v1/profile/taste-detail/route.ts`

```typescript
import { withApiAuth } from "../../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const db = getSupabaseAdmin();

      const { data: cacheRow, error } = await db
        .from("user_taste_profile_cache")
        .select("profile, film_count, computed_at")
        .eq("user_id", auth.userId)
        .maybeSingle();

      if (error)
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to read taste profile cache",
        );

      if (!cacheRow) {
        return apiSuccess({
          cached: false,
          message:
            "No taste profile cached yet. Run a suggestion first to generate one.",
        });
      }

      const profile = cacheRow.profile as any;
      const computedAt = cacheRow.computed_at;
      const ageMinutes = Math.round(
        (Date.now() - new Date(computedAt).getTime()) / 60000,
      );

      return apiSuccess({
        cached: true,
        computed_at: computedAt,
        age_minutes: ageMinutes,
        film_count: cacheRow.film_count,
        // Top genres (added — central taste signal)
        top_genres: (profile.topGenres ?? []).slice(0, 15).map((g: any) => ({
          name: g.name,
          weight: Math.round((g.weight ?? 0) * 100) / 100,
          id: g.id ?? null,
        })),
        // Top directors (full list, not just top 5)
        top_directors: (profile.topDirectors ?? [])
          .slice(0, 20)
          .map((d: any) => ({
            name: d.name,
            weight: Math.round((d.weight ?? 0) * 100) / 100,
            count: d.count ?? null,
          })),
        // Top keywords with TF-IDF scores
        top_keywords: (profile.topKeywords ?? [])
          .slice(0, 20)
          .map((k: any) => ({
            name: k.name,
            weight: Math.round((k.weight ?? 0) * 100) / 100,
            tfidf: k.tfidfScore ? Math.round(k.tfidfScore * 1000) / 1000 : null,
            count: k.count ?? null,
          })),
        // Top actors
        top_actors: (profile.topActors ?? []).slice(0, 15).map((a: any) => ({
          name: a.name,
          weight: Math.round((a.weight ?? 0) * 100) / 100,
        })),
        // Top studios
        top_studios: (profile.topStudios ?? []).slice(0, 10).map((s: any) => ({
          name: s.name,
          count: s.count ?? null,
        })),
        // Preferred decades
        top_decades: (profile.topDecades ?? []).slice(0, 6).map((dec: any) => ({
          decade: dec.decade,
          weight: Math.round((dec.weight ?? 0) * 100) / 100,
        })),
        // Avoid signals
        avoid_genres: (profile.avoidGenres ?? [])
          .slice(0, 10)
          .map((g: any) => ({
            name: g.name,
            id: g.id,
          })),
        avoid_keywords: (profile.avoidKeywords ?? [])
          .slice(0, 10)
          .map((k: any) => ({
            name: k.name,
          })),
        user_stats: profile.userStats ?? null,
        taste_bins: profile.tasteBins ?? null,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("[v1/profile/taste-detail] Unexpected error:", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
```

---

## Task 2: `GET /api/v1/profile/feedback`

**File:** `src/app/api/v1/profile/feedback/route.ts`

```typescript
import { withApiAuth } from "../../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const db = getSupabaseAdmin();

      const { data, error } = await db
        .from("user_feature_feedback")
        .select(
          "feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count, last_updated",
        )
        .eq("user_id", auth.userId)
        .order("last_updated", { ascending: false });

      if (error)
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch feedback");

      const rows = (data ?? []) as any[];

      // Group by type and direction
      const grouped: Record<string, { prefer: any[]; avoid: any[] }> = {};
      const types = [
        "actor",
        "director",
        "genre",
        "keyword",
        "franchise",
        "collection",
        "subgenre",
      ];
      for (const t of types) grouped[t] = { prefer: [], avoid: [] };

      for (const row of rows) {
        const type = row.feature_type ?? "unknown";
        if (!grouped[type]) grouped[type] = { prefer: [], avoid: [] };

        // inferred_preference is 0-1 scale (confirmed in migrations)
        // Fallback uses 0.8/0.2 to stay on same scale; threshold 0.5 as midpoint
        const pref =
          typeof row.inferred_preference === "number"
            ? row.inferred_preference
            : row.positive_count > row.negative_count
              ? 0.8
              : 0.2;

        const entry = {
          id: row.feature_id,
          name: row.feature_name,
          positive: row.positive_count,
          negative: row.negative_count,
          preference: Math.round((pref ?? 0) * 100) / 100,
          last_updated: row.last_updated,
        };

        if (pref >= 0.5) grouped[type].prefer.push(entry);
        else grouped[type].avoid.push(entry);
      }

      return apiSuccess({
        total_signals: rows.length,
        by_type: grouped,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("[v1/profile/feedback] Unexpected error:", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
```

---

## Task 3: Debug mode for `/api/v1/suggestions/generate`

**File:** `src/app/api/v1/suggestions/generate/route.ts`

### `GenerateSuggestionsBody` — add `debug` field:

```typescript
debug?: boolean;
```

### Parse from body:

```typescript
debug: typeof body.debug === "boolean" ? body.debug : false,
```

### After `personalizationFiltered` is computed, before building response — add source debug summary:

```typescript
const sourceDebugSummary = debug
  ? (() => {
      const counts: Record<string, number> = {};
      for (const [, meta] of sourceMetadata.entries()) {
        for (const source of meta.sources) {
          counts[source] = (counts[source] ?? 0) + 1;
        }
      }
      return counts;
    })()
  : undefined;
```

### Enrich meta when debug is true:

```typescript
...(debug ? {
  source_candidate_counts: sourceDebugSummary,
  seeds_used: body.seed_tmdb_ids,
  genre_filter_applied: body.genre_ids?.length ? body.genre_ids : null,
  candidates_before_genre_filter: scored.length,
  candidates_after_genre_filter: genreFiltered.length,
  candidates_after_personalization_filter: personalizationFiltered.length,
} : {}),
```

**Note:** `scoreBreakdown` on result items is deferred — `suggestByOverlap` does not currently attach it. Add after confirming debug meta fields work.

---

## Task 4: Engine health in `/api/v1/admin/diagnostics`

**File:** `src/app/api/v1/admin/diagnostics/route.ts`

**Architecture note:** `engine_health` is scoped to `auth.userId` (the admin's own account). This is intentional — the admin is the primary shakedown user. This is not a global system view.

### Add to the `Promise.all` batch (using `supabaseAdmin` proxy to match existing file pattern):

```typescript
supabaseAdmin
  .from("user_taste_profile_cache")
  .select("user_id, film_count, computed_at")
  .eq("user_id", auth.userId)
  .maybeSingle(),

supabaseAdmin
  .from("user_feature_feedback")
  .select("*", { count: "exact", head: true })
  .eq("user_id", auth.userId),

supabaseAdmin
  .from("suggestion_exposure_log")
  .select("*", { count: "exact", head: true })
  .eq("user_id", auth.userId),
```

### Destructure and add to response:

```typescript
const [
  // ... existing destructured results ...
  { data: tasteProfileRow },
  { count: feedbackCount },
  { count: exposureCount },
] = await Promise.all([/* ... */]);

// In response:
engine_health: {
  // Note: scoped to the authenticated admin's own account (shakedown user)
  taste_profile_cached: !!tasteProfileRow,
  taste_profile_age_hours: tasteProfileRow
    ? Math.round((Date.now() - new Date(tasteProfileRow.computed_at).getTime()) / 3600000)
    : null,
  taste_profile_film_count: tasteProfileRow?.film_count ?? null,
  feedback_signal_count: feedbackCount ?? 0,
  exposure_log_count: exposureCount ?? 0,
},
```

---

## Task 5: MCP updates in `lettrsuggest-mcp`

**File:** `F:\Code\lettrsuggest-mcp\src\index.ts`
**Version:** Bump to `1.3.3`

### New tool: `ls_get_taste_profile_detail`

```typescript
server.registerTool(
  "ls_get_taste_profile_detail",
  {
    title: "Get Detailed Taste Profile",
    description: `Returns the full computed taste profile used by the scoring engine.
Exposes what the engine actually "knows" about your taste:
- Top 15 genres with preference weights
- Top 20 directors with preference weights
- Top 20 keywords with TF-IDF scores (what themes define your taste)
- Top actors, studios, preferred decades
- Avoid signals (genres/keywords to filter)
- Cache age and status

Use this to understand why certain films score high or low, and to diagnose whether the engine has correctly learned your taste.`,
    inputSchema: emptySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (_args: EmptyInput): Promise<ToolResponse> => {
    const r = await apiGet<any>("/profile/taste-detail");
    const d = r.data;

    if (!d.cached) {
      return textResponse(`## Taste Profile\n⚠️ ${d.message}`);
    }

    const fmtWeightList = (
      items: Array<{
        name: string;
        weight?: number;
        tfidf?: number;
        count?: number;
      }>,
      showTfidf = false,
    ) =>
      items
        .map((i) => {
          const parts = [i.name];
          if (i.weight) parts.push(`weight: ${i.weight}`);
          if (showTfidf && i.tfidf) parts.push(`tfidf: ${i.tfidf}`);
          if (i.count) parts.push(`×${i.count}`);
          return `- ${parts.join(" · ")}`;
        })
        .join("\n");

    const lines = [
      "## 🎯 Computed Taste Profile",
      `*Cached ${d.age_minutes}m ago · built from ${d.film_count} films*`,
      "",
      "### Top Genres",
      fmtWeightList(d.top_genres ?? []),
      "",
      "### Top Directors",
      fmtWeightList(d.top_directors ?? []),
      "",
      "### Top Keywords (TF-IDF ranked)",
      fmtWeightList(d.top_keywords ?? [], true),
      "",
      "### Top Actors",
      fmtWeightList(d.top_actors ?? []),
      "",
      "### Top Studios",
      (d.top_studios ?? [])
        .map((s: any) => `- ${s.name}${s.count ? ` (×${s.count})` : ""}`)
        .join("\n"),
      "",
      "### Preferred Decades",
      (d.top_decades ?? [])
        .map((dec: any) => `- ${dec.decade}s (weight: ${dec.weight})`)
        .join("\n"),
      "",
      "### Avoid Signals",
      d.avoid_genres?.length
        ? `**Avoid genres:** ${d.avoid_genres.map((g: any) => g.name).join(", ")}`
        : "",
      d.avoid_keywords?.length
        ? `**Avoid keywords:** ${d.avoid_keywords.map((k: any) => k.name).join(", ")}`
        : "",
    ].filter((l) => l !== null && l !== undefined);

    return textResponse(lines.join("\n"));
  },
);
```

### New tool: `ls_get_feature_feedback`

```typescript
server.registerTool(
  "ls_get_feature_feedback",
  {
    title: "Get Feature Feedback (Pandora Learning State)",
    description: `Returns the current state of Pandora-style learning — what the engine has learned to prefer or avoid based on your feedback (likes, blocks, pairwise comparisons).

Shows prefer/avoid lists for:
- Actors, Directors, Genres, Keywords, Franchises, Collections, Subgenres

Use this to understand whether feedback is having the expected effect and to diagnose why certain films keep appearing or disappearing.`,
    inputSchema: emptySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async (_args: EmptyInput): Promise<ToolResponse> => {
    const r = await apiGet<any>("/profile/feedback");
    const d = r.data;

    if (d.total_signals === 0) {
      return textResponse(
        "## Feature Feedback\nNo feedback signals recorded yet. Like/block suggestions or use pairwise comparisons to build the learning model.",
      );
    }

    const fmtEntries = (entries: any[]) =>
      entries
        .slice(0, 8)
        .map((e) => `- ${e.name} (👍${e.positive} / 👎${e.negative})`)
        .join("\n");

    const types = [
      "director",
      "actor",
      "genre",
      "keyword",
      "franchise",
      "collection",
      "subgenre",
    ];
    const sections: string[] = [
      "## 🧠 Pandora Learning State",
      `*${d.total_signals} total feedback signals*`,
      "",
    ];

    for (const type of types) {
      const group = d.by_type?.[type];
      if (!group) continue;
      const hasData = group.prefer.length > 0 || group.avoid.length > 0;
      if (!hasData) continue;

      sections.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}`);
      if (group.prefer.length) {
        sections.push(`**Prefer (${group.prefer.length}):**`);
        sections.push(fmtEntries(group.prefer));
      }
      if (group.avoid.length) {
        sections.push(`**Avoid (${group.avoid.length}):**`);
        sections.push(fmtEntries(group.avoid));
      }
      sections.push("");
    }

    return textResponse(sections.join("\n"));
  },
);
```

### Update `ls_suggest_movies` — add `debug_mode` param:

Add to schema:

```typescript
debug_mode: z
  .boolean()
  .default(false)
  .describe("When true, returns source candidate counts, filter pipeline stats, and seed details in output."),
```

Pass `debug: debug_mode` in POST body. When debug_mode is true, append debug section after results:

````typescript
if (debug_mode && meta?.source_candidate_counts) {
  const sourceCounts = Object.entries(
    meta.source_candidate_counts as Record<string, number>,
  )
    .sort((a, b) => b[1] - a[1])
    .map(([src, count]) => `  ${src}: ${count}`)
    .join("\n");

  lines.push(
    "",
    "### 🔍 Debug: Candidate Sources",
    "```",
    sourceCounts,
    "```",
    `*Total before genre filter: ${meta.candidates_before_genre_filter ?? "?"}*`,
    `*After genre filter: ${meta.candidates_after_genre_filter ?? "?"}*`,
    `*After personalization filter: ${meta.candidates_after_personalization_filter ?? "?"}*`,
    `*Seeds sent: [${((meta.seeds_used as number[]) ?? []).join(", ")}]*`,
  );
}
````

### Update `ls_get_admin_diagnostics` — display engine health:

Append to rendered output:

```
### Engine Health
- Taste profile: ✅ Cached (4h old, built from 1206 films)
  OR: ❌ Not cached
- Feedback signals: 47 accumulated
- Exposure log: 892 entries (repeat penalty data)
```

### Version bump:

In `package.json`: `"version": "1.3.2"` → `"version": "1.3.3"`
In `src/index.ts` server version: `"1.3.2"` → `"1.3.3"`
