# Adaptive & Suggestions Improvements (v2)

## Quick Wins (ship next)
- Confidence-aware weighting: per-feature priors, decay old signals, cap total impact; expose strength badges (High/Med/Low).
- Hard vs soft avoid: separate flags and scoring caps; add one-tap "undo avoid".
- Source reliability by user: weight TMDB/TasteDive/Trakt/etc. by each user’s historical hit-rate; still honor multi-source consensus.
- Diversity rerank (MMR): small λ to trade score vs novelty (genres/decades/directors) after base scoring.
- Session sliders: “Freshness vs familiarity” and “Discovery vs safety” tweak overlap weights and exploration rate.

## Progress (today)
- Implemented confidence scaling + caps for feature feedback (actors/keywords/franchises) and labeled hard vs soft avoid in `enrich.ts` (Pandora block).
- Added source reliability multiplier using consensus + per-source priors and light reason text; capped to ±12%.
- Added MMR rerank (λ=0.25, topK ~3x desired) before diversity filter to balance novelty vs relevance.
- Surfaced consensus badge on movie cards to show confidence even when only one source is present.

## Near-Term (2–3 sprints)
- Pairwise A/B feedback on close candidates; update feature weights with regularized steps.
- Context-aware learning: time-of-day/device/mood toggle to bias tone/runtime/language.
- Counter-evidence handling: store pos/neg counts per feature; use Bayesian win rate instead of netting signals.
- Watchlist intent depth: recency- and repetition-weighted boosts; decay stale watchlist items.
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
