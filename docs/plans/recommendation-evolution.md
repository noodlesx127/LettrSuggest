# Plan: Recommendation System Evolution

## Phase 1: Foundation (Semantic Search)

- [ ] Set up `pgvector` in Supabase.
- [ ] Create a script to generate embeddings for the top 5,000 most popular movies using OpenAI `text-embedding-3-small`.
- [ ] Implement a "Semantic Similarity" retrieval source in `recommendationAggregator.ts`.

## Phase 2: Refinement (Calibration & Diversity)

- [ ] Implement a `calibrateResults` function that re-ranks the top 100 candidates based on user's historical genre distribution.
- [ ] Enhance MMR (Maximal Marginal Relevance) logic to use semantic distance instead of just genre overlap.

## Phase 3: Feedback Loop (Contextual Bandits)

- [ ] Log "Interested/Not Interested" clicks to a new `user_feedback` table.
- [ ] Create a "Session Taste" hook that adjusts search weights in real-time based on current session feedback.

## Phase 4: UI/UX (Explanation)

- [ ] Update `MovieCard` to show "Why this?" labels (e.g., "Matched via Director", "Trending on TasteDive").
- [ ] Add "More like this" button to each recommendation.
