# Database Migration Guide: API Cache Tables

## Overview

This guide explains how to apply the database migration for TasteDive and Watchmode cache tables to your Supabase instance.

**Migration File:** `supabase/migrations/20251127170000_add_api_cache_tables.sql`

---

## What This Migration Creates

### 1. TasteDive Cache Table (`tastedive_cache`)
- **Purpose:** Caches similar content recommendations from TasteDive
- **TTL:** 7 days
- **Columns:**
  - `id` - Primary key
  - `movie_title` - Movie title used for query (unique)
  - `similar_titles` - JSONB array of similar titles
  - `cached_at` - Cache timestamp
  - `created_at` - Creation timestamp

### 2. Watchmode Cache Table (`watchmode_cache`)
- **Purpose:** Caches streaming sources from Watchmode
- **TTL:** 24 hours
- **Columns:**
  - `id` - Primary key
  - `tmdb_id` - TMDB movie ID (unique)
  - `watchmode_id` - Watchmode internal ID
  - `sources` - JSONB array of streaming sources
  - `cached_at` - Cache timestamp
  - `created_at` - Creation timestamp

### 3. Cleanup Functions
- `cleanup_tastedive_cache()` - Removes entries older than 7 days
- `cleanup_watchmode_cache()` - Removes entries older than 24 hours

### 4. Security
- Row Level Security (RLS) enabled
- Public read access (cache shared across users)
- Service role write access only

---

## How to Apply the Migration

### Option 1: Supabase CLI (Recommended)

1. **Ensure you're in the project directory:**
   ```bash
   cd f:\Code\LettrSuggest
   ```

2. **Link to your Supabase project (if not already linked):**
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Apply the migration:**
   ```bash
   npx supabase db push
   ```

4. **Verify the migration:**
   ```bash
   npx supabase db diff
   ```
   (Should show no differences if migration applied successfully)

---

### Option 2: Supabase Dashboard (Manual)

1. **Open Supabase Dashboard:**
   - Go to https://supabase.com/dashboard
   - Select your project

2. **Navigate to SQL Editor:**
   - Click "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and paste the migration SQL:**
   - Open `supabase/migrations/20251127170000_add_api_cache_tables.sql`
   - Copy the entire contents
   - Paste into the SQL Editor

4. **Run the migration:**
   - Click "Run" button
   - Wait for success message

5. **Verify tables were created:**
   - Go to "Table Editor" in left sidebar
   - You should see:
     - `tastedive_cache`
     - `watchmode_cache`

---

## Verification Checklist

After applying the migration, verify:

- [ ] `tastedive_cache` table exists
- [ ] `watchmode_cache` table exists
- [ ] Indexes are created (check in Table Editor → Indexes tab)
- [ ] RLS policies are enabled (check in Authentication → Policies)
- [ ] Cleanup functions exist (check in Database → Functions)

---

## Testing the Cache

### Test TasteDive Cache

```sql
-- Insert test entry
INSERT INTO tastedive_cache (movie_title, similar_titles)
VALUES ('Inception', '["The Matrix", "Interstellar", "Shutter Island"]'::jsonb);

-- Query test entry
SELECT * FROM tastedive_cache WHERE movie_title = 'Inception';

-- Clean up test
DELETE FROM tastedive_cache WHERE movie_title = 'Inception';
```

### Test Watchmode Cache

```sql
-- Insert test entry
INSERT INTO watchmode_cache (tmdb_id, watchmode_id, sources)
VALUES (550, 123456, '[{"name": "Netflix", "type": "sub"}]'::jsonb);

-- Query test entry
SELECT * FROM watchmode_cache WHERE tmdb_id = 550;

-- Clean up test
DELETE FROM watchmode_cache WHERE tmdb_id = 550;
```

---

## Troubleshooting

### Error: "relation already exists"
- The tables may have been created already
- Check if tables exist in Table Editor
- If they exist, the migration is already applied

### Error: "permission denied"
- Make sure you're using the correct database credentials
- Check that you have admin access to the Supabase project

### Error: "function already exists"
- The cleanup functions may have been created already
- You can safely ignore this error

---

## Cleanup Schedule (Optional)

To automatically clean up expired cache entries, you can set up a scheduled job:

1. **Go to Database → Cron Jobs** in Supabase Dashboard

2. **Create job for TasteDive cleanup:**
   ```sql
   SELECT cron.schedule(
     'cleanup-tastedive-cache',
     '0 2 * * *', -- Run daily at 2 AM
     $$ SELECT cleanup_tastedive_cache(); $$
   );
   ```

3. **Create job for Watchmode cleanup:**
   ```sql
   SELECT cron.schedule(
     'cleanup-watchmode-cache',
     '0 3 * * *', -- Run daily at 3 AM
     $$ SELECT cleanup_watchmode_cache(); $$
   );
   ```

---

## Next Steps

After applying this migration:

1. ✅ Cache tables are ready
2. ✅ Import enrichment will cache data
3. ✅ Recommendation aggregator will use cached data
4. 🔄 Test import flow with real data
5. 🔄 Monitor cache hit rates

---

## Rollback (If Needed)

If you need to rollback this migration:

```sql
-- Drop tables
DROP TABLE IF EXISTS tastedive_cache CASCADE;
DROP TABLE IF EXISTS watchmode_cache CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS cleanup_tastedive_cache();
DROP FUNCTION IF EXISTS cleanup_watchmode_cache();
```

**⚠️ Warning:** This will delete all cached data!
