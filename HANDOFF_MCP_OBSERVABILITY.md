# LettrSuggest MCP — Diagnostic Observability Handoff
**Projects:** `F:\Code\LettrSuggest` (backend) and `F:\Code\lettrsuggest-mcp` (MCP)
**Purpose:** Give Claude (me) direct visibility into backend internals during shakedown runs so issues can be identified from MCP output alone — without requiring Netlify log access or source code reads.

---

## The Problem This Solves

Every shakedown currently requires:
1. Run suggestions, observe bad output
2. Cross-reference with Netlify function logs (or uploaded log.txt)
3. Read source files to find constants/weights
4. Trace candidate source IDs to understand origin
5. Guess at taste profile state based on indirect signals

The goal: after this handoff, I should be able to run a shakedown and diagnose all issues directly from MCP tool output in a single session with no external log access needed.

---

## Four New Tools to Build

---

### Tool 1: `ls_get_taste_profile_detail`

**What it exposes:** The full computed taste profile that `suggestByOverlap` uses for scoring. Currently only top genres are visible via `ls_get_profile`. The engine knows much more.

**New backend endpoint:** `GET /api/v1/profile/taste-detail`

**Implementation in `src/app/api/v1/profile/taste-detail/route.ts`:**

```typescript
import { withApiAuth } from "../../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const db = getSupabaseAdmin();

      // Read from taste profile cache
      const { data: cacheRow, error } = await db
        .from("user_taste_profile_cache")
        .select("profile, film_count, computed_at")
        .eq("user_id", auth.userId)
        .maybeSingle();

      if (error) throw new ApiError(500, "INTERNAL_ERROR", "Failed to read taste profile cache");

      if (!cacheRow) {
        return apiSuccess({
          cached: false,
          message: "No taste profile cached yet. Run a suggestion first to generate one.",
        });
      }

      const profile = cacheRow.profile as any;
      const computedAt = cacheRow.computed_at;
      const ageMinutes = Math.round(
        (Date.now() - new Date(computedAt).getTime()) / 60000
      );

      return apiSuccess({
        cached: true,
        computed_at: computedAt,
        age_minutes: ageMinutes,
        film_count: cacheRow.film_count,
        // Top directors (full list, not just top 5)
        top_directors: (profile.topDirectors ?? []).slice(0, 20).map((d: any) => ({
          name: d.name,
          weight: Math.round((d.weight ?? 0) * 100) / 100,
          count: d.count ?? null,
        })),
        // Top keywords with TF-IDF scores
        top_keywords: (profile.topKeywords ?? []).slice(0, 20).map((k: any) => ({
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
        top_decades: (profile.topDecades ?? []).slice(0, 6).map((d: any) => ({
          decade: d.decade,
          weight: Math.round((d.weight ?? 0) * 100) / 100,
        })),
        // Avoid signals
        avoid_genres: (profile.avoidGenres ?? []).slice(0, 10).map((g: any) => ({
          name: g.name,
          id: g.id,
        })),
        avoid_keywords: (profile.avoidKeywords ?? []).slice(0, 10).map((k: any) => ({
          name: k.name,
        })),
        // User stats from profile
        user_stats: profile.userStats ?? null,
        taste_bins: profile.tasteBins ?? null,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
```

**New MCP tool in `src/index.ts`:**

```typescript
server.registerTool(
  "ls_get_taste_profile_detail",
  {
    title: "Get Detailed Taste Profile",
    description: `Returns the full computed taste profile used by the scoring engine.
Exposes what the engine actually "knows" about your taste:
- Top 20 directors with preference weights
- Top 20 keywords with TF-IDF scores (what themes define your taste)
- Top actors, studios, preferred decades
- Avoid signals (genres/keywords to filter)
- Cache age and status

Use this to understand why certain films score high or low, and to diagnose whether the engine has correctly learned your taste.`,
    inputSchema: emptySchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async (_args: EmptyInput): Promise<ToolResponse> => {
    const r = await apiGet<any>("/profile/taste-detail");
    const d = r.data;

    if (!d.cached) {
      return textResponse(`## Taste Profile\n⚠️ ${d.message}`);
    }

    const fmtList = (items: Array<{name: string; weight?: number; tfidf?: number; count?: number}>, showTfidf = false) =>
      items.map(i => {
        const parts = [i.name];
        if (i.weight) parts.push(`weight: ${i.weight}`);
        if (showTfidf && i.tfidf) parts.push(`tfidf: ${i.tfidf}`);
        if (i.count) parts.push(`×${i.count}`);
        return `- ${parts.join(' · ')}`;
      }).join('\n');

    const lines = [
      "## 🎯 Computed Taste Profile",
      `*Cached ${d.age_minutes}m ago · built from ${d.film_count} films*`,
      "",
      "### Top Directors",
      fmtList(d.top_directors),
      "",
      "### Top Keywords (TF-IDF ranked)",
      fmtList(d.top_keywords, true),
      "",
      "### Top Actors",
      fmtList(d.top_actors),
      "",
      "### Top Studios",
      (d.top_studios ?? []).map((s: any) => `- ${s.name}${s.count ? ` (×${s.count})` : ''}`).join('\n'),
      "",
      "### Preferred Decades",
      (d.top_decades ?? []).map((d: any) => `- ${d.decade}s (weight: ${d.weight})`).join('\n'),
      "",
      "### Avoid Signals",
      d.avoid_genres?.length ? `**Avoid genres:** ${d.avoid_genres.map((g: any) => g.name).join(', ')}` : "",
      d.avoid_keywords?.length ? `**Avoid keywords:** ${d.avoid_keywords.map((k: any) => k.name).join(', ')}` : "",
    ].filter(l => l !== null && l !== undefined);

    return textResponse(lines.join('\n'));
  }
);
```

---

### Tool 2: `ls_get_feature_feedback`

**What it exposes:** The state of Pandora learning — what actors, directors, genres, keywords, and subgenres the engine has learned to prefer or avoid from your feedback interactions (likes, blocks, pairwise choices).

**New backend endpoint:** `GET /api/v1/profile/feedback`

**Implementation in `src/app/api/v1/profile/feedback/route.ts`:**

```typescript
import { withApiAuth } from "../../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const db = getSupabaseAdmin();

      const { data, error } = await db
        .from("user_feature_feedback")
        .select(
          "feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count, last_updated"
        )
        .eq("user_id", auth.userId)
        .order("last_updated", { ascending: false });

      if (error) throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch feedback");

      const rows = (data ?? []) as any[];

      // Group by type and direction
      const grouped: Record<string, { prefer: any[]; avoid: any[] }> = {};
      const types = ["actor", "director", "genre", "keyword", "franchise", "collection", "subgenre"];
      for (const t of types) grouped[t] = { prefer: [], avoid: [] };

      for (const row of rows) {
        const type = row.feature_type ?? "unknown";
        if (!grouped[type]) grouped[type] = { prefer: [], avoid: [] };

        const pref = typeof row.inferred_preference === "number"
          ? row.inferred_preference
          : row.positive_count > row.negative_count ? 1 : -1;

        const entry = {
          name: row.feature_name,
          positive: row.positive_count,
          negative: row.negative_count,
          preference: Math.round((pref ?? 0) * 100) / 100,
          last_updated: row.last_updated,
        };

        if (pref > 0) grouped[type].prefer.push(entry);
        else grouped[type].avoid.push(entry);
      }

      return apiSuccess({
        total_signals: rows.length,
        by_type: grouped,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
```

**New MCP tool:**

```typescript
server.registerTool(
  "ls_get_feature_feedback",
  {
    title: "Get Feature Feedback (Pandora Learning State)",
    description: `Returns the current state of Pandora-style learning — what the engine has learned to prefer or avoid based on your feedback (likes, blocks, pairwise comparisons).

Shows prefer/avoid lists for:
- Actors, Directors, Genres, Keywords, Franchises, Subgenres

Use this to understand whether feedback is having the expected effect and to diagnose why certain films keep appearing or disappearing.`,
    inputSchema: emptySchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async (_args: EmptyInput): Promise<ToolResponse> => {
    const r = await apiGet<any>("/profile/feedback");
    const d = r.data;

    if (!d.total_signals) {
      return textResponse("## Feature Feedback\nNo feedback signals recorded yet. Like/block suggestions or use pairwise comparisons to build the learning model.");
    }

    const fmtEntries = (entries: any[]) =>
      entries.slice(0, 8)
        .map(e => `- ${e.name} (👍${e.positive} / 👎${e.negative})`)
        .join('\n');

    const types = ["director", "actor", "genre", "keyword", "franchise", "subgenre"];
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

    return textResponse(sections.join('\n'));
  }
);
```

---

### Tool 3: `ls_suggest_movies` — Add `debug_mode` parameter

**What it exposes:** Per-source candidate counts, score breakdown per result, and seed resolution details — all without needing to look at Netlify logs.

**Backend change:** Add `debug: boolean` to the generate request body. When true, enrich the response meta with source debug data and enrich each result with a score breakdown.

**In `src/app/api/v1/suggestions/generate/route.ts`:**

Add `debug?: boolean` to `GenerateSuggestionsBody` and parse it:
```typescript
debug: typeof body.debug === "boolean" ? body.debug : false,
```

Then enrich the meta when `debug: true`:

```typescript
// After scored results are built, if debug mode:
const sourceDebugSummary = debug ? (() => {
  const counts: Record<string, number> = {};
  for (const [id, meta] of sourceMetadata.entries()) {
    for (const source of meta.sources) {
      counts[source] = (counts[source] ?? 0) + 1;
    }
  }
  return counts;
})() : undefined;

// Enrich each result with score breakdown when debug:
const data = personalizationFiltered.slice(0, body.limit).map((item) => ({
  tmdb_id: item.tmdbId,
  title: item.title ?? "",
  score: Math.round(item.score * 1000) / 1000,
  // ... existing fields ...
  // NEW: score breakdown (only in debug mode)
  ...(body.debug && item.scoreBreakdown ? { score_breakdown: item.scoreBreakdown } : {}),
}));

// In meta:
meta: {
  // ... existing fields ...
  ...(body.debug ? {
    source_candidate_counts: sourceDebugSummary,
    seeds_used: body.seed_tmdb_ids,
    genre_filter_applied: body.genre_ids?.length ? body.genre_ids : null,
    candidates_before_genre_filter: scored.length,
    candidates_after_genre_filter: genreFiltered.length,
    candidates_after_personalization_filter: personalizationFiltered.length,
  } : {}),
},
```

**Note on score breakdown:** `suggestByOverlap` in `enrich.ts` would need to attach a `scoreBreakdown` object to each result. This is a deeper change — add it after confirming the other debug fields work first. The breakdown would look like:
```typescript
scoreBreakdown: {
  genre: genreScore,
  director: directorScore,
  keyword: keywordScore,
  actor: actorScore,
  studio: studioScore,
  recent_boost: recentBoost,
  cross_genre: crossGenreBoost,
  penalties: totalPenalty,
  context: contextDelta,
  quality_multiplier: qualityMultiplier,
}
```

**MCP change — add `debug_mode` parameter to `ls_suggest_movies`:**

```typescript
// Add to suggestMoviesSchema:
debug_mode: z
  .boolean()
  .default(false)
  .describe("When true, returns source candidate counts, filter pipeline stats, and seed details in output."),
```

Pass `debug: debug_mode` in the POST body:
```typescript
const generateResp = await apiPost<...>("/suggestions/generate", {
  seed_tmdb_ids: seedIds.map((s) => s.id),
  limit: count,
  exclude_tmdb_ids: excludeTmdbIds,
  ...(genre_filter && TMDB_GENRE_IDS[genre_filter.trim().toLowerCase()] != null
    ? { genre_ids: [TMDB_GENRE_IDS[genre_filter.trim().toLowerCase()]] }
    : {}),
  ...(debug_mode ? { debug: true } : {}),
});
```

When `debug_mode` is true, add a debug section to the output:
```typescript
if (debug_mode && meta?.source_candidate_counts) {
  const sourceCounts = Object.entries(meta.source_candidate_counts as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .map(([src, count]) => `  ${src}: ${count}`)
    .join('\n');

  lines.push(
    "### 🔍 Debug: Candidate Sources",
    "```",
    sourceCounts,
    "```",
    `*Total before genre filter: ${meta.candidates_before_genre_filter ?? '?'}*`,
    `*After genre filter: ${meta.candidates_after_genre_filter ?? '?'}*`,
    `*After personalization filter: ${meta.candidates_after_personalization_filter ?? '?'}*`,
    `*Seeds sent: [${(meta.seeds_used as number[] ?? []).join(', ')}]*`,
    "",
  );
}
```

---

### Tool 4: Enhance `ls_get_admin_diagnostics` with engine health

**Backend change:** Add engine state data to the existing admin diagnostics endpoint (`src/app/api/v1/admin/diagnostics/route.ts`):

```typescript
// Add to the Promise.all batch:
db.from("user_taste_profile_cache")
  .select("user_id, film_count, computed_at")
  .eq("user_id", auth.userId)
  .maybeSingle(),

db.from("user_feature_feedback")
  .select("*", { count: "exact", head: true })
  .eq("user_id", auth.userId),

db.from("suggestion_exposure_log")
  .select("*", { count: "exact", head: true })
  .eq("user_id", auth.userId),
```

Add to response:
```typescript
engine_health: {
  taste_profile_cached: !!tasteProfileRow,
  taste_profile_age_hours: tasteProfileRow
    ? Math.round((Date.now() - new Date(tasteProfileRow.computed_at).getTime()) / 3600000)
    : null,
  taste_profile_film_count: tasteProfileRow?.film_count ?? null,
  feedback_signal_count: feedbackCount ?? 0,
  exposure_log_count: exposureCount ?? 0,
}
```

**MCP update to `ls_get_admin_diagnostics`:** Display the engine health block:
```
### Engine Health
- Taste profile: ✅ Cached (4h old, built from 1206 films)
- Feedback signals: 47 accumulated
- Exposure log: 892 entries (repeat penalty data)
```

---

## Summary of New Capabilities

| What I can diagnose now | Tool |
|------------------------|------|
| "Why is The Devil Wears Prada scoring 51?" | `ls_get_taste_profile_detail` — see Drama weight = 8 (cap), confirms genre-only match |
| "Is the engine treating Friedkin as a strong signal?" | `ls_get_taste_profile_detail` — see `William Friedkin · weight: 7.2 · ×5` |
| "Is keyword learning working?" | `ls_get_taste_profile_detail` — see neo-noir, film noir, murder as top TF-IDF keywords |
| "Why does blocking films not seem to change results?" | `ls_get_feature_feedback` — see if blocks are registering as avoid signals |
| "How many candidates came from each source?" | `ls_suggest_movies debug_mode=true` — see `similar:38985: 18, trending-week: 10` |
| "How many candidates survived the genre filter?" | `ls_suggest_movies debug_mode=true` — pipeline stats in output |
| "Is the taste profile stale?" | `ls_get_admin_diagnostics` — engine health block |
| "Are there enough feedback signals for learning to work?" | `ls_get_admin_diagnostics` — feedback_signal_count |

---

## Build Order

1. **Backend first** — create the two new route files, update diagnostics route, update generate route for debug mode
2. **MCP second** — add three new tools + debug_mode param to suggest + update admin diagnostics display
3. **Bump MCP to v1.3.2**

No schema changes, no migrations needed. All reads from existing tables (`user_taste_profile_cache`, `user_feature_feedback`, `suggestion_exposure_log`).
