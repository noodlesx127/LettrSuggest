# Recommendation Algorithm Deep Dive

**Date:** 2026-07-19  
**Scope:** Read-only review of recommendation quality, personalization data flow, historical fixes, tests, production aggregate health, and adjacent risks  
**Code reviewed:** `main` at `9bd85be`  
**Verdict:** Changes requested. The generic-output problem is real and has multiple direct causes. Further weight tuning should stop until the engine is made deterministic, consolidated, and testable.

## Executive Summary

The recommendation system is not suffering from one bad weight. It has a structural reliability problem:

- Two materially different production candidate engines feed one very large shared scorer.
- The v1 API reverses some learned negative feature feedback into positive preferences.
- Several retrieval and reranking stages systematically favor broad, mainstream candidates.
- Random sampling and random pre-scoring truncation make output unstable and make prior fixes difficult to evaluate.
- Some features described as completed are inactive, ineffective, or wired differently between the web and API paths.
- The project has no automated ranking-quality regression suite for the generation endpoint.

The strongest direct explanations for generic or non-responsive recommendations are:

1. The v1 API interprets any positive numeric preference probability as positive, including probabilities below `0.5` that represent net-negative feedback.
2. The v1 API always applies a generic `background` viewing prior that boosts shorter English-language crowd-pleasers and penalizes horror, crime, and long films.
3. Web candidates are shuffled and truncated before personalization scoring, so high-intent candidates can be discarded randomly while generic candidates survive.
4. Repeated recommendations from the same provider are counted as independent multi-source consensus, favoring broadly popular films.
5. Explicit API seeds do not generate recommendation neighborhoods and can instead have no influence or be returned as the answer.
6. API recency selection is reversed, causing old taste to be treated as recent taste.
7. Hard global diversity caps and a fixed niche interleave alter ranking without backfill or score-aware constraint relaxation.

This review also found a separate critical security issue: production currently allows `PUBLIC`, `anon`, and `authenticated` roles to execute multiple `SECURITY DEFINER` functions that trust caller-supplied user IDs. Publicly callable deletion routines were also identified by Supabase security advisors. This requires emergency remediation independently of recommendation work.

## Recommended Decision

Do not begin with another round of score-cap, threshold, or blacklist changes.

The next effort should first:

1. Secure the exposed database routines.
2. Fix the proven correctness defects in feedback polarity, metadata alignment, seed behavior, and recency ordering.
3. Select one canonical generation pipeline and make it deterministic under test.
4. Build fixture-based ranking tests and production score/drop telemetry.
5. Only then recalibrate retrieval, scoring, diversity, and exploration using measured outcomes.

## Review Method

The audit used:

- Codebase graph discovery and call tracing for production entry points and dependencies.
- Direct source review of the web, v1 API, candidate generation, aggregation, scoring, calibration, filtering, imports, and migrations.
- Git history review of the April 2026 recommendation fixes.
- Review of conventional tests and diagnostic scripts.
- Read-only production aggregate SQL and Supabase advisor checks on 2026-07-19.
- Three independent read-only review passes covering scoring/candidates, personalization/data, and fix history/tests.

No application code, database data, schema, policies, or functions were changed during this review.

## Production Architecture

### Web `/suggest` Path

The visible web UI does use the multi-source aggregator. Its path is:

1. `src/app/suggest/page.tsx` loads films, mappings, feedback, blocked IDs, exposure state, and supporting metadata.
2. The page builds a taste profile and weighted history, watchlist, saved, and subgenre seed inputs.
3. `src/lib/trending.ts:generateSmartCandidates` dynamically invokes the server action `getAggregatedRecommendations`.
4. `src/app/actions/recommendations.ts:getAggregatedRecommendations` calls `src/lib/recommendationAggregator.ts:aggregateRecommendations`.
5. The aggregator requests TMDB, TasteDive, Watchmode, and vector candidates, then merges source evidence.
6. The page adds more discovery, list, decade, hidden-gem, and exploratory candidates.
7. The combined pool is deduplicated, randomly shuffled, and truncated before scoring.
8. `src/lib/enrich.ts:suggestByOverlap` enriches, filters, scores, reranks with MMR, applies diversity caps, and interleaves niche results.
9. `src/lib/calibration.ts` reorders the top result window.
10. The UI hydrates details, presents sections, and logs exposure/feedback.

### v1 API Generation Path

`POST /api/v1/suggestions/generate` uses a separate candidate engine:

1. `src/lib/serverSuggestionsEngine.ts:loadUserContext` loads films, mappings, feedback, blocks, exposures, and related state.
2. `buildTasteProfileServer` loads or builds a cached profile.
3. `generateServerCandidates` adds trending, genre discovery, and history-seed TMDB neighborhoods.
4. The route calls the same shared `suggestByOverlap` scorer.
5. The route applies discovery thresholds, genre filtering, negative filtering, and advanced filtering.
6. The route slices and serializes the requested result count.

The v1 API does not use the multi-source aggregator or vector source. A fix to the web aggregator can therefore leave API output unchanged, while a fix to `generateServerCandidates` can leave the visible web experience unchanged.

### Architectural Consequence

The shared scorer creates the appearance of one system, but candidate provenance and request semantics differ substantially. Historical summaries and fixes frequently refer to "the recommendation algorithm" without specifying which entry point they affect. This is a major reason fixes can be technically present while users continue to report the same problem.

## Findings Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Critical | v1 feedback polarity inversion | Proven; production data affected |
| 2 | High | Explicit API seeds do not seed neighborhoods | Proven |
| 3 | High | API recent-taste ordering is reversed | Proven |
| 4 | High | Failed metadata fetches misalign films and features | Proven |
| 5 | High | Same-provider duplicates create false consensus | Proven |
| 6 | High | API always applies generic background prior | Proven |
| 7 | High | Genre filtering fails open | Proven |
| 8 | High | Web randomizes and truncates before scoring | Proven |
| 9 | High | Global diversity caps underfill result requests | Proven |
| 10 | Medium-high | Calibration cannot change top-window composition | Proven |
| 11 | Medium-high | Niche quota is wrong and breaks score order | Proven |
| 12 | Medium-high | Vector source is inactive; cache semantics are lossy | Production-confirmed and proven latent defect |
| 13 | Medium-high | Seed weights are discarded | Proven |
| 14 | Medium | Exploration-to-MMR mapping appears reversed | Proven semantic contradiction |
| 15 | Medium | Taste-profile cache invalidation is incomplete | Proven latent risk |
| 16 | Medium | Global weak-seed blacklist encodes one taste profile | Proven |
| 17 | Medium | API input failures silently become generic output | Proven |
| 18 | Medium | Advanced-filter boosts are discarded | Proven |
| 19 | Medium | Negative keyword matching is case-sensitive | Proven |
| 20 | Medium | Unseeded randomness prevents reproducible quality | Proven |

## Detailed Algorithm Findings

### 1. Critical: v1 API Reverses Negative Feature Feedback

**Evidence**

- `src/lib/serverSuggestionsEngine.ts:141-170`
- `src/lib/serverSuggestionsEngine.ts:418-510`
- `src/lib/enrich.ts:1052-1089`
- `src/lib/enrich.ts:1718-1753`

`isPositivePreference()` treats every finite numeric value greater than zero as positive. The current writers store `inferred_preference` as a Bayesian probability:

```text
(positive_count + 1) / (positive_count + negative_count + 2)
```

That value is on a `0..1` scale. A value such as `0.2` is evidence of a negative preference, not a positive preference. The API currently classifies it as positive.

**Production evidence**

The production aggregate contained 1,723 feature-feedback rows:

| Probability range | Rows | Current API interpretation |
|---|---:|---|
| `p > 0.5` | 1,335 | Positive |
| `0 < p < 0.5` | 130 | Incorrectly positive |
| `p = 0.5` | 16 | Positive/ambiguous rather than neutral |
| `p <= 0` | 242 | Negative |

Net-negative rows existed for keywords, actors, directors, subgenres, genres, and collections.

**Impact**

The API can boost features the user repeatedly rejected. This is a direct correctness failure, not a calibration preference, and can make feedback appear ineffective or make recommendations move in the wrong direction.

**Recommendation**

Derive direction from `positive_count - negative_count`, or use explicit probability thresholds with a neutral band around `0.5`. Use one canonical conversion function in all paths and add boundary tests for negative, neutral, and positive evidence.

### 2. High: Explicit API Seeds Do Not Seed Recommendation Neighborhoods

**Evidence**

- `src/lib/serverSuggestionsEngine.ts:782-797`
- `src/lib/serverSuggestionsEngine.ts:799`
- `src/lib/serverSuggestionsEngine.ts:863-892`
- `src/app/api/v1/suggestions/generate/route.ts:273-279`

Request `seed_tmdb_ids` are inserted as candidate films. TMDB recommendation and similar requests use only `topSeedTmdbIds`, which are derived from the user's history.

The route also does not exclude the requested seed IDs from its output.

**Impact**

- A watched explicit seed is later removed by the scorer's watched-film exclusion, so its effective influence can be zero.
- An unwatched explicit seed can be returned as the recommendation instead of producing films like the seed.
- API metadata can report seed bias even when the candidate neighborhood is unchanged.

**Recommendation**

Use explicit seeds as high-intent retrieval seeds, merge them deterministically with history seeds, and always exclude the seed films themselves from final results unless the API explicitly supports a different mode.

### 3. High: API Recency Is Reversed

**Evidence**

- `src/lib/serverSuggestionsEngine.ts:546-553`
- `src/lib/enrich.ts:5403-5412`
- `src/lib/enrich.ts:5764-5772`

`loadUserContext()` orders films newest first. `suggestByOverlap()` assumes the newest films are at the end of the array and uses `slice(-20)` for recent likes. It also uses `slice(-1500)` when limiting large profiles.

**Impact**

The API labels the user's oldest liked films as recent. For large profiles it retains the oldest 1,500 rather than the newest 1,500. Current taste is suppressed while stale interests receive recency boosts.

**Recommendation**

Define an explicit ordering contract at the scorer boundary. Prefer named helpers such as `newestLikedMovies` over positional assumptions, and test both ascending and descending source order.

### 4. High: Failed Metadata Fetches Misalign Films, Ratings, and Features

**Evidence**

- `src/lib/enrich.ts:5423-5454`
- `src/lib/enrich.ts:5657-5662`
- `src/lib/enrich.ts:5713-5726`

Failed metadata results are filtered out only from `likedFeats`. Later loops use the compacted feature index to read from the original unfiltered `likedMovies` and `likedIds` arrays.

**Impact**

One failed metadata request shifts every later feature bundle onto the wrong movie and rating. Feature weights, contributing-film evidence, and displayed reasons can all be corrupted. A transient cache or API failure therefore changes the meaning of later rows instead of merely dropping one film.

**Recommendation**

Carry `{ movie, tmdbId, details, features }` as one tuple and filter tuples atomically. Add a regression test with a failure in the middle of the input list.

### 5. High: Same-Provider Duplicates Create False Multi-Source Consensus

**Evidence**

- `src/lib/recommendationAggregator.ts:399-435`
- `src/lib/recommendationAggregator.ts:499-521`
- `src/lib/recommendationAggregator.ts:528-632`

`mergeRecommendations()` appends each source occurrence. TMDB can emit the same film once per seed, each occurrence labeled as TMDB. Consensus level and bonus use raw `rec.sources.length` rather than distinct provider families.

**Impact**

A mainstream film appearing in several TMDB neighborhoods is treated as if multiple independent providers agreed on it. This creates an artificial popularity signal and can outrank a niche film supported by genuinely independent sources.

**Recommendation**

Deduplicate evidence by provider family before computing consensus. Preserve within-provider repeat count as a separate, capped feature rather than an independent-source count.

### 6. High: v1 API Forces a Generic Background-Viewing Prior

**Evidence**

- `src/app/api/v1/suggestions/generate/route.ts:402-405`
- `src/lib/enrich.ts:5118-5144`

Every v1 generation request uses `context.mode = "background"`. The scorer then boosts 80-115 minute runtimes, crowd-pleasers, and English-language films while penalizing long films, horror, and crime.

**Impact**

The API systematically favors easy, mainstream English-language viewing regardless of user taste or request intent. This is one of the clearest direct causes of generic output.

**Recommendation**

Default to a neutral context. Accept an explicit context only when the caller supplies it, and report the applied context in diagnostics.

### 7. High: Genre Filtering Fails Open

**Evidence**

- `src/app/api/v1/suggestions/generate/route.ts:425-445`
- `src/app/api/v1/suggestions/generate/route.ts:447-463`

If the requested genre removes every result, the route returns the unfiltered result set. If a score threshold leaves fewer than three results, the threshold is abandoned.

**Impact**

A successful response can violate explicit request intent and return generic, unrelated genres. The caller cannot reliably treat `genre_ids` as a filter.

**Recommendation**

Return an empty result with a structured reason, or make fallback an explicit request option. Never silently reinterpret a strict filter.

### 8. High: Web Candidate Truncation Discards Relevance Before Scoring

**Evidence**

- `src/app/suggest/page.tsx:2021-2029`
- `src/app/suggest/page.tsx:2054-2066`

The web path concatenates personalized and generic sources, deduplicates them, randomly shuffles the full pool, and truncates it to 1,000 or 2,000 before `suggestByOverlap()` scores candidates.

**Impact**

Strong seed, saved, subgenre, director, or consensus candidates can be dropped by chance while generic discovery candidates survive. This also makes identical user state produce different recommendations.

**Recommendation**

Reserve deterministic quotas by source and intent, retain the highest-evidence candidates first, and limit random exploration to a labeled exploration partition.

### 9. High: Hard Diversity Caps Underfill Large Requests

**Evidence**

- `src/lib/enrich.ts:4507-4649`
- `src/lib/enrich.ts:7761-7768`
- `src/app/suggest/page.tsx:2190-2203`

The final list is globally constrained to low counts such as five films per primary genre, eight per decade, three per director, and four per studio or actor. Rejected candidates are not restored through constraint relaxation. The web path requests up to 600 results.

**Impact**

The requested count is often mathematically unattainable. Sections can be underfilled, and candidates with incomplete metadata can receive an accidental advantage because they evade some constraints.

**Recommendation**

Apply strong diversity constraints only to the visible top window. Relax constraints in documented stages and backfill from the best remaining candidates until the requested count is satisfied.

### 10. Medium-high: Calibration Cannot Change Composition

**Evidence**

- `src/lib/calibration.ts:246-337`
- `src/lib/calibration.ts:368-422`

Calibration takes `candidates.slice(0, targetCount)` as its entire pool and then selects `targetCount` candidates. The caller passes the original top 20 and appends everything else unchanged.

**Impact**

Every member of the original top 20 remains in the top-20 set. Calibration can reorder that set but cannot replace an overrepresented genre with a candidate ranked below 20. The before/after genre composition is invariant.

**Recommendation**

Calibrate a larger pool, such as the top 100, into the target display window. Add a test that proves membership changes when the uncalibrated top set is imbalanced.

### 11. Medium-high: Niche Quota Is Incorrect and Breaks Score Order

**Evidence**

- `src/lib/enrich.ts:7770-7798`

The code says it ensures at least 35% niche content, but inserts one niche film after every two mainstream films, yielding about 33.3%. It splits the ranked list into queues and forces the pattern regardless of relative score.

**Impact**

Highly personalized niche matches can be moved below weaker mainstream results, while the stated quota still is not achieved.

**Recommendation**

Use score-aware constrained reranking with an explicit quota over a defined top-N window. Measure the actual resulting ratio.

### 12. Medium-high: Vector Similarity Is Inactive and Its Cache Is Lossy

**Evidence**

- `src/lib/vectorSimilarityCache.ts:6-41`
- `src/lib/recommendationAggregator.ts:947-969`
- `src/lib/recommendationAggregator.ts:1004-1032`

The web path can reach vector retrieval through the aggregator, but production contains zero `movie_embeddings` rows and zero `vector_similarity_cache` rows. The source currently contributes no results.

If populated, the cache stores only IDs. Cache hits assign every item similarity `0`, rank largely by repeated occurrence across seeds, and emit constant confidence `0.8`.

**Impact**

The semantic source is operationally inactive. If enabled as implemented, cached ranking will differ from uncached ranking and favor common neighbors rather than the strongest vector matches.

**Recommendation**

Make an explicit go/no-go decision. If retained, backfill embeddings with model/version metadata, cache similarity scores, and add cached-versus-uncached parity tests. Otherwise remove the inactive source from quality claims and diagnostics.

### 13. Medium-high: Seed Weighting Is Discarded

**Evidence**

- `src/lib/trending.ts:910-1010`
- `src/lib/trending.ts:1012-1044`
- `src/lib/recommendationAggregator.ts:533-541`
- `src/lib/recommendationAggregator.ts:678-686`
- `src/lib/recommendationAggregator.ts:947-953`

Saved and subgenre seeds receive weights of `1.5` and `1.8`, but only IDs are passed to the aggregator. TMDB, TasteDive, and vector retrieval then independently resample seed subsets.

**Impact**

High-intent seeds are not reliably used. Provider subsets diverge, reducing true cross-provider agreement and increasing run-to-run variation.

**Recommendation**

Pass weighted seed objects through the entire retrieval boundary. Select one deterministic or stratified seed set and share it across providers, with explicit per-provider exceptions where required.

### 14. Medium: Exploration-to-MMR Mapping Appears Reversed

**Evidence**

- `src/app/suggest/page.tsx:2137-2158`
- `src/app/api/v1/suggestions/generate/route.ts:380-386`
- `src/lib/enrich.ts:4652-4675`

Higher `exploration_rate` produces a higher MMR lambda. In the local MMR implementation, higher lambda means more relevance and less diversity.

**Impact**

If `exploration_rate` means willingness to explore, users who favor exploration receive less diversity, while conservative users receive more.

**Recommendation**

Confirm the product meaning of the field, then invert or rename the mapping. Add endpoint tests at minimum, midpoint, and maximum values.

### 15. Medium: Taste-Profile Cache Invalidation Is Too Weak

**Evidence**

- `src/lib/serverSuggestionsEngine.ts:690-713`

The v1 profile cache remains valid for 24 hours when the film row count is unchanged. Ratings, likes, dates, watchlist membership, mappings, blocks, quiz answers, and feature feedback can all change without changing the row count.

Production currently has zero taste-profile cache rows, so this defect is latent rather than responsible for current production output.

**Recommendation**

Use a profile-input revision or hash covering every contributing table and metadata version. Invalidate explicitly after feedback, import, mapping, quiz, and block operations.

### 16. Medium: Global Weak-Seed Blacklist Encodes One User's Taste

**Evidence**

- `src/lib/serverSuggestionsEngine.ts:10-21`
- `src/lib/serverSuggestionsEngine.ts:265-288`

The server globally excludes *Lost in Translation*, *Looper*, *Ad Astra*, *EuroTrip*, and *Warfare* from automatic seed selection. Comments describe their fit for a particular profile rather than a provider-wide technical failure.

**Impact**

A highly diagnostic favorite for one user is silently ignored for every user. The list is a symptom workaround and applies only to one candidate path.

**Recommendation**

Remove the global taste blacklist. Learn seed effectiveness by user and provider, and retain only a narrowly justified technical denylist if a provider endpoint is demonstrably broken.

### 17. Medium: API Input Failures Silently Become Generic Results

**Evidence**

- `src/lib/serverSuggestionsEngine.ts:593-671`
- `src/lib/serverSuggestionsEngine.ts:807-841`
- `src/app/api/v1/suggestions/generate/route.ts:523-543`

User-context query errors are logged and converted to empty arrays or an empty context. Candidate generation still supplies trending content, and response metadata reports the engine as personalized.

**Impact**

Database, RLS, or timeout failures are indistinguishable from a legitimate cold start. Users receive generic output while the system claims personalization succeeded.

**Recommendation**

Track input health and minimum viable profile counts. Return a structured degraded status and failed-input reasons. Do not label the response personalized when required inputs failed.

### 18. Medium: Advanced-Filter Boosts Are Calculated and Discarded

**Evidence**

- `src/lib/advancedFiltering.ts:25-86`
- `src/app/api/v1/suggestions/generate/route.ts:477-483`

`applyAdvancedFiltering()` returns both `shouldFilter` and a cross-genre `boost`. The route uses only `shouldFilter` and never applies the boost to ranking.

**Impact**

Documented cross-genre preference behavior is inactive in the v1 ranking path.

**Recommendation**

Either apply the boost in a single scoring stage or remove it from the filtering API. Avoid split score mutation across route-level post-processing.

### 19. Medium: Negative Keyword Matching Is Case-Sensitive

**Evidence**

- `src/lib/advancedFiltering.ts:92-123`
- `src/app/api/v1/suggestions/generate/route.ts:190-193`

The API profile normalizes avoided keyword names to lowercase. Candidate keyword strings are compared directly without equivalent normalization.

**Impact**

Intended negative keyword filters can miss because of capitalization differences.

**Recommendation**

Normalize identifiers and display names at ingestion, and compare canonical IDs where possible.

### 20. Medium: Unseeded Randomness Prevents Reproducible Quality

Randomness affects:

- Server seed shuffling.
- Daily versus weekly trending choice.
- Discovery pages.
- Aggregator seed subsets.
- Web candidate ordering and truncation.

**Impact**

The same profile can produce materially different candidates before scoring. A reported improvement or regression cannot be reliably reproduced, and A/B attribution is weakened.

**Recommendation**

Use a request-scoped seeded RNG derived from user, engine version, and experiment bucket. Log the seed and selected candidate-source inputs. Reserve unseeded exploration for an explicitly measured exploration channel.

## Additional Quality Risks

These observations are supported by source behavior but require user-level outcome data to quantify their effect:

- Broad OR-based genre/keyword discovery creates large pools of merely related candidates and can overwhelm precise sources.
- Positive thresholds differ across profile construction, calibration, candidate generation, and overlap scoring (`3.0`, `3.5`, and `4.0` appear in different contexts).
- Cast and other familiar-name signals can be counted through multiple legacy and enhanced score paths.
- Primary-genre diversity depends on `genres[0]`, which may not represent the user's strongest reason for a match.
- Watchlist intent is contradictory: watchlist-derived signals can influence scoring, while watchlist films are also removed from the main candidate set, and the API does not expose a clear separate watchlist result contract.
- Signature-film logic exists in `src/lib/trending.ts` but is not the seed scorer used by the primary v1 path.
- Planned diary-based exponential temporal decay is not implemented as a general profile-weighting model.
- Candidate metadata completeness is validated in some cache paths but not refreshed consistently at every candidate boundary.

## Production Data Health

Read-only production aggregate checks on 2026-07-19 found:

| Metric | Result |
|---|---:|
| Users with film data | 2 |
| Average TMDB mapping coverage | 99.39% |
| Minimum mapping coverage | 98.78% |
| Maximum mapping coverage | 100% |
| TMDB cache rows | 10,542 |
| Cache rows with credits and keywords | 10,539 |
| Suggestion exposures | 2,909 |
| Suggestion feedback rows | 123 |
| Pairwise feedback rows | 33 |
| Quiz rows | 119 |
| Reason-preference rows | 13 |
| Exploration-stat rows | 2 |
| Raw diary rows | 405 |
| Movie embeddings | 0 |
| Vector similarity cache rows | 0 |
| Taste-profile cache rows | 0 |

### Interpretation

The current generic-output problem is not explained by broad production mapping failure or generally incomplete TMDB feature data. Mapping and profile-critical cache coverage are high.

The vector source and taste-profile cache are currently inactive in production. Defects in those areas remain important before activation but should not be cited as current causes of production ranking behavior.

The production-confirmed feedback polarity data, however, demonstrates that the API is currently applying incorrect learned preference direction to real records.

## Adjacent Import and Data Findings

### High: Browser Import State Is Not Scoped by User

**Evidence:** `src/lib/importStore.tsx:14-150`

One localStorage key, `lettr-import-v1`, is shared across users. Loading chooses whichever local or cloud collection has more rows. It runs only on mount and has no auth-state transition handling.

**Impact:** Two users sharing one browser can receive each other's local film library. Stale or anonymous data can override the authenticated user's cloud state, causing privacy leakage and incorrect personalization.

### High: Import Can Claim Completion After Persistence or Mapping Failure

**Evidence:**

- `src/app/import/page.tsx:188-259`
- `src/app/import/page.tsx:507-511`
- `src/app/import/page.tsx:665-713`
- `src/app/import/page.tsx:788-793`

Cloud-save and auto-mapping errors are caught without reliably failing the workflow. A successful retry can still encounter stale `lastError`. The UI can advance and claim personalized recommendations are ready without complete persistence or enrichment.

### High: Reimports Do Not Reconcile Removed Rows

**Evidence:** `src/app/import/page.tsx:203-223`

Imports upsert the current rows but do not remove or deactivate cloud rows absent from a new full export. The local store can later prefer the larger stale cloud set.

**Impact:** Removed history and watchlist signals can reappear and continue influencing recommendations.

### Medium: Watchlist Recency Is Lost

**Evidence:**

- `src/lib/normalize.ts:117-129`
- `src/app/import/page.tsx:203-215`
- `src/lib/importStore.tsx:90-100`
- `src/lib/serverSuggestionsEngine.ts:728-733`
- `src/app/api/v1/suggestions/generate/route.ts:349-354`

`watchlistAddedAt` is parsed but not persisted or restored. Server paths substitute `last_date`, which is not equivalent.

### Medium: Diary and Review Rows Can Double-Count Watches

**Evidence:** `src/lib/normalize.ts:55-108`, `src/lib/normalize.ts:139-152`

Diary and review inputs independently increment watch count without deduplicating a shared watch event.

### Medium: Blank Years Become Year Zero

**Evidence:** `src/lib/normalize.ts:21-24`

`Number("")` returns `0`, so blank years are accepted as year zero rather than null.

## Critical Security Finding

This issue is adjacent to the algorithm review but is more urgent than recommendation quality.

### Publicly Executable `SECURITY DEFINER` Functions Trust Caller IDs

**Evidence**

- `supabase/migrations/20260405234351_fix_security_advisors.sql:14-45`
- `supabase/migrations/20260405234351_fix_security_advisors.sql:88-104`

`add_liked_suggestion(p_user_id, ...)` and `get_film_stats(p_user_id)` execute with definer privileges, accept arbitrary user IDs, and do not enforce `auth.uid() = p_user_id`.

Production privilege checks confirmed that both functions are executable by:

- `PUBLIC`
- `anon`
- `authenticated`

Supabase security advisors also identified publicly callable definer routines including `admin_delete_user_data(target_user_id, scope)` and `delete_user_data(target_user_id)`. These are especially serious arbitrary cross-user deletion candidates unless authorization is enforced inside the functions.

**Required action**

1. Revoke `PUBLIC` and `anon` execute privileges from all security-definer routines unless anonymous execution is explicitly required and safe.
2. Derive the effective user from `auth.uid()` rather than trusting a caller parameter.
3. Enforce explicit admin/self authorization inside every privileged routine.
4. Audit every effective production overload and grant, not only the latest migration source.
5. Enable leaked-password protection in Supabase Auth.

Supabase advisor references:

- [Anonymous access to security-definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Authenticated access to security-definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_auth_security_definer_function_executable)

No security changes were made as part of this read-only review.

## Historical Fix Review

Recent history shows repeated valid symptom fixes without a stable evaluation foundation:

| Commit | Change theme | Remaining concern |
|---|---|---|
| `9345283` | Higher positive threshold, base-score removal, niche/diversity changes | Increased dependence on metadata and threshold consistency |
| `f095cab` | Replaced API aggregator flow with `serverSuggestionsEngine` | Created a major production architecture fork |
| `27b0c71` | Preloading, diversity limits, vote-average discovery, seed randomization | Improved latency but reduced reproducibility |
| `3b7cb11` | Timeout and candidate-limit fixes | No ranking-quality regression suite |
| `a392e96` | Genre/advanced/negative filter wiring and Watchmode similar titles | Genre fail-open and discarded advanced boost remain |
| `0f2a42e` | Feature caps and reduced consensus bonus | False same-provider consensus remains |
| `17edede` | TMDB endpoint and discovery-threshold changes | Candidate contract remains heuristic |
| `ed0efd2` | Feedback and subgenre quality changes | v1 feedback polarity conversion remains incorrect |
| `3050135` | Weak-seed blacklist and subgenre thresholds | Global taste-specific exception list |
| `5c9df3a` | Discovery score threshold and subgenre filtering | Threshold lacks deterministic fixture validation |
| `9a8d611` | Query caps and another weak seed | More symptom patching |

### Patch-on-Patch Pattern

Candidate retrieval moved through `/similar`, `/recommendations`, fallback restoration, weak-seed exclusions, discovery thresholds, popularity changes, and source caps. Scoring moved through base-floor removal, repeated feature caps, consensus reduction, diversity tightening, niche quotas, and more blacklists.

Each change can be locally reasonable, but there is no deterministic benchmark proving that the combined system improves personalization. The system admits broad candidates and then relies on many downstream corrections to repair the mixture. This is difficult to reason about and creates interactions that a single threshold change cannot safely control.

### Documentation Drift

Existing summaries contain claims that are no longer reliable as current architecture statements:

- The older recommendation summary reports percentage improvements without a reproducible benchmark.
- It describes one algorithm even though web and API candidate engines diverged later.
- The suggestion-quality summary calls seed shuffling deterministic, but Fisher-Yates using unseeded randomness is not deterministic.
- Advanced filtering is described as wired, but its returned boost is ignored by the API route.
- Vector similarity is described as implemented but production contains no embeddings and the API does not use the aggregator.
- Calibration is described as an advanced feature, but current calibration cannot change top-window composition.

Future documentation should name the engine and version associated with every behavior claim.

## Test and Verification Gaps

### Conventional Tests

The only conventional test file found is `tests/api-v1.spec.ts` at 838 lines. It covers authentication, response envelopes, CRUD operations, and several basic API endpoints. It does not test `POST /api/v1/suggestions/generate`.

No automated tests were found for:

- Feedback polarity conversion.
- Explicit seed influence and seed exclusion.
- Source deduplication and distinct-provider consensus.
- Failed-fetch tuple alignment.
- Recency ordering.
- Exploration-to-MMR mapping.
- Diversity constraint relaxation and requested-count fulfillment.
- Niche quota enforcement.
- Calibration membership changes.
- Genre-filter fail-open behavior.
- Profile-cache invalidation.
- Cached and uncached vector parity.
- Deterministic output under a fixed profile and request seed.

### Diagnostic Scripts

`scripts/verify_algo.ts:1-93` is a print-only mock diagnostic. It does not make assertions or return a failing process status, and it does not exercise production candidate generation, route filtering, source composition, or final ranking.

`scripts/counterfactual_replay.ts:37-56` substitutes a fabricated rank penalty for actual MMR behavior and accepts `originalLambda` without using it. It globally reranks exposure rows and joins feedback by movie ID rather than a specific exposure. It is a sensitivity analysis, not valid counterfactual replay evidence.

`scripts/test_signature_scoring.ts` and `scripts/verify_rewatch.ts` exercise isolated or reconstructed logic rather than asserting the active end-to-end production behavior.

## Observability Gaps

Current diagnostics do not provide a stable request-level explanation of how a movie traveled from retrieval to display.

Missing production telemetry includes:

- Engine name and version.
- Request-scoped random seed.
- Input health and row counts by personalization source.
- Mapping and complete-metadata coverage for the active request.
- Selected seed IDs, weights, and provenance.
- Candidate counts before and after each retrieval source, filter, and truncation stage.
- Distinct-provider consensus versus repeated same-provider evidence.
- Score components and applied multipliers.
- Pre- and post-MMR rank.
- Pre- and post-diversity rank and rejection reason.
- Calibration membership and rank changes.
- Cache hit, cache input revision, and metadata/model version.
- Personalized-source versus generic-source share in final results.
- Degraded versus legitimate cold-start state.

Without this telemetry, user reports of generic results cannot be tied to one stage, and previous fixes cannot be evaluated reliably.

## Root-Cause Model

The generic recommendation problem is best understood as five interacting classes of failure.

### 1. Incorrect Personalization Signals

Feedback polarity inversion, reversed recency, tuple misalignment, case-sensitive negatives, and lost watchlist dates can make the user's representation wrong even when the underlying data exists.

### 2. Generic Candidate Admission

Trending, broad discovery, generic fallbacks, forced background mode, and input-failure degradation admit or promote candidates that are weakly tied to the user.

### 3. Evidence Distortion

False source consensus, discarded seed weights, repeated score paths, hard interleaving, and fixed context multipliers make candidate evidence incomparable.

### 4. Non-Deterministic Pipeline Behavior

Independent provider sampling and random pre-scoring truncation make the candidate pool unstable before personalization is evaluated.

### 5. Missing Quality Controls

There is no generation-route test suite, deterministic ranking fixture, valid offline replay, or request-level score/drop trace. Repeated fixes therefore optimize anecdotes rather than a stable contract.

## Remediation Roadmap

### P0: Emergency Correctness and Security

1. Revoke unsafe execution grants and enforce identity inside all `SECURITY DEFINER` functions, prioritizing delete/write/read routines.
2. Fix feedback polarity conversion and establish a neutral range.
3. Preserve liked-film metadata as atomic tuples through failed fetches.
4. Make explicit seeds generate neighborhoods and exclude the seeds from results.
5. Remove the forced `background` context default or require explicit caller intent.
6. Correct the API recency-order contract.
7. Mark failed personalization input loads as degraded rather than personalized.

**P0 exit criteria**

- Negative feedback never enters positive feature sets.
- A middle metadata failure cannot shift another film's features or reasons.
- Explicit seed fixtures measurably alter retrieved candidates but never return the seed itself.
- Recent-film fixtures select the newest dated films regardless of source ordering.
- Anonymous users cannot invoke privileged cross-user data functions.
- Input query failure produces a clear degraded response, not silent trending output.

### P1: Stabilize One Recommendation Engine

1. Define one canonical request and response model for web and API generation.
2. Consolidate candidate retrieval behind that engine, or explicitly version separate products if their goals differ.
3. Pass weighted seed objects end to end.
4. Use one request-scoped deterministic seed selection across providers.
5. Compute consensus from distinct provider families.
6. Replace random pre-scoring truncation with source-aware retention and exploration quotas.
7. Make genre filters strict by default.
8. Apply diversity to a top-N window with staged relaxation and backfill.
9. Calibrate from a larger pool so composition can change.
10. Decide whether vector retrieval will be activated and supported or removed from active quality claims.

**P1 exit criteria**

- Web and API return the same ranked IDs for the same canonical fixture and engine version, unless a documented mode differs.
- Repeated runs with the same request seed are identical.
- Same-provider duplicates do not increase distinct-source consensus.
- Requested result counts are met when enough eligible candidates exist.
- Strict genre requests never silently return another genre.
- Calibration tests demonstrate membership changes, not only reordering.

### P2: Data Integrity, Evaluation, and Learning

1. Scope local import state to the authenticated user and reload on auth changes.
2. Reconcile full imports as snapshots or use import generations/tombstones.
3. Persist watchlist-added dates.
4. Deduplicate diary and review events.
5. Add score-component and drop-reason telemetry.
6. Build an offline user-split evaluation dataset.
7. Add exposure-level online metrics by engine, rank, source, and experiment bucket.
8. Revisit feature weights, thresholds, and learned source reliability only after the deterministic baseline exists.

## Evaluation Plan

### Deterministic Fixture Tests

Create small, human-readable profiles covering:

- Strong genre and subgenre preference.
- Strong actor/director preference.
- Explicit negative features.
- Recent taste shift.
- Sparse cold start.
- Broad long-term profile with a narrow current interest.
- Explicit seed request.
- Horror/crime preference that would expose background-mode bias.

For each fixture, freeze metadata and candidate-provider responses. Assert candidate inclusion, exclusion, relative ordering, score components, and final ranking under a fixed engine version and RNG seed.

### Offline Metrics

Measure:

- Holdout hit rate and NDCG by user.
- Negative-feature leakage rate.
- Explicit-seed neighborhood influence.
- Personalized-source share versus generic-source share.
- Distinct-source consensus precision.
- Catalog coverage and novelty.
- Intra-list diversity at the visible top-N.
- Genre-calibration distance from the user's profile.
- Rank stability under identical input.
- Requested-count fulfillment after diversity.

Report macro averages across users as well as per-user distributions. With only two production users containing film data, current production is too small for broad claims of percentage improvement.

### Online Metrics

Track by engine version, source, and rank:

- Interested, saved, watched, dismissed, and ignored rates.
- Pairwise win rate.
- Time to first positive action.
- Repeat exposure and repeat dismissal rate.
- Feedback response latency: whether a new signal changes the next eligible generation.
- Degraded request rate.
- Candidate and final-list personalized-source share.

Do not use raw acceptance rate alone. Position, repeated exposure, source availability, and missing feedback create strong bias.

## Acceptance Criteria for "Personalized"

A production response should not be labeled personalized unless:

1. Required user-context queries succeeded.
2. A minimum amount of mapped, feature-complete taste data was loaded or the response is explicitly marked cold start.
3. At least one user-specific retrieval or scoring signal contributed to each personalized result.
4. The score attribution identifies the dominant user-specific evidence.
5. Negative features were checked using the canonical preference direction.
6. The final-list personalized-source share meets a defined threshold.
7. Engine version, input revision, and request seed are recorded.

## Files Reviewed

Primary implementation:

- `src/app/suggest/page.tsx`
- `src/app/genre-suggest/page.tsx`
- `src/app/actions/recommendations.ts`
- `src/app/api/v1/suggestions/generate/route.ts`
- `src/lib/serverSuggestionsEngine.ts`
- `src/lib/trending.ts`
- `src/lib/recommendationAggregator.ts`
- `src/lib/enrich.ts`
- `src/lib/advancedFiltering.ts`
- `src/lib/calibration.ts`
- `src/lib/subgenreDetection.ts`
- `src/lib/counterProgramming.ts`
- `src/lib/vectorSimilarityCache.ts`

Import and data flow:

- `src/app/import/page.tsx`
- `src/lib/importStore.tsx`
- `src/lib/normalize.ts`
- `src/lib/db.ts`
- Relevant feedback, taste-cache, vector, exposure, and security migrations

Tests and scripts:

- `tests/api-v1.spec.ts`
- `scripts/verify_algo.ts`
- `scripts/verify_rewatch.ts`
- `scripts/test_signature_scoring.ts`
- `scripts/counterfactual_replay.ts`
- `scripts/generate-embeddings.ts`

Plans and historical summaries:

- `docs/plans/recommendation-algorithm-improvement-plan.md`
- `docs/plans/recommendation-evolution.md`
- `docs/plans/API_REFACTOR_PLAN.md`
- `docs/recommendation-best-practices.md`
- `docs/summary/recommendation-improvement-summary.md`
- `docs/summary/recommendation-research-summary.md`
- `docs/summary/BACKEND_BUGFIX_SUMMARY.md`
- `docs/summary/BACKEND_QUALITY_4_SUMMARY.md`
- `docs/summary/suggestion-quality-bugfix-2026-04-04.md`
- `docs/summary/signature-films.md`

## Limitations

- This was a source and aggregate-data audit, not a live user-session replay.
- Production contained only two users with film data, so user-level quality statistics would not support broad population claims.
- External recommendation providers were not called during this review.
- No destructive or state-changing security proof was attempted.
- No runtime code was changed, and no recommendation tests were added or executed because the request was review-only.
- Line numbers refer to `main` at `9bd85be` and may drift after later edits.

## Final Assessment

The long-running generic-recommendation issue persists because previous fixes mostly adjusted local symptoms inside an unstable system. Current production metadata coverage is healthy, so the earlier cache-completeness explanation is no longer sufficient. The remaining failures are primarily correctness, architecture, candidate-admission, and evaluation failures.

The immediate algorithm priority is not a better weight table. It is to make the user's signals correct, make retrieval deterministic, ensure every request runs through a clearly identified engine, and establish tests that prove personalization behavior before another tuning cycle.
