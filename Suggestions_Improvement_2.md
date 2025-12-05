# Adaptive & Suggestions Improvements (v2)

## Quick Wins (ship next)
- Confidence-aware weighting: per-feature priors, decay old signals, cap total impact; expose strength badges (High/Med/Low).
- Hard vs soft avoid: soft avoids now downrank dismissed titles instead of blocking outright; hard blocks remain via explicit block list (undo available).
- Source reliability by user: weight TMDB/TasteDive/Trakt/etc. by each user’s historical hit-rate; still honor multi-source consensus.
- Diversity rerank (MMR): small λ to trade score vs novelty (genres/decades/directors) after base scoring.
- Session sliders: “Freshness vs familiarity” and “Discovery vs safety” tweak overlap weights and exploration rate.

## Progress (today)
- Implemented confidence scaling + caps for feature feedback (actors/keywords/franchises) and labeled hard vs soft avoid in `enrich.ts` (Pandora block).
- Added source reliability multiplier using consensus + per-source priors and light reason text; capped to ±12%.
- Added MMR rerank (λ=0.25, topK ~3x desired) before diversity filter to balance novelty vs relevance.
- Surfaced consensus badge on movie cards to show confidence even when only one source is present.
- Added inline undo for dismissed suggestions (unblocks and keeps card in view).
- Added dismiss undo toast (bottom-left) for quick recovery after “Not Interested”.
- Source hit-rate weighting: per-user reliability from feedback + source metadata (Laplace-smoothed) feeds scoring multiplier.
- UI: Reliability badge (per-user) shown alongside consensus/multi-source badges.
- Added persistent "Undo last feedback" control to restore most recent dismissed/blocked item.
- Added match strength badge (High/Solid/Exploratory) derived from consensus + reliability.
- Added session slider (Discovery vs Safety) wiring into MMR λ/topK for on-demand exploration tuning.
- Watchlist intent depth: ingest Letterboxd watchlist added dates, apply recency + repetition boosts, decay stale entries in taste profile intent signals, and surface recency-tagged watchlist intent reasons when a saved title appears.
- Pairwise A/B prompt: surfaces near-tie suggestions and records winner/loser feedback to steer rankings faster.
- Reason strength labels wired into core reasons (genres, combos, directors, cast, keywords) using High/Solid/Light text.
- Stats page: added Watchlist Momentum (recency buckets, median/avg age) and Metadata Coverage + Consensus Strength cards to mirror quality gates and confidence.
- Per-source reliability: feedback now stores contributing sources/consensus level; scoring pulls consensus-weighted per-source hit-rate multipliers (cached 5m) and Stats shows per-source hit rates.
- Per-source consensus split: Stats now breaks out hit-rate by consensus level per source (high/medium/low) when sufficient samples exist.

## Near-Term (2–3 sprints)
- Pairwise A/B feedback on close candidates; first pass shipped (near-tie prompt + winner/loser logging); next: regularized feature-level updates.
- Context-aware learning: time-of-day/device/mood toggle to bias tone/runtime/language.
- Counter-evidence handling: store pos/neg counts per feature; use Bayesian win rate instead of netting signals.
- Watchlist intent depth: shipped recency + repetition boosts with decay for stale items; now surfacing recency-tagged watchlist intent reasons when a saved title shows up.
- Stats alignment: reflect new signals (watchlist intent, reliability/strength) on the Stats page where applicable. → Done for intent recency + quality/consensus + overall hit-rate + per-source reliability (with sample threshold). Remaining: consensus-level split per source if useful.
- Quality gates: downrank items missing posters/trailers/metadata unless strong consensus.

## Medium-Term
- Collection completion priority: use `findIncompleteCollections()` to boost missing entries and surface "Complete the X collection" reasons.
- Intentional exploration: bandit-style exploration that increases where confidence is low; clamp elsewhere.
- Adjacent feature borrowing: low-confidence features borrow small weight from similar actors/genres with strong evidence; decay if unreinforced.
- Suppression explanations: show why hidden (“suppressed due to 3 superhero skips”) with allow-today override.

## UX/Reasons
- Reason strength + recency labels (“Learned from 4 signals, last 12d”).
- Fast corrections: one-tap "This is fine" to move avoid → neutral.
- Micro-surveys (rare): disambiguate repeated skips (actor vs tone vs runtime).

## Metrics & Evaluation
- Track: acceptance by reason type, source hit-rate per user, diversity, repeat-suggestion rate, regret events (later-liked after skip).
- Counterfactual replay: log top-k scores to simulate weight tweaks before shipping.
- A/B specific knobs: MMR λ, exploration rate, source reliability scaling.

## Suggested Implementation Order
1) Confidence-aware weighting + hard/soft avoid + source reliability.
2) MMR rerank + UI strength badges + undo avoid.
3) Pairwise A/B feedback + context-aware biases.
4) Collection completion + quality gates + micro-surveys.
