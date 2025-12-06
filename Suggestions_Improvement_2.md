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

---

## Near-Term (2–3 sprints)

### Pairwise Learning
- [x] First pass shipped (near-tie prompt + winner/loser logging)
- [ ] Regularized feature-level updates from pairwise choices

### Context-Aware Learning
- [x] First-pass runtime/tone biases + family-safe filtering shipped
- [ ] Time-of-day/device/mood toggle to bias tone/runtime/language (advanced)

### Counter-Evidence Handling
- [ ] Store pos/neg counts per feature
- [ ] Use Bayesian win rate instead of netting signals

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
- [ ] Low-confidence features borrow small weight from similar actors/genres with strong evidence
- [ ] Decay if unreinforced

### Suppression Explanations
- [ ] Show why hidden ("suppressed due to 3 superhero skips")
- [ ] Allow-today override

---

## UX/Reasons

- [ ] Reason strength + recency labels ("Learned from 4 signals, last 12d")
- [ ] Fast corrections: one-tap "This is fine" to move avoid → neutral
- [ ] Micro-surveys (rare): disambiguate repeated skips (actor vs tone vs runtime)

---

## Metrics & Evaluation

- [ ] Track: acceptance by reason type, source hit-rate per user, diversity, repeat-suggestion rate, regret events (later-liked after skip)
- [ ] Counterfactual replay: log top-k scores to simulate weight tweaks before shipping
- [ ] A/B specific knobs: MMR λ, exploration rate, source reliability scaling

---

## Suggested Implementation Order (Updated)

1. ~~Confidence-aware weighting + hard/soft avoid + source reliability~~ ✅
2. ~~MMR rerank + UI strength badges + undo avoid~~ ✅
3. ~~Pairwise A/B feedback + context-aware biases~~ ✅ (partial; regularized updates pending)
4. Collection completion + quality gates + micro-surveys (next focus)
