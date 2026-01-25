# Summary: Recommendation System Research

## Key Findings

- **Vector Search is the gold standard** for modern content-based filtering. Moving from keyword matching to embeddings using `pgvector` will significantly improve "discovery".
- **Calibration is essential** to prevent the "echo chamber" effect where a user is only shown one genre.
- **Explainability (Provenance)** is the most effective UI-level improvement for increasing user trust.

## Recommended Next Steps

1.  **Pilot Vector Search:** Implement a small script to embed 100 movies and test similarity search.
2.  **Implement Temporal Decay:** Adjust current scoring to prioritize recent user activity.
3.  **Add "Because you liked" rows:** Update the UI to group recommendations by seed movie.
