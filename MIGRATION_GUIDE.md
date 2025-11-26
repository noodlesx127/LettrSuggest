```bash
npx supabase db push --include-all
```

**If prompted for a password, enter your Supabase database password.**

This command will:
1. Apply the `api_cache_tables` migration (if missing)
2. Apply the new `add_omdb_fields` migration
3. Sync your local schema with the remote database

### Verification

After the command completes successfully, you can verify the new columns exist:

```sql
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'tmdb_movies' 
  AND column_name IN ('imdb_rating', 'rotten_tomatoes', 'awards');
```

---

## 🚀 Next Steps

Once the migration is applied:
- I will proceed with Phase 7 (UI Updates) to display the new data.
- The backend logic is already updated to fetch and cache OMDb data.


---

## 🚀 Next Steps

Once the migration is applied, the implementation will continue with:
- Phase 6: Enrichment Logic (integrate OMDb into enrich.ts)
- Phase 7: UI Updates (show IMDB ratings on MovieCard)
- Phase 8: Testing

**The code implementation can proceed now** - the database changes will be needed when we start fetching OMDb data.
