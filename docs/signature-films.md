# Signature Film Detection

## Overview

**Signature films** are movies that best represent a user's unique taste. Unlike simple high-rating filters, signature film detection identifies films that are:

1. **Highly rated by the user** (4+ stars or liked)
2. **Less mainstream** (lower TMDB popularity scores)
3. **Genre-aligned** (match user's top genres)
4. **Era-aligned** (from user's preferred decades)

This creates better recommendation seeds by focusing on what makes a user's taste _distinctive_, not just what they rated highly.

## Implementation

### New Types

```typescript
interface SignatureFilmScore {
  tmdbId: number;
  title: string;
  signatureScore: number;
  reasons: string[];
}
```

### Core Function: `scoreSignatureFilm()`

Scores a film based on how well it represents unique taste:

**Scoring Components:**

| Component        | Max Points | Criteria                                       |
| ---------------- | ---------- | ---------------------------------------------- |
| **User Rating**  | 2.0        | 5-star (2.0), 4+ star (1.5)                    |
| **Liked Flag**   | 1.0        | Film was liked                                 |
| **Niche Appeal** | 2.0        | Popularity < 10 (2.0), < 50 (1.5), < 200 (0.5) |
| **Genre Match**  | 1.5        | 2+ genres match (1.5), 1 genre (0.5)           |
| **Decade Match** | 0.5        | From user's preferred decade                   |

**Maximum Score:** 7.0 points

### Updated Functions

#### `getWeightedSeedIds()`

Now accepts optional `profile` parameter:

```typescript
getWeightedSeedIds(
  films: FilmForSeeding[],
  limit: number = 25,
  ensureDiversity: boolean = true,
  profile?: {
    topGenres: Array<{ id: number; name: string }>;
    topDecades?: Array<{ decade: number }>;
    useSignatureScoring?: boolean;
  }
): number[]
```

When `profile.useSignatureScoring = true`, delegates to signature-based selection.

#### `getSignatureSeedIds()` (internal)

Implements signature-based seed selection:

1. Filters to highly-rated films (3.5+ stars or liked)
2. Scores each film using `scoreSignatureFilm()`
3. Sorts by signature score
4. Returns **60% top signatures + 40% variety**

This balance ensures we use distinctive films while maintaining some randomness.

### Enhanced `FilmForSeeding` Interface

Added fields to support signature scoring:

```typescript
interface FilmForSeeding {
  // ... existing fields
  popularity?: number; // TMDB popularity (lower = more niche)
  releaseDate?: string; // ISO date (YYYY-MM-DD)
  title?: string; // Film title for logging
}
```

## Usage Example

```typescript
import { getWeightedSeedIds } from "@/lib/trending";

const seeds = getWeightedSeedIds(userFilms, 25, true, {
  topGenres: [
    { id: 27, name: "Horror" },
    { id: 53, name: "Thriller" },
  ],
  topDecades: [{ decade: 2010 }, { decade: 2000 }],
  useSignatureScoring: true, // Enable signature detection
});
```

## Testing

Run the test script to verify behavior:

```bash
npx tsx scripts/test_signature_scoring.ts
```

**Expected Results:**

- **Niche + loved films** score highest (e.g., 7.0 for hidden gem with multi-genre match)
- **Mainstream blockbusters** score lower despite high ratings (e.g., 3.5)
- **Genre-aligned films** from preferred decades get boost
- Seed selection balances signature films (60%) with variety (40%)

## Why This Matters

### Before (Standard Weighted Seeds)

- Selects highest-rated films
- May include mainstream blockbusters everyone likes
- Doesn't identify what makes user's taste _unique_

### After (Signature Film Detection)

- Prioritizes niche films user loved
- Identifies genre patterns + era preferences
- Creates more personalized recommendation seeds

**Example:**

User loves horror and rates both "The Shining" (popularity: 500) and "A Girl Walks Home Alone at Night" (popularity: 12) as 5 stars.

- **Standard selection:** Both weighted equally (5-star = 5-star)
- **Signature selection:** Niche film scores higher (5-star + hidden gem + genre match = 7.0 vs 3.5)

This means recommendations will be seeded with more distinctive taste markers, leading to more personalized results.

## Integration Points

### Current Usage

The function is ready to use but not yet integrated into the main recommendation flow.

### Potential Integration

To enable signature scoring in recommendations:

1. **Find where seeds are generated** (likely in recommendation aggregation)
2. **Pass user's taste profile** (topGenres, topDecades)
3. **Set `useSignatureScoring: true`**
4. **Ensure TMDB details include `popularity`** when fetching film data

### Data Requirements

For optimal signature scoring, ensure:

- ✅ User ratings, likes (already available)
- ✅ Genre IDs (already available)
- ⚠️ TMDB popularity (needs to be fetched/stored)
- ⚠️ Release dates (needs to be fetched/stored)

## Future Enhancements

1. **Subgenre Detection:** Use keywords to identify subgenre preferences (e.g., "folk horror")
2. **Director Signatures:** Boost films from niche directors user loves
3. **Temporal Patterns:** Detect if user prefers specific year ranges within decades
4. **Adaptive Thresholds:** Adjust popularity thresholds based on user's overall mainstream-ness

## Logging

Signature scoring includes detailed logging:

```
[SignatureSeeds] Top signature films: {
  total: 50,
  top10: [
    {
      title: 'Hidden Horror Gem',
      score: '7.00',
      reasons: '5-star rating, Liked, Hidden gem (very niche), Multi-genre match: Horror, Thriller, Preferred decade: 2010s'
    },
    ...
  ]
}
```

This helps debug and understand why specific films were chosen as seeds.
