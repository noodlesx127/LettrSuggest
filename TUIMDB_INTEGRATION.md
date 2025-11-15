# TuiMDB Integration

## Overview

LettrSuggest now supports the TuiMDB API alongside TMDB. TuiMDB offers:

- **More relaxed rate limits** - Better for high-volume usage
- **Enhanced genre data** - More detailed genre information for better movie suggestions
- **Flexible API** - Additional metadata and filtering options

The system uses a **fallback strategy**: it tries TuiMDB first, and falls back to TMDB if TuiMDB is unavailable or returns no results.

## Setup

### 1. Get Your API Key

You already have your TuiMDB API key:
```
bcd7981cec365525f5036c66db2150f90e5b6a64ecb5eaf2db72caaf650a5e12
```

### 2. Configure Environment Variables

Add the TuiMDB API key to your environment:

**For local development (.env.local):**
```bash
TUIMDB_API_KEY=bcd7981cec365525f5036c66db2150f90e5b6a64ecb5eaf2db72caaf650a5e12
```

**For Netlify deployment:**
1. Go to your Netlify dashboard
2. Navigate to Site settings → Environment variables
3. Add: `TUIMDB_API_KEY` = `bcd7981cec365525f5036c66db2150f90e5b6a64ecb5eaf2db72caaf650a5e12`

### 3. Keep TMDB Configured

Keep your existing `TMDB_API_KEY` configured as a fallback.

## Architecture

### Files Created

1. **`src/lib/tuimdb.ts`** - TuiMDB API client with search, details, and genre functions
2. **`src/lib/movieAPI.ts`** - Unified API facade that tries TuiMDB first, then TMDB
3. **`src/app/api/tuimdb/search/route.ts`** - Search endpoint
4. **`src/app/api/tuimdb/movie/route.ts`** - Movie details endpoint
5. **`src/app/api/tuimdb/genres/route.ts`** - Genre listing endpoint

### Modified Files

1. **`src/lib/enrich.ts`** - Updated `searchTmdb()` to use unified API
2. **`.env.example`** - Added `TUIMDB_API_KEY` variable

## Usage

### Automatic (Recommended)

The existing codebase will automatically use TuiMDB when available:

```typescript
import { searchTmdb } from './enrich';

// This now uses TuiMDB first, then TMDB
const results = await searchTmdb('Inception', 2010);
```

### Manual Control

For explicit control over which API to use:

```typescript
import { searchMovies, getMovieDetails } from './movieAPI';

// Use TuiMDB preferentially (default)
const results = await searchMovies({ 
  query: 'Inception', 
  year: 2010,
  preferTuiMDB: true 
});

// Force TMDB only
const tmdbResults = await searchMovies({ 
  query: 'Inception', 
  preferTuiMDB: false 
});

// Get movie details with TuiMDB first
const movie = await getMovieDetails({ 
  id: 27205, 
  preferTuiMDB: true 
});
```

### Direct TuiMDB Access

Use TuiMDB-specific features directly:

```typescript
import { searchTuiMDB, getTuiMDBMovie, getTuiMDBGenres } from './tuimdb';

// Search
const results = await searchTuiMDB('The Matrix', 1999);

// Get details
const movie = await getTuiMDBMovie(603);

// Get genres
const genres = await getTuiMDBGenres();
```

## API Comparison

| Feature | TuiMDB | TMDB |
|---------|--------|------|
| Rate Limits | More relaxed | Stricter |
| Genre Data | Enhanced | Standard |
| Search | ✅ | ✅ |
| Movie Details | ✅ | ✅ |
| Cast/Crew | ✅ | ✅ |
| Keywords | ✅ | ✅ |
| Videos | ✅ | ✅ |
| Images | ✅ | ✅ |

## Benefits for Suggestions

1. **Better Genre Matching** - TuiMDB's enhanced genre data provides more accurate movie categorization
2. **Higher Request Limits** - Can enrich more movies without hitting rate limits
3. **Redundancy** - Fallback to TMDB ensures reliability

## Testing

To test the integration:

```bash
# Ensure environment variables are set
echo $TUIMDB_API_KEY

# Run the development server
npm run dev

# Test search functionality in the import or library pages
# Watch the browser console for "[UnifiedAPI]" log messages
```

## Monitoring

Watch the console logs to see which API is being used:

- `[UnifiedAPI] Searching TuiMDB` - TuiMDB attempt
- `[UnifiedAPI] TuiMDB search successful` - TuiMDB used
- `[UnifiedAPI] Searching TMDB` - TMDB fallback used

## Troubleshooting

### TuiMDB Not Working

1. Check API key is set: `echo $TUIMDB_API_KEY`
2. Verify API key format (64 hex characters)
3. Check console for error messages
4. System will automatically fall back to TMDB

### Both APIs Failing

1. Check network connectivity
2. Verify both API keys are valid
3. Check if you've hit rate limits
4. Review console logs for specific errors

## Future Enhancements

Potential improvements:

1. Add TuiMDB discover/filtering endpoint
2. Implement caching for genre data
3. Add metrics to track API usage split
4. Create admin panel to view API status
5. Add TuiMDB-specific filtering in suggestions

## Documentation

- TuiMDB API Docs: https://tuimdb.com/api/docs/
- TMDB API Docs: https://developers.themoviedb.org/3/
