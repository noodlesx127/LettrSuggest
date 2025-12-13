# Adaptive & Suggestions Improvements (v2)

## Quick Wins (ship next)
- [x] Confidence-aware weighting: per-feature priors, decay old signals, cap total impact; expose strength badges (High/Med/Low)
- [x] Hard vs soft avoid: soft avoids now downrank dismissed titles instead of blocking outright; hard blocks remain via explicit block list (undo available)
- [x] Source reliability by user: weight TMDB/TasteDive/Trakt/etc. by each user's historical hit-rate; still honor multi-source consensus
- [x] Diversity rerank (MMR): small λ to trade score vs novelty (genres/decades/directors) after base scoring
- [x] Session sliders: "Freshness vs familiarity" and "Discovery vs safety" tweak overlap weights and exploration rate

## Progress Tracking

### Confidence & Weighting
- [x] Implemented confidence scaling + caps for feature feedback (actors/keywords/franchises)
- [x] Labeled hard vs soft avoid in `enrich.ts` (Pandora block)
- [x] Added source reliability multiplier using consensus + per-source priors and light reason text; capped to ±12%

### Reranking & Diversity
- [x] Added MMR rerank (λ=0.25, topK ~3x desired) before diversity filter to balance novelty vs relevance

### UI Badges & Controls
- [x] Surfaced consensus badge on movie cards to show confidence even when only one source is present
- [x] Added inline undo for dismissed suggestions (unblocks and keeps card in view)
- [x] Added dismiss undo toast (bottom-left) for quick recovery after "Not Interested"
- [x] UI: Reliability badge (per-user) shown alongside consensus/multi-source badges
- [x] Added persistent "Undo last feedback" control to restore most recent dismissed/blocked item
- [x] Added match strength badge (High/Solid/Exploratory) derived from consensus + reliability
- [x] Added session slider (Discovery vs Safety) wiring into MMR λ/topK for on-demand exploration tuning

### Source Reliability
- [x] Source hit-rate weighting: per-user reliability from feedback + source metadata (Laplace-smoothed) feeds scoring multiplier
- [x] Per-source reliability: feedback now stores contributing sources/consensus level; scoring pulls consensus-weighted per-source hit-rate multipliers (cached 5m)
- [x] Stats shows per-source hit rates
- [x] Per-source consensus split: Stats now breaks out hit-rate by consensus level per source (high/medium/low) when sufficient samples exist

### Watchlist & Intent
- [x] Watchlist intent depth: ingest Letterboxd watchlist added dates, apply recency + repetition boosts, decay stale entries in taste profile intent signals
- [x] Surface recency-tagged watchlist intent reasons when a saved title appears

### Context-Aware & Pairwise
- [x] Pairwise A/B prompt: surfaces near-tie suggestions and records winner/loser feedback to steer rankings faster
- [x] Context-aware mode: bias scoring by session (short/weeknight/immersive/family/background) with runtime/tone boosts and family-safe filters
- [x] Reason strength labels wired into core reasons (genres, combos, directors, cast, keywords) using High/Solid/Light text

### Stats Page
- [x] Stats page: added Watchlist Momentum (recency buckets, median/avg age)
- [x] Stats page: added Metadata Coverage + Consensus Strength cards to mirror quality gates and confidence
- [x] Stats page: added Pairwise Learning Stats section (total comparisons, 30d/90d activity, consensus-level wins, educational explainer)

---

## Near-Term (2–3 sprints)

### Pairwise Learning
- [x] First pass shipped (near-tie prompt + winner/loser logging)
- [x] Regularized feature-level updates from pairwise choices
- [x] Fixed pairwise session counter (now shows 1/3, 2/3, 3/3 correctly)
- [x] Fixed modal flow (shows all 3 comparisons before closing)
- [x] Fixed dismissed movies appearing in grid (both winner/loser hidden after choice)
- [x] Added pairwise stats to Stats page (total comparisons, recent activity, consensus breakdown)

### Context-Aware Learning
- [x] First-pass runtime/tone biases + family-safe filtering shipped
- [ ] Time-of-day/device/mood toggle to bias tone/runtime/language (advanced)

### Counter-Evidence Handling
- [x] Added unique constraint on (user_id, tmdb_id) to prevent duplicate feedback entries
- [x] Changed addFeedback to use upsert() - latest feedback wins on undo+redismiss
- [x] Store pos/neg counts per feature (actors/keywords/directors/genres/collections)
- [x] Use Bayesian win rate instead of netting signals

### Watchlist Intent
- [x] Shipped recency + repetition boosts with decay for stale items
- [x] Surfacing recency-tagged watchlist intent reasons when a saved title shows up

### Stats Alignment
- [x] Reflect new signals (watchlist intent, reliability/strength) on the Stats page
- [x] Done for intent recency + quality/consensus + overall hit-rate + per-source reliability (with sample threshold)
- [x] Consensus-level split per source

### Quality Gates
- [x] Downrank items missing posters/trailers/metadata unless strong consensus

---

## Medium-Term

### Collection Completion
- [ ] Use `findIncompleteCollections()` to boost missing entries
- [ ] Surface "Complete the X collection" reasons

### Intentional Exploration
- [ ] Bandit-style exploration that increases where confidence is low; clamp elsewhere

### Adjacent Feature Borrowing
- [x] Low-confidence features borrow small weight from similar actors/genres with strong evidence
- [x] Decay if unreinforced

### Suppression Explanations
- [ ] Show why hidden ("suppressed due to 3 superhero skips")
- [ ] Allow-today override

---

## UX/Reasons

- [x] Multi-select feedback reasons in popup (toggle chips + submit/skip) for More Like This / Not Interested
- [x] Reason strength + recency labels ("Learned from 4 signals, last 12d")
	- [x] Compute per-feature sample counts + decay windows exposed via feedback popup context
	- [x] Render badge inline on suggestion cards and popup to show strength + last-seen age
- [x] Fast corrections: one-tap "This is fine" to move avoid → neutral
- [x] Micro-surveys (rare): disambiguate repeated skips (actor vs tone vs runtime)

---

## Metrics & Evaluation

- [x] Track: acceptance by reason type, source hit-rate per user, diversity, repeat-suggestion rate, regret events (later-liked after skip)
	- [x] Acceptance by reason type surfaced on Stats (min 5 samples); consensus calibration card added
	- [x] Diversity coverage from accepted feedback (genres/directors/actors/keywords) and regret recovery surfaced
	- [x] Repeat-suggestion rate implemented with exposure logging and 30-day tracking on Stats page
- [x] Counterfactual replay: log top-k scores to simulate weight tweaks before shipping
	- [x] Implemented `suggestion_exposure_log` table to capture scoring metadata (base_score, consensus, sources, MMR params, metadata completeness)
	- [x] Added `getCounterfactualReplayData()` function to retrieve scored suggestions with feedback outcomes for parameter simulation
- [x] A/B specific knobs: MMR λ, exploration rate, source reliability scaling
	- [x] Created A/B testing infrastructure with `ab_test_configs`, `ab_test_assignments`, and `ab_test_metrics` tables
	- [x] Built `abTesting.ts` library with variant assignment, metric recording, and results aggregation
	- [x] Supports parameter variations for MMR lambda, exploration rate, source weights, quality gates, and diversity settings
- [x] Fixed pairwise learning stats showing 0's when comparisons exist
	- [x] Defaulting consensusLevel to 'low' when undefined (movies with single-source recommendations)
	- [x] Backfill migration for existing NULL consensus values in pairwise_events table

---

## Suggested Implementation Order (Updated)

1. ~~Confidence-aware weighting + hard/soft avoid + source reliability~~ ✅
2. ~~MMR rerank + UI strength badges + undo avoid~~ ✅
3. ~~Pairwise A/B feedback + context-aware biases~~ ✅ 
4. ~~Metrics & Evaluation (repeat-suggestion tracking, counterfactual replay, A/B testing)~~ ✅
5. quality gates + micro-surveys (next focus)

---

## Recent Completion (Dec 13, 2024)

### Metrics & Evaluation Infrastructure

Completed all tracking and A/B testing requirements:

#### 1. Suggestion Exposure Logging
- **Migration**: `20251213000000_suggestion_exposure_log.sql`
- **Features**:
  - Tracks every suggestion shown to users with full context
  - Captures base scores, consensus levels, contributing sources
  - Records MMR parameters, diversity rank, metadata completeness
  - Stores session context (discovery level, filters, mode)
- **Functions**: `logSuggestionExposure()` in `enrich.ts`
- **Integration**: Auto-logs on `suggest/page.tsx` when recommendations generated

#### 2. Repeat-Suggestion Rate Tracking
- **Function**: `getRepeatSuggestionStats()` in `enrich.ts`
- **Metrics**:
  - Total exposures vs unique suggestions (30-day lookback)
  - Repeat rate calculation
  - Average time between repeat showings
  - Top repeated suggestions list
- **UI**: New "Suggestion Diversity" card on Stats page
  - Shows total exposures, unique films, repeat percentage
  - Color-coded thresholds (green <10%, yellow <20%, orange >20%)
  - Actionable tips when repeat rate is high

#### 3. Counterfactual Replay Analysis
- **Function**: `getCounterfactualReplayData()` in `enrich.ts`
- **Purpose**: Retrieve historical scored suggestions with feedback outcomes
- **Use Case**: Simulate alternative parameter settings retroactively
- **Script**: `scripts/counterfactual_replay.ts`
  - Recalculates scores with different MMR lambda values
  - Applies alternative source weight multipliers
  - Reports estimated impact on acceptance rate
  - Usage: `npx ts-node scripts/counterfactual_replay.ts <user_id>`

#### 4. A/B Testing Infrastructure
- **Migration**: `20251213010000_ab_testing_infrastructure.sql`
- **Tables**:
  - `ab_test_configs`: Test definitions with variants and traffic splits
  - `ab_test_assignments`: User-to-variant mappings (sticky assignments)
  - `ab_test_metrics`: Collected metrics per variant per user
- **Library**: `src/lib/abTesting.ts`
  - `getActiveABTests()`: Fetch currently running tests
  - `getABTestVariant()`: Assign user to variant (or retrieve existing)
  - `recordABTestMetric()`: Log metrics (acceptance rate, diversity, etc.)
  - `getABTestResults()`: Aggregate and analyze test outcomes
  - `userMeetsCriteria()`: Check targeting criteria
- **Documentation**: `AB_TESTING_GUIDE.md`
  - Complete setup instructions
  - Example test configurations
  - Integration patterns
  - Best practices

#### Testable Parameters
- **MMR Lambda** (diversity vs relevance): 0.0–0.5
- **Exploration Rate**: 0.0–0.3
- **Source Weights**: Per-source reliability multipliers
- **Quality Gate Threshold**: Metadata completeness minimum

#### Key Metrics Supported
- Acceptance rate (positive/total feedback)
- Diversity score (unique genres/directors)
- Repeat suggestion rate
- Average rating given
- Time to feedback
- Session length

### Implementation Impact
- **Data-Driven Optimization**: Can now test parameter changes on real users
- **Historical Analysis**: Counterfactual replay reduces risk before live tests
- **Quality Monitoring**: Repeat-rate tracking ensures fresh recommendations
- **Transparency**: Users see diversity metrics on Stats page
