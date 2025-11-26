# API Integration Summary - Quick Reference

## Three New APIs for UnifiedAPI

### 🎯 Priority Ranking

> [!IMPORTANT]
> **Strategic Shift:** OMDb is now a **PRIMARY data source**, not enrichment. All three APIs provide recommendation signals.

1. **🥇 OMDb** (CRITICAL - Primary Source)
   - **What:** IMDB ratings, Rotten Tomatoes, comprehensive metadata
   - **Impact:** Replace TuiMDB as primary source alongside TMDB
   - **User Value:** IMDB is the gold standard - users trust it more than TMDB
   - **Rate Limit:** 1,000 requests/day (need to cache aggressively)
   - **Role:** Primary metadata + ratings validation

2. **🥈 TasteDive** (HIGH - Recommendations)
   - **What:** Cross-platform recommendation engine
   - **Impact:** Add 5th recommendation source to aggregation
   - **User Value:** Discover films from books, shows, music connections
   - **Rate Limit:** 300 requests/hour
   - **Role:** Recommendation diversity + cross-media discovery

3. **🥉 Watchmode** (HIGH - Enrichment + Recommendations)
   - **What:** Streaming availability + trending data
   - **Impact:** Show "Watch on Netflix" + trending films
   - **User Value:** Users can immediately watch suggested films
   - **Rate Limit:** Varies by plan
   - **Role:** Streaming info + trending recommendations

**Key Architecture Changes:**
- **5-Source Recommendation Aggregator:** TMDB + TasteDive + Trakt + TuiMDB + Watchmode
- **OMDb as Primary:** Parallel fetch with TMDB, merge results
- **TuiMDB Remains:** Enhanced genres only (seasonal, niche categories)



---

## 🎯 Multi-Source Recommendation Strategy

> [!IMPORTANT]
> **Goal:** Maximize recommendation quality by using **ALL 5 recommendation sources** and aggregating their signals.

### The 5 Recommendation Sources

1. **TMDB** (`/movie/{id}/similar`, `/movie/{id}/recommendations`)
   - Weight: 1.0 (baseline)
   - Coverage: Excellent
   - Quality: Good general recommendations

2. **TasteDive** (`/api/similar`)
   - Weight: 1.2 (highest - cross-platform intelligence)
   - Coverage: Good
   - Quality: Discovers hidden connections across media types
   - Unique: Can link books → movies, music → films

3. **Trakt** (`/movies/{id}/related`)
   - Weight: 1.1 (community-driven)
   - Coverage: Good
   - Quality: User behavior patterns
   - Already integrated

4. **TuiMDB** (Genre-based matching)
   - Weight: 0.9
   - Coverage: Excellent for genre-specific
   - Quality: Great for niche/seasonal genres
   - Unique: 62 genres including anime, stand-up, holiday films

5. **Watchmode** (`/list-titles`)
   - Weight: 0.7 (trending supplement)
   - Coverage: Trending/popular only
   - Quality: Captures current popularity
   - Unique: Real-time streaming trends

### Consensus Scoring Algorithm

```typescript
// Films recommended by multiple sources get higher scores
Consensus Level:
- HIGH (4-5 sources agree) → +15 score boost
- MEDIUM (2-3 sources agree) → +10 score boost
- LOW (1 source only) → +5 score boost

Final Score = (Σ source_confidence × source_weight) / total_weight + consensus_bonus
```

### Example: "Arrival" Recommendations

**Seed:** User loved "Arrival" (5★ + Liked)

**Source Results:**
- TMDB suggests: "Interstellar", "Blade Runner 2049", "Contact"
- TasteDive suggests: "Interstellar", "Contact", "Her", "Ex Machina"
- Trakt suggests: "Blade Runner 2049", "Interstellar", "Annihilation"
- TuiMDB (Sci-Fi genre) suggests: "Interstellar", "2001: A Space Odyssey"
- Watchmode (trending Sci-Fi): "Dune", "Everything Everywhere All At Once"

**Aggregated Results:**
1. **"Interstellar"** - Score: 10.5 (HIGH consensus - 4 sources)
   - Sources: TMDB, TasteDive, Trakt, TuiMDB
   
2. **"Blade Runner 2049"** - Score: 8.2 (MEDIUM consensus - 2 sources)
   - Sources: TMDB, Trakt

3. **"Contact"** - Score: 7.8 (MEDIUM consensus - 2 sources)
   - Sources: TMDB, TasteDive

4. **"Ex Machina"** - Score: 5.4 (LOW consensus - 1 source)
   - Sources: TasteDive (unique cross-media find)

### Benefits of Multi-Source Aggregation

✅ **Higher Confidence** - Films recommended by 4-5 sources are ranked higher  
✅ **Better Diversity** - Each source brings unique perspective  
✅ **Cross-Media Discovery** - TasteDive finds films from books/shows  
✅ **Trending Awareness** - Watchmode adds current popular films  
✅ **Niche Coverage** - TuiMDB catches genre-specific hidden gems  
✅ **Fault Tolerance** - If one API fails, others compensate  

---

## Quick Start Implementation Order

### Week 1: OMDb Integration (Primary Source)
```bash
# Elevate OMDb to primary alongside TMDB
1. Create src/lib/omdb.ts client
2. Add API routes: src/app/api/omdb/{search,imdb}/route.ts
3. Modify fetchTmdbMovieCached to parallel fetch TMDB + OMDb
4. Create mergeTMDBAndOMDb function
5. Update tmdb_movies schema with OMDb fields
6. Update MovieCard to show IMDB rating prominently
```

**Impact:**
```
Before: TMDB: 7.8/10
After:  ⭐ IMDB: 8.1/10 | TMDB: 7.8/10 | 🍅 RT: 92%
```

### Week 2: Multi-Source Recommendation Aggregator
```bash
# Build the recommendation engine
1. Create src/lib/recommendationAggregator.ts
2. Create src/lib/recommendationSources.ts (5 fetchers)
3. Integrate into suggestByOverlap function
4. Add consensus scoring logic
5. Display source badges on movie cards
```

**Algorithm Impact:**
- Films with 4-5 source consensus ranked highest
- 15-20% more diverse recommendations
- Better "hidden gem" discovery

### Week 3: TasteDive Integration

```bash
# Immediate user-facing value
1. Create src/lib/watchmode.ts client
2. Add API route: src/app/api/watchmode/sources/route.ts
3. Update MovieCard to show streaming sources
4. Add caching layer (24-hour TTL)
```

**Visual Impact:**
```
Before: [Movie Card with just title & rating]
After:  [Movie Card with "Watch on: Netflix, Disney+"]
```

### Week 2: OMDb (IMDB Ratings)
```bash
# Build trust with additional ratings
1. Create src/lib/omdb.ts client
2. Add API route: src/app/api/omdb/imdb/route.ts
3. Update MovieCard to show IMDB rating
4. Extend tmdb_movies table with imdb_rating column
```

**Visual Impact:**
```
Before: TMDB: 7.8/10
After:  TMDB: 7.8/10 | IMDB: 8.1/10 ⭐
```

### Week 3: TasteDive (Recommendations)
```bash
# Enhance recommendation algorithm
1. Create src/lib/tastedive.ts client
2. Add API route: src/app/api/tastedive/similar/route.ts
3. Integrate into suggestByOverlap function
4. Add cross-validation logic
```

**Algorithm Impact:**
- More diverse recommendations
- Cross-platform discovery (books→movies)
- Better "similar films" detection

---

## Environment Setup

### Step 1: Update `.env.local`
```env
# Add these three lines:
TASTEDIVE_API_KEY=1063144-LettrSug-D8AC6FD2
WATCHMODE_API_KEY=sJAdPbFYPdPdhkHHik51dKStvXgtdhp7yGRSin0S
OMDB_API_KEY=ba10bd99
```

### Step 2: Update Netlify Environment
```bash
netlify env:set TASTEDIVE_API_KEY "1063144-LettrSug-D8AC6FD2"
netlify env:set WATCHMODE_API_KEY "sJAdPbFYPdPdhkHHik51dKStvXgtdhp7yGRSin0S"
netlify env:set OMDB_API_KEY "ba10bd99"
```

### Step 3: Update `.env.example`
Add the three new variables (without actual keys)

---

## Database Changes Needed

### 1. Streaming Sources Cache (Watchmode)
```sql
CREATE TABLE streaming_sources (
  tmdb_id INTEGER NOT NULL,
  watchmode_id INTEGER,
  sources JSONB NOT NULL,
  region VARCHAR(2) DEFAULT 'US',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tmdb_id, region)
);
```

### 2. IMDB Ratings (OMDb)
```sql
ALTER TABLE tmdb_movies 
  ADD COLUMN IF NOT EXISTS imdb_rating VARCHAR(10),
  ADD COLUMN IF NOT EXISTS imdb_votes VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rotten_tomatoes VARCHAR(10);
```

### 3. TasteDive Cache (Optional)
```sql
CREATE TABLE tastedive_cache (
  query_hash VARCHAR(64) PRIMARY KEY,
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Key Design Decisions

### 1. Caching Strategy
- **Watchmode:** 24-hour cache (streaming availability changes daily)
- **OMDb:** Indefinite cache (IMDB ratings rarely change)
- **TasteDive:** 7-day cache (similar movies are relatively stable)

### 2. When to Call APIs
- **Watchmode:** On-demand when user views movie card details
- **OMDb:** During TMDB enrichment (parallel fetch)
- **TasteDive:** During recommendation generation (batch)

### 3. Failure Handling
All three APIs are **enrichment-only** - if they fail, the app still works:
- Watchmode fails → No streaming info shown (app still works)
- OMDb fails → Only TMDB rating shown (app still works)
- TasteDive fails → Use TMDB/Trakt only (app still works)

---

## Expected User Experience Improvements

### Scenario 1: User views suggestion
**Before:**
```
"Inception" (2010)
⭐ 8.3/10 (TMDB)
[View Details]
```

**After:**
```
"Inception" (2010)
⭐ TMDB: 8.3/10 | IMDB: 8.8/10
📺 Watch on: Netflix, HBO Max
[View Details]
```

### Scenario 2: User filters suggestions
**New Feature:**
```
Show only movies available on:
☑️ Netflix
☑️ Disney+
☐ Hulu
☐ Amazon Prime

[15 suggestions match your filters]
```

### Scenario 3: Better recommendations
**Algorithm Enhancement:**
- TasteDive finds: "Interstellar" is similar to "Arrival"
- TMDB also suggests: "Interstellar"
- **Result:** Higher confidence → Ranks higher in suggestions


---

## 🎁 Comprehensive Data Extraction - Maximum Value

> [!IMPORTANT]
> We extract **EVERY useful field** from each API, not just their primary use case.

### TasteDive - 7 Data Points Per Result
✅ Movie name  
✅ Wikipedia description (plot enrichment)  
✅ Wikipedia URL (external context link)  
✅ YouTube trailer URL  
✅ YouTube video ID  
✅ Content type (cross-media filtering)  
✅ **Cross-media links** (books→movies, music→films)

**Value:** Trailers, plot enrichment, unique cross-media discovery

---

### Watchmode - 20+ Data Points Per Title
✅ Streaming sources (Netflix, Hulu, etc.)  
✅ Source type (subscription/buy/rent)  
✅ Pricing data  
✅ Format (4K/HD/SD)  
✅ Direct watch URLs  
✅ Regional availability  
✅ **TMDB ID mapping**  
✅ **IMDB ID mapping**  
✅ User ratings  
✅ **Cast & crew data**  
✅ **Director/writer credits**  
✅ **Person filmographies**  
✅ **Trending lists**  
✅ **New releases by service**  
✅ Network/studio info  
✅ Genre taxonomy  
✅ Runtime & release dates  

**Value:** Not just streaming - also cast validation, trending discovery, ID mapping hub

---

### OMDb - 23 Data Points Per Title
✅ **IMDB rating + votes** (PRIMARY)  
✅ **Rotten Tomatoes score**  
✅ **Metacritic score**  
✅ **Awards data** (Oscars, Golden Globes)  
✅ **Box office gross**  
✅ Budget information  
✅ Full cast & character names  
✅ Director, writer, actors  
✅ **Detailed plot** (short or full)  
✅ Content rating (PG-13, R, etc.)  
✅ Languages & countries  
✅ **High-quality poster** (fallback)  
✅ Production companies  
✅ DVD/Blu-ray dates  
✅ Official website link  
✅ Runtime  
✅ Genre listings  

**Value:** Multi-rating display, awards badges, box office analysis, content filtering

---

### Combined: 100+ Data Points Per Movie

**Merged Movie Object Includes:**
- **IDs:** TMDB, IMDB, Watchmode, TuiMDB, Trakt (5 sources)
- **Ratings:** IMDB, TMDB, Rotten Tomatoes, Metacritic, Watchmode (5 sources)
- **Metadata:** Title, year, runtime, plot (short + full), genres
- **Visuals:** Poster (TMDB + OMDb fallback), backdrop, trailer (YouTube)
- **People:** Cast, director, writer (TMDB + Watchmode validation)
- **Awards:** Oscars, Golden Globes, nominations (OMDb)
- **Financials:** Box office, budget, revenue (OMDb + TMDB)
- **Streaming:** Services, prices, formats, regions (Watchmode)
- **Recommendations:** 5-source aggregated with consensus scores
- **Enrichment:** Wikipedia URL, trailer, awards text

See [API_DATA_EXTRACTION_MAP.md](file:///f:/Code/LettrSuggest/API_DATA_EXTRACTION_MAP.md) for complete schema.

---

## Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| **Rate limits exceeded** | Aggressive caching + graceful degradation |
| **API goes down** | All APIs are optional enrichment only |
| **Slow responses** | Implement 5-second timeout + show cached data |
| **Cost concerns** | Free tiers should suffice; monitor usage |
| **Data quality** | Cross-validate between sources |

---

## Success Metrics (After 1 Month)

### Engagement
- ✅ **Streaming info shown:** > 70% of movie cards
- ✅ **Click-through rate:** +15% on cards with streaming info
- ✅ **User retention:** +10% from "where to watch" feature

### Technical
- ✅ **Cache hit rate:** > 80% for Watchmode
- ✅ **API errors:** < 1% failure rate
- ✅ **Response time:** < 500ms with cache

### Recommendation Quality
- ✅ **TasteDive coverage:** 20% of suggestions cross-validated
- ✅ **IMDB rating shown:** > 90% of movies
- ✅ **User feedback:** Higher "thumbs up" rate on suggestions

---

## API Key Security Reminders

✅ **DO:**
- Store keys in environment variables
- Use server-side API routes (Next.js `/api`)
- Keep keys out of git (.env.local is in .gitignore)
- Add to Netlify environment separately

❌ **DON'T:**
- Hardcode keys in source code
- Use `NEXT_PUBLIC_*` prefix (exposes to browser)
- Commit .env.local to git
- Share keys in documentation

---

## Next Steps

1. **Review the full implementation plan** at `implementation_plan.md`
2. **Prioritize Watchmode** for maximum user impact
3. **Set up environment variables** locally and on Netlify
4. **Start with Phase 1** (API clients and routes)
5. **Test each API independently** before integrating

**Questions to Address:**
- Which streaming services do our users primarily use?
- Should we add a user preference for streaming services?
- Do we need multi-region support immediately or later?
- Should streaming info be shown by default or on-demand?

---

## File Structure Preview

```
src/
├── lib/
│   ├── tastedive.ts          [NEW] TasteDive client
│   ├── watchmode.ts          [NEW] Watchmode client
│   ├── omdb.ts               [NEW] OMDb client
│   ├── movieAPI.ts           [MODIFY] Add new methods
│   └── enrich.ts             [MODIFY] Integrate APIs
├── app/
│   └── api/
│       ├── tastedive/
│       │   └── similar/route.ts     [NEW]
│       ├── watchmode/
│       │   ├── search/route.ts      [NEW]
│       │   └── sources/route.ts     [NEW]
│       └── omdb/
│           ├── search/route.ts      [NEW]
│           └── imdb/route.ts        [NEW]
└── components/
    └── MovieCard.tsx         [MODIFY] Add streaming/IMDB info
```

---

## Conclusion

These three APIs complement each other perfectly:
- **Watchmode** = User convenience (where to watch)
- **OMDb** = Trust & validation (IMDB ratings)
- **TasteDive** = Discovery (cross-platform recommendations)

**Recommended Approach:** Implement incrementally, starting with **Watchmode** for immediate user value.

See `implementation_plan.md` for full technical details.
