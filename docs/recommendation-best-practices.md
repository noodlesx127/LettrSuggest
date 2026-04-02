# Research Report: Modern Recommendation System Best Practices

This report outlines modern techniques for movie recommendation systems, specifically tailored for the **LettrSuggest** stack (Next.js, Supabase, TMDB data).

---

## A. Top 5 Applicable Techniques

### 1. Vector-Based Hybrid Filtering (Semantic Search)

**Description:** Instead of relying on keyword matching (e.g., "Action"), movies and user profiles are converted into high-dimensional embeddings (vectors). Semantic similarity is calculated using cosine distance.

- **Industry Examples:** Spotify (Annoy/Voyager), Netflix (Similarity Models), Pinterest (PinSage).
- **Application to LettrSuggest:** Store movie descriptions, plot keywords, and user "taste bios" as vectors in Supabase using `pgvector`. This allows finding movies that are "spiritually similar" even if they don't share exact genre tags.
- **Complexity:** Medium (Requires embedding generation API like OpenAI).
- **Impact:** High (Significantly improves "discovery" of non-obvious matches).
- **Resources:** [Supabase pgvector Guide](https://supabase.com/blog/openai-embeddings-postgres-vector), [Sentence-Transformers](https://www.sbert.net/).

### 2. Calibrated Recommendations (Post-Processing)

**Description:** A technique that ensures the distribution of genres/themes in the recommendation list matches the user's historical distribution.

- **Industry Examples:** Netflix (balancing niche interests vs. mainstream), Spotify (Daily Mixes).
- **Application to LettrSuggest:** If a user's diary consists of 40% Horror and 10% Documentary, the final list should be re-ranked to prevent "genre collapse" where one dominant genre pushes everything else out.
- **Complexity:** Low (Simple re-ranking algorithm).
- **Impact:** Medium (Improves user satisfaction by respecting the breadth of their taste).
- **Resources:** _Calibrated Recommendations_ (Steck, 2018).

### 3. Knowledge Graph Enriched Content Filtering

**Description:** Treating movie data as a graph (Movie → Actor → Director → Studio) and using graph-based distances to find candidates.

- **Industry Examples:** IMDb "People who liked this also liked...", Amazon Knowledge Graph.
- **Application to LettrSuggest:** Surface "deep cuts" by following non-obvious links, such as a shared Cinematographer or a specific Production Designer, rather than just Genre/Director.
- **Complexity:** Medium (Requires building a relation table in Supabase).
- **Impact:** High (Creates "Aha!" moments for cinephiles).
- **Resources:** [Knowledge Graph Recommender Systems](https://arxiv.org/abs/2003.00411).

### 4. Lightweight Contextual Bandits (Feedback Learning)

**Description:** A reinforcement learning approach that balances "Exploration" (showing new things) and "Exploitation" (showing what we know they like).

- **Industry Examples:** YouTube (Next Up), Netflix (Homepage Ordering).
- **Application to LettrSuggest:** Use the "Interested/Not Interested" signals to dynamically adjust the weights of specific "Taste Seeds" in real-time. If a user rejects three "Westerns" in a row, the system immediately lowers the priority of Westerns for that session.
- **Complexity:** Medium (Requires tracking session-based state).
- **Impact:** High (Makes the app feel responsive to user feedback).
- **Resources:** [A Contextual-Bandit Approach to Personalized News Recommendation](https://arxiv.org/abs/1003.0146).

### 5. Multi-Source Explanation Interfaces

**Description:** Providing "Transparent Proof" for why a movie was recommended.

- **Industry Examples:** Amazon ("Because you bought..."), Netflix ("98% Match", "Gritty, Suspenseful").
- **Application to LettrSuggest:** Explicitly label movies with their provenance: "Matches your love for _Denis Villeneuve_", "Top TasteDive community pick", or "Matches 4 of your Watchlist films".
- **Complexity:** Low (UI-based change).
- **Impact:** Medium (Increases user trust and click-through rate).

---

## B. Quick Wins from Industry

1.  **"Because you liked [Movie X]":** Instead of a generic list, group some recommendations under specific movies the user recently rated highly.
2.  **Temporal Weighting (Decay):** Weight a "Like" from yesterday 2x more than a "Like" from three years ago. User tastes drift.
3.  **Themed "Shelves":** Group recommendations into human-readable categories (e.g., "Atmospheric Neo-Noirs", "Short & Sweet") rather than one long list.
4.  **Social Proof:** Display "X people on Letterboxd also have this on their watchlist."

---

## C. Evaluation Metrics

To measure if our recommendations are actually improving:

| Metric                         | Definition                                                                    | Why it matters                                  |
| :----------------------------- | :---------------------------------------------------------------------------- | :---------------------------------------------- |
| **Precision@K**                | % of top K recommendations that are actually liked/added.                     | Measures pure accuracy.                         |
| **Intra-List Diversity (ILD)** | Average "distance" between items in a recommended list.                       | Ensures the list isn't 10 identical movies.     |
| **Catalog Coverage**           | % of the total movie database that is ever recommended.                       | Measures if we are surfacing "long-tail" items. |
| **Serendipity Score**          | Measures how "surprising" a recommendation is compared to the user's history. | The "discovery" factor.                         |
| **Mean Reciprocal Rank (MRR)** | How high up the list the first "Interested" item appears.                     | Measures ranking quality.                       |

---

## D. Architecture Patterns

### The "Two-Stage" Pipeline

1.  **Candidate Generation (Retrieval):**
    - Pull 100-200 candidates from various sources (TMDB, TasteDive, Vector Search).
    - Goal: High recall, low latency.
2.  **Ranking (Scoring):**
    - Apply the complex scoring algorithm (overlap, popularity, temporal decay).
    - Goal: High precision.
3.  **Re-ranking (Diversity/Business Logic):**
    - Apply MMR and Calibration.
    - Filter out "Not Interested" items.

### Data Flow (Supabase + Next.js)

- **Batch Processing:** Every 24 hours, pre-calculate "Taste Profiles" and store in a `user_profiles` table.
- **Real-time Scoring:** Perform the final ranking in a Next.js Edge Function or Server Action when the user requests recommendations.
- **Feedback Loop:** "Not Interested" clicks should trigger an immediate update to an `exclusion_list` in Supabase, and optionally adjust the user's vector profile.
