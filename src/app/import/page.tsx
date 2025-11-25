'use client';
import AuthGate from '@/components/AuthGate';
import { useCallback, useMemo, useState, useEffect } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { normalizeData } from '@/lib/normalize';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { searchTmdb, upsertFilmMapping, upsertTmdbCache, learnFromHistoricalData } from '@/lib/enrich';
import { upsertDiaryEvents } from '@/lib/diary';
import { saveFilmsLocally } from '@/lib/db';
import type { FilmEvent } from '@/lib/normalize';

type ParsedData = {
  watched?: Record<string, string>[];
  diary?: Record<string, string>[];
  ratings?: Record<string, string>[];
  watchlist?: Record<string, string>[];
  likesFilms?: Record<string, string>[];
  reviews?: Record<string, string>[];
  lists?: Record<string, string>[];
  tags?: Record<string, string>[];
};

function parseCsv(text: string) {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return (res.data ?? []).filter(Boolean);
}

export default function ImportPage() {
  const { films, setFilms } = useImportData();
  const [data, setData] = useState<ParsedData>({});
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [distinct, setDistinct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [autoMappingActive, setAutoMappingActive] = useState(false);
  const [mappingProgress, setMappingProgress] = useState<{ current: number; total: number } | null>(null);

  const autoSaveToSupabase = useCallback(async (filmList: FilmEvent[]) => {
    try {
      if (!supabase) throw new Error('Supabase not initialized');
      const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const uid = sessionRes.session?.user?.id;
      if (!uid) throw new Error('Not signed in');
      setSaving(true);
      setError(null);
      setSavedCount(0);
      const total = filmList.length;
      setStatus(`Saving to Supabase… 0/${total}`);
      const batchSize = 500;
      let saved = 0;
      for (let i = 0; i < filmList.length; i += batchSize) {
        const chunk = filmList.slice(i, i + batchSize).map((f) => ({
          user_id: uid,
          uri: f.uri,
          title: f.title,
          year: f.year ?? null,
          rating: f.rating ?? null,
          rewatch: f.rewatch ?? null,
          last_date: f.lastDate ?? null,
          watch_count: f.watchCount ?? null,
          liked: f.liked ?? null,
          on_watchlist: f.onWatchlist ?? null,
        }));

        // Retry logic for schema cache errors
        let retries = 2;
        let lastError = null;
        while (retries >= 0) {
          const { error } = await supabase.from('film_events').upsert(chunk, { onConflict: 'user_id,uri' });
          if (!error) {
            break; // Success
          }

          lastError = error;
          // If schema cache error, wait and retry
          if (error.message?.includes('schema cache') || error.message?.includes('column')) {
            console.warn(`[Import] Schema cache error, retrying... (${retries} retries left)`, error.message);
            retries--;
            if (retries >= 0) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
              continue;
            }
          }
          throw error; // Non-retryable error
        }

        if (lastError) throw lastError;

        saved += chunk.length;
        setSavedCount(saved);
        setStatus(`Saving to Supabase… ${saved}/${total}`);
      }
      setStatus(`Saved ${saved} films to Supabase`);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save to Supabase');
    } finally {
      setSaving(false);
    }
  }, []);

  const autoMapBatch = useCallback(async (filmList: FilmEvent[]) => {
    try {
      setAutoMappingActive(true);
      const { data: sessionRes } = supabase ? await supabase.auth.getSession() : ({ data: { session: null } } as any);
      const uid = sessionRes?.session?.user?.id;
      if (!uid) {
        setAutoMappingActive(false);
        return;
      }

      // First, get existing mappings to skip already-mapped films
      let existingMappings = new Set<string>();
      try {
        const { data: existingData } = await supabase!.from('film_tmdb_map')
          .select('uri')
          .eq('user_id', uid);
        if (existingData) {
          existingMappings = new Set(existingData.map(m => m.uri));
        }
        console.log(`[Import] Found ${existingMappings.size} existing mappings`);
      } catch (e) {
        console.warn('[Import] Could not fetch existing mappings, will attempt all', e);
      }

      // Filter to only films that need mapping
      const toTry = filmList.filter(f => f.title && !existingMappings.has(f.uri));
      console.log(`[Import] Need to map ${toTry.length} of ${filmList.length} films (${existingMappings.size} already mapped, ${filmList.filter(f => !f.title).length} have no title)`);

      let mapped = 0;
      let skipped = 0; // No TMDB results found
      let failed = 0; // API errors
      let next = 0;
      const concurrency = 2; // Reduced to avoid rate limits
      let lastRequestTime = 0;
      const minDelay = 300; // 300ms between requests (max ~3 requests/sec)

      setMappingProgress({ current: 0, total: toTry.length });
      setStatus(`Mapping films to TMDB database… 0/${toTry.length}`);

      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= toTry.length) break;
          const f = toTry[i];

          // Rate limiting: ensure minimum delay between requests
          const now = Date.now();
          const timeSinceLastRequest = now - lastRequestTime;
          if (timeSinceLastRequest < minDelay) {
            await sleep(minDelay - timeSinceLastRequest);
          }
          lastRequestTime = Date.now();

          // Retry logic with exponential backoff
          let retries = 3;
          let backoff = 1000; // Start with 1 second
          let success = false;

          while (retries > 0) {
            try {
              const results = await searchTmdb(f.title, f.year ?? undefined);
              const best = results?.[0];
              if (best) {
                await upsertTmdbCache(best);
                await upsertFilmMapping(uid, f.uri, best.id);
                mapped += 1;
                success = true;
                setMappingProgress({ current: mapped + skipped + failed, total: toTry.length });
                setStatus(`Mapping films to TMDB database… ${mapped + skipped + failed}/${toTry.length} (${mapped} mapped, ${skipped} no match)`);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('lettr:mappings-updated'));
                }
              } else {
                // No results found
                skipped += 1;
                success = true;
                console.log(`[Import] No TMDB results for: ${f.title} (${f.year || 'no year'})`);
                setMappingProgress({ current: mapped + skipped + failed, total: toTry.length });
                setStatus(`Mapping films to TMDB database… ${mapped + skipped + failed}/${toTry.length} (${mapped} mapped, ${skipped} no match)`);
              }
              break; // Success (mapped or no results), exit retry loop
            } catch (e: any) {
              retries--;
              if (retries > 0) {
                console.warn(`[Import] Retry ${3 - retries}/3 for ${f.title}`, e?.message);
                await sleep(backoff);
                backoff *= 2; // Exponential backoff
              } else {
                console.error(`[Import] Failed to map ${f.title} after 3 retries`, e);
                failed += 1;
                setMappingProgress({ current: mapped + skipped + failed, total: toTry.length });
                setStatus(`Mapping films to TMDB database… ${mapped + skipped + failed}/${toTry.length} (${mapped} mapped, ${failed} failed)`);
              }
            }
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      const totalMapped = mapped + existingMappings.size;
      setStatus(`✓ Successfully mapped ${totalMapped} of ${filmList.length} films to TMDB (${mapped} new, ${existingMappings.size} existing, ${skipped} no match, ${failed} failed)`);
      setMappingProgress(null);
      setAutoMappingActive(false);
    } catch (e) {
      console.error('[Import] autoMapBatch error', e);
      setAutoMappingActive(false);
      setMappingProgress(null);
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    console.log('[Import] handleFiles start', { fileCount: Array.from(files).length });
    setError(null);
    setStatus('Processing files…');
    const next: ParsedData = {};

    const fileArr = Array.from(files);
    // If a ZIP is present, prefer it; otherwise parse CSVs directly
    const zipFile = fileArr.find((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      try {
        console.log('[Import] detected ZIP', { name: zipFile.name, size: zipFile.size });
        const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
        const entries = Object.keys(zip.files);
        console.log('[Import] ZIP entries', entries.length);
        for (const entry of entries) {
          const key = entry.replace(/^.*\//, '').toLowerCase();
          // support likes/films.csv nested path
          const logical = ((): keyof ParsedData | null => {
            if (key === 'watched.csv') return 'watched';
            if (key === 'diary.csv') return 'diary';
            if (key === 'ratings.csv') return 'ratings';
            if (key === 'watchlist.csv') return 'watchlist';
            if (key === 'reviews.csv') return 'reviews';
            if (key === 'tags.csv') return 'tags';
            if (entry.toLowerCase().endsWith('likes/films.csv')) return 'likesFilms';
            if (entry.toLowerCase().includes('lists/') && entry.toLowerCase().endsWith('.csv')) return 'lists';
            return null;
          })();
          if (!logical) continue;
          const fileText = await zip.files[entry].async('string');
          const parsed = parseCsv(fileText);

          if (logical === 'lists') {
            // Aggregate lists
            next.lists = [...(next.lists || []), ...parsed];
          } else {
            (next as any)[logical] = parsed;
          }
        }
      } catch (e: any) {
        console.error('[Import] error reading ZIP', e);
        setError(e?.message ?? 'Failed to read ZIP');
      }
    } else {
      // Handle individual CSVs; allow folder drag-and-drop
      console.log('[Import] processing individual CSV files', { fileCount: fileArr.length });
      for (const f of fileArr) {
        if (!f.name.toLowerCase().endsWith('.csv')) continue;
        const lower = f.webkitRelativePath?.toLowerCase() || f.name.toLowerCase();
        let logical: keyof ParsedData | null = null;
        if (lower.endsWith('watched.csv')) logical = 'watched';
        else if (lower.endsWith('diary.csv')) logical = 'diary';
        else if (lower.endsWith('ratings.csv')) logical = 'ratings';
        else if (lower.endsWith('watchlist.csv')) logical = 'watchlist';
        else if (lower.endsWith('reviews.csv')) logical = 'reviews';
        else if (lower.endsWith('tags.csv')) logical = 'tags';
        else if (lower.endsWith('likes/films.csv')) logical = 'likesFilms';
        else if (lower.includes('lists/')) logical = 'lists';

        if (!logical) continue;
        const text = await f.text();
        const parsed = parseCsv(text);

        if (logical === 'lists') {
          next.lists = [...(next.lists || []), ...parsed];
        } else {
          (next as any)[logical] = parsed;
        }
      }
    }

    console.log('[Import] parsed raw data', {
      watched: next.watched?.length ?? 0,
      diary: next.diary?.length ?? 0,
      ratings: next.ratings?.length ?? 0,
      watchlist: next.watchlist?.length ?? 0,
      likesFilms: next.likesFilms?.length ?? 0,
      reviews: next.reviews?.length ?? 0,
      lists: next.lists?.length ?? 0,
      tags: next.tags?.length ?? 0,
    });
    setData(next);
    try {
      console.log('[Import] normalizeData start');
      const norm = normalizeData(next);
      console.log('[Import] normalizeData done', { filmCount: norm.films.length, distinctFilms: norm.distinctFilms });
      setDistinct(norm.distinctFilms);
      setFilms(norm.films);
      // Persist locally (IndexedDB)
      await saveFilmsLocally(norm.films);
      console.log('[Import] films saved locally');
      setStatus('Parsed and normalized. Saving to Supabase…');
      console.log('[Import] autoSaveToSupabase start');
      await autoSaveToSupabase(norm.films);
      console.log('[Import] autoSaveToSupabase done');
      // Upsert diary events for accurate watch counts if view/table exists
      try {
        if (next.diary?.length) {
          console.log('[Import] upserting diary events', { count: next.diary.length });
          const { data: sessionRes } = supabase ? await supabase.auth.getSession() : ({ data: { session: null } } as any);
          const uid = sessionRes?.session?.user?.id;
          if (uid) {
            const diaryRows = (next.diary || []).map(r => ({
              user_id: uid,
              uri: r['Letterboxd URI'] || '',
              watched_date: r['Date'] || null,
              rating: r['Rating'] ? Number(r['Rating']) : null,
              rewatch: (r['Rewatch'] || '').toLowerCase() === 'yes'
            })).filter(d => d.uri);
            console.log('[Import] diary rows prepared', { count: diaryRows.length });
            await upsertDiaryEvents(diaryRows);
            console.log('[Import] upsertDiaryEvents done');
          }
        }
      } catch {
        // ignore diary upsert errors (table may not exist yet)
      }
      // Auto-map (await to show progress)
      console.log('[Import] autoMapBatch start', { filmCount: norm.films.length });
      await autoMapBatch(norm.films);
      console.log('[Import] autoMapBatch complete');

      // Phase 5+: Batch learn from historical ratings
      console.log('[Import] Starting batch learning from historical data');
      setStatus('Analyzing your ratings for personalized recommendations…');
      const { data: sessionRes2 } = supabase ? await supabase.auth.getSession() : ({ data: { session: null } } as any);
      const uid2 = sessionRes2?.session?.user?.id;
      if (uid2) {
        try {
          await learnFromHistoricalData(uid2);
          console.log('[Import] Batch learning complete');
          setStatus('✓ Import complete! Your personalized recommendation algorithm is ready.');
        } catch (e) {
          console.error('[Import] Batch learning failed (non-critical):', e);
          setStatus('✓ Import complete!');
        }
      }
    } catch (e: any) {
      console.error('[Import] error in handleFiles normalization/save', e);
      setStatus('Parsed');
    }
    console.log('[Import] handleFiles end');
  }, [setFilms, autoSaveToSupabase, autoMapBatch]);

  const summary = useMemo(() => {
    const s: { label: string; count: number }[] = [];
    if (data.watched) s.push({ label: 'watched', count: data.watched.length });
    if (data.diary) {
      s.push({ label: 'diary', count: data.diary.length });
      // Calculate rewatches
      const rewatchCount = data.diary.filter(entry => (entry['Rewatch'] || '').toLowerCase() === 'yes').length;
      if (rewatchCount > 0) {
        s.push({ label: 'rewatches', count: rewatchCount });
      }
    }
    if (data.ratings) s.push({ label: 'ratings', count: data.ratings.length });
    if (data.watchlist) s.push({ label: 'watchlist', count: data.watchlist.length });
    if (data.likesFilms) s.push({ label: 'likes/films', count: data.likesFilms.length });
    if (data.reviews) s.push({ label: 'reviews', count: data.reviews.length });
    if (data.lists) s.push({ label: 'lists (entries)', count: data.lists.length });
    if (data.tags) s.push({ label: 'tags', count: data.tags.length });
    return s;
  }, [data]);

  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Import Letterboxd data</h1>
      <p className="text-gray-700 mb-3">
        Upload either your Letterboxd export ZIP or drag in individual CSVs (you can drop the whole
        folder). Parsing happens locally in your browser.
      </p>
      <div className="space-y-3">
        <input
          type="file"
          accept=".zip,.csv"
          multiple
          className="block"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            if (e.dataTransfer.items) {
              const items = Array.from(e.dataTransfer.items);
              const filePromises: Promise<File | null>[] = items.map(async (it) => {
                if (it.kind === 'file') {
                  const f = it.getAsFile();
                  return f;
                }
                return null;
              });
              const files = (await Promise.all(filePromises)).filter(Boolean) as File[];
              if (files.length) await handleFiles(files);
            } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
              await handleFiles(e.dataTransfer.files);
            }
          }}
          className="mt-3 border-2 border-dashed rounded p-6 text-sm text-gray-600 bg-gray-50"
        >
          Or drag-and-drop your export ZIP or the entire folder of CSVs here
        </div>
        {status && <p className="text-sm text-gray-600" aria-live="polite">{status}</p>}
        {error && <p className="text-sm text-red-600" aria-live="assertive">{error}</p>}

        {/* Progress bar for mapping */}
        {mappingProgress && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-700 font-medium">Mapping to TMDB</span>
              <span className="text-gray-600">
                {mappingProgress.current} / {mappingProgress.total}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${(mappingProgress.current / mappingProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Finding matches for your films in The Movie Database…
            </p>
          </div>
        )}
      </div>

      {summary.length > 0 && (
        <div className="mt-6 bg-white border rounded p-4">
          <h2 className="font-medium mb-2">Parsed summary</h2>
          <ul className="list-disc ml-5 text-sm">
            {summary.map((s) => (
              <li key={s.label}>
                {s.label}: <span className="font-mono">{s.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {distinct != null && (
            <p className="text-sm mt-2">
              Distinct films detected: <span className="font-mono">{distinct.toLocaleString()}</span>
            </p>
          )}
          <p className="text-sm text-gray-600 mt-3">
            Next: we’ll normalize and enrich this data to power stats and suggestions.
          </p>
        </div>
      )}


    </AuthGate>
  );
}
