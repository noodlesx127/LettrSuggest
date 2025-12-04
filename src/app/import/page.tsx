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

// Import step definitions
type ImportStep = 'idle' | 'upload' | 'parse' | 'save' | 'enrich' | 'learn' | 'complete';

const STEPS: { key: ImportStep; label: string; description: string }[] = [
  { key: 'upload', label: 'Upload', description: 'Select your Letterboxd export' },
  { key: 'parse', label: 'Parse', description: 'Reading your watch history' },
  { key: 'save', label: 'Save', description: 'Storing your data securely' },
  { key: 'enrich', label: 'Enrich', description: 'Fetching movie details' },
  { key: 'learn', label: 'Learn', description: 'Building your taste profile' },
];

function StepIndicator({ currentStep, completedSteps }: { currentStep: ImportStep; completedSteps: Set<ImportStep> }) {
  if (currentStep === 'idle') return null;
  
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps.has(step.key);
          const isCurrent = currentStep === step.key;
          const isPending = !isCompleted && !isCurrent;
          
          return (
            <div key={step.key} className="flex items-center flex-1">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? 'bg-blue-600 text-white ring-4 ring-blue-200'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span className={`mt-2 text-xs font-medium ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'}`}>
                  {step.label}
                </span>
              </div>
              
              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-1 mx-2 rounded ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
      
      {/* Current step description */}
      {currentStep !== 'complete' && (
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-600">
            {STEPS.find(s => s.key === currentStep)?.description || ''}
          </p>
        </div>
      )}
    </div>
  );
}

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
  const [forceReenrich, setForceReenrich] = useState(false);
  const [newFilmsBreakdown, setNewFilmsBreakdown] = useState<{
    newWatched: number;
    newWatchlist: number;
    newRatings: number;
    newLikes: number;
    total: number;
    isReimport: boolean;
  } | null>(null);
  
  // Step tracking
  const [currentStep, setCurrentStep] = useState<ImportStep>('idle');
  const [completedSteps, setCompletedSteps] = useState<Set<ImportStep>>(new Set());
  
  const completeStep = useCallback((step: ImportStep) => {
    setCompletedSteps(prev => new Set([...prev, step]));
  }, []);

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

      // First, get existing mappings to skip already-mapped films (unless force re-enrich)
      let existingMappings = new Set<string>();
      if (!forceReenrich) {
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
      } else {
        console.log('[Import] Force re-enrich enabled, will re-enrich all films');
      }

      // Filter to only films that need mapping (or all if force re-enrich)
      const toTry = filmList.filter(f => f.title && !existingMappings.has(f.uri));
      console.log(`[Import] Need to enrich ${toTry.length} of ${filmList.length} films (${existingMappings.size} already mapped, ${filmList.filter(f => !f.title).length} have no title${forceReenrich ? ', FORCE RE-ENRICH' : ''}`);

      // Categorize new films for user feedback
      const isReimport = existingMappings.size > 0;
      if (isReimport && !forceReenrich) {
        const newWatched = toTry.filter(f => (f.watchCount ?? 0) > 0 && !f.onWatchlist).length;
        const newWatchlist = toTry.filter(f => f.onWatchlist).length;
        const newRatings = toTry.filter(f => f.rating != null && f.rating > 0).length;
        const newLikes = toTry.filter(f => f.liked).length;
        setNewFilmsBreakdown({
          newWatched,
          newWatchlist,
          newRatings,
          newLikes,
          total: toTry.length,
          isReimport: true
        });
        console.log('[Import] New films breakdown:', { newWatched, newWatchlist, newRatings, newLikes, total: toTry.length });
      } else {
        setNewFilmsBreakdown({
          newWatched: filmList.filter(f => (f.watchCount ?? 0) > 0 && !f.onWatchlist).length,
          newWatchlist: filmList.filter(f => f.onWatchlist).length,
          newRatings: filmList.filter(f => f.rating != null && f.rating > 0).length,
          newLikes: filmList.filter(f => f.liked).length,
          total: toTry.length,
          isReimport: false
        });
      }

      let enriched = 0;
      let skipped = 0; // No TMDB results found
      let failed = 0; // API errors
      let next = 0;
      const concurrency = 2; // Reduced to avoid rate limits
      let lastRequestTime = 0;
      const minDelay = 300; // 300ms between requests (max ~3 requests/sec)

      setMappingProgress({ current: 0, total: toTry.length });
      setStatus(`Enriching films with TMDB, OMDb, and Watchmode data… 0/${toTry.length}`);

      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Import the enrichment function
      const { enrichMovieForImport } = await import('@/lib/importEnrich');

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
              // Use comprehensive enrichment (TMDB + TuiMDB + OMDb + Watchmode)
              const enrichedMovie = await enrichMovieForImport(f.title, f.year ?? undefined);

              if (enrichedMovie) {
                // Movie was found and enriched - create mapping
                await upsertFilmMapping(uid, f.uri, enrichedMovie.id);
                enriched += 1;
                success = true;
                setMappingProgress({ current: enriched + skipped + failed, total: toTry.length });
                setStatus(`Enriching films… ${enriched + skipped + failed}/${toTry.length} (${enriched} enriched, ${skipped} no match)`);
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('lettr:mappings-updated'));
                }
              } else {
                // No results found
                skipped += 1;
                success = true;
                console.log(`[Import] No TMDB results for: ${f.title} (${f.year || 'no year'})`);
                setMappingProgress({ current: enriched + skipped + failed, total: toTry.length });
                setStatus(`Enriching films… ${enriched + skipped + failed}/${toTry.length} (${enriched} enriched, ${skipped} no match)`);
              }
              break; // Success (enriched or no results), exit retry loop
            } catch (e: any) {
              retries--;
              if (retries > 0) {
                console.warn(`[Import] Retry ${3 - retries}/3 for ${f.title}`, e?.message);
                await sleep(backoff);
                backoff *= 2; // Exponential backoff
              } else {
                console.error(`[Import] Failed to enrich ${f.title} after 3 retries`, e);
                failed += 1;
                setMappingProgress({ current: enriched + skipped + failed, total: toTry.length });
                setStatus(`Enriching films… ${enriched + skipped + failed}/${toTry.length} (${enriched} enriched, ${failed} failed)`);
              }
            }
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      const totalEnriched = enriched + existingMappings.size;
      setStatus(`✓ Successfully enriched ${totalEnriched} of ${filmList.length} films with multi-API data (${enriched} new, ${existingMappings.size} existing, ${skipped} no match, ${failed} failed)`);
      setMappingProgress(null);
      setAutoMappingActive(false);
    } catch (e) {
      console.error('[Import] autoMapBatch error', e);
      setAutoMappingActive(false);
      setMappingProgress(null);
    }
  }, [forceReenrich]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    console.log('[Import] handleFiles start', { fileCount: Array.from(files).length });
    setError(null);
    setCurrentStep('upload');
    setCompletedSteps(new Set());
    setStatus('Processing files…');
    const next: ParsedData = {};

    // Mark upload complete, start parse
    completeStep('upload');
    setCurrentStep('parse');

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
          // Skip files in deleted/ or orphaned/ subdirectories
          const lowerEntry = entry.toLowerCase();
          if (lowerEntry.includes('/deleted/') || lowerEntry.includes('/orphaned/') ||
              lowerEntry.startsWith('deleted/') || lowerEntry.startsWith('orphaned/')) {
            console.log('[Import] Skipping deleted/orphaned file:', entry);
            continue;
          }
          
          const key = entry.replace(/^.*\//, '').toLowerCase();
          // support likes/films.csv nested path
          const logical = ((): keyof ParsedData | null => {
            if (key === 'watched.csv') return 'watched';
            if (key === 'diary.csv') return 'diary';
            if (key === 'ratings.csv') return 'ratings';
            if (key === 'watchlist.csv') return 'watchlist';
            if (key === 'reviews.csv') return 'reviews';
            if (key === 'tags.csv') return 'tags';
            if (lowerEntry.endsWith('likes/films.csv')) return 'likesFilms';
            if (lowerEntry.includes('lists/') && lowerEntry.endsWith('.csv')) return 'lists';
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
        
        // Skip files from deleted/ and orphaned/ subdirectories
        if (lower.includes('/deleted/') || lower.includes('/orphaned/') || 
            lower.includes('\\deleted\\') || lower.includes('\\orphaned\\')) {
          console.log('[Import] skipping deleted/orphaned file:', lower);
          continue;
        }
        
        let logical: keyof ParsedData | null = null;
        if (lower.endsWith('watched.csv')) logical = 'watched';
        else if (lower.endsWith('diary.csv')) logical = 'diary';
        else if (lower.endsWith('ratings.csv')) logical = 'ratings';
        else if (lower.endsWith('watchlist.csv')) logical = 'watchlist';
        else if (lower.endsWith('reviews.csv')) logical = 'reviews';
        else if (lower.endsWith('tags.csv')) logical = 'tags';
        // Handle both forward slashes (ZIP) and backslashes (Windows folder)
        else if (lower.endsWith('likes/films.csv') || lower.endsWith('likes\\films.csv')) logical = 'likesFilms';
        else if (lower.includes('lists/') || lower.includes('lists\\')) logical = 'lists';

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
      
      // Parse complete, move to save
      completeStep('parse');
      setCurrentStep('save');
      
      // Persist locally (IndexedDB)
      await saveFilmsLocally(norm.films);
      console.log('[Import] films saved locally');
      setStatus('Saving to cloud…');
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
      
      // Save complete, move to enrich
      completeStep('save');
      setCurrentStep('enrich');
      
      // Auto-map (await to show progress)
      console.log('[Import] autoMapBatch start', { filmCount: norm.films.length });
      await autoMapBatch(norm.films);
      console.log('[Import] autoMapBatch complete');

      // Enrich complete, move to learn
      completeStep('enrich');
      setCurrentStep('learn');

      // Phase 5+: Batch learn from historical ratings
      console.log('[Import] Starting batch learning from historical data');
      setStatus('Analyzing your taste preferences…');
      const { data: sessionRes2 } = supabase ? await supabase.auth.getSession() : ({ data: { session: null } } as any);
      const uid2 = sessionRes2?.session?.user?.id;
      if (uid2) {
        try {
          await learnFromHistoricalData(uid2);
          console.log('[Import] Batch learning complete');
        } catch (e) {
          console.error('[Import] Batch learning failed (non-critical):', e);
        }
      }
      
      // All done!
      completeStep('learn');
      setCurrentStep('complete');
      setStatus('✓ Import complete! Your personalized recommendations are ready.');
    } catch (e: any) {
      console.error('[Import] error in handleFiles normalization/save', e);
      setError(e?.message ?? 'Import failed');
      setStatus('');
    }
    console.log('[Import] handleFiles end');
  }, [setFilms, autoSaveToSupabase, autoMapBatch, completeStep]);

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
      <h1 className="text-xl font-semibold mb-2">Import Letterboxd data</h1>
      <p className="text-gray-600 text-sm mb-6">
        Upload your Letterboxd export ZIP or drag in individual CSVs. Parsing happens locally in your browser.
      </p>
      
      {/* Step Progress Indicator */}
      <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />
      
      {/* Upload Area - shown when idle or in early stages */}
      {(currentStep === 'idle' || currentStep === 'upload') && (
        <div className="space-y-3">
          {/* Force Re-enrich Option */}
          <label className="flex items-center gap-2 text-sm text-gray-700 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100">
            <input
              type="checkbox"
              checked={forceReenrich}
              onChange={(e) => setForceReenrich(e.target.checked)}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <div>
              <span className="font-medium">Force re-enrich all films</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Re-fetch TMDB data for all films, even if previously mapped. Use this if your stats/suggestions are missing data.
              </p>
            </div>
          </label>

          <input
            type="file"
            accept=".zip,.csv"
            multiple
            className="block text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <div
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50'); }}
            onDrop={async (e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50');
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
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-sm text-gray-500 bg-gray-50 transition-colors cursor-pointer hover:border-gray-400"
          >
            <svg className="mx-auto h-10 w-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="font-medium text-gray-700">Drop your export ZIP here</p>
            <p className="text-xs text-gray-500 mt-1">or the entire folder of CSVs</p>
          </div>
        </div>
      )}
      
      {/* Progress Area - shown during import */}
      {currentStep !== 'idle' && currentStep !== 'upload' && (
        <div className="space-y-4">
          {/* Reimport detection message */}
          {newFilmsBreakdown && newFilmsBreakdown.isReimport && currentStep === 'enrich' && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
              <p className="text-sm font-medium text-green-800">
                🔄 Reimport detected — enriching {newFilmsBreakdown.total} new film{newFilmsBreakdown.total !== 1 ? 's' : ''} only
              </p>
              <p className="text-xs text-green-600 mt-1">
                Previously imported films are already mapped. Use &quot;Force re-enrich&quot; to update all.
              </p>
            </div>
          )}
          
          {/* Status message */}
          {status && (
            <div className={`p-4 rounded-lg ${currentStep === 'complete' ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'}`}>
              <p className={`text-sm font-medium ${currentStep === 'complete' ? 'text-green-800' : 'text-blue-800'}`}>
                {status}
              </p>
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          )}

          {/* Detailed progress for enrich step */}
          {currentStep === 'enrich' && mappingProgress && (
            <div className="bg-white border rounded-lg p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-700 font-medium">Mapping films to TMDB</span>
                <span className="text-gray-600 font-mono">
                  {mappingProgress.current} / {mappingProgress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(mappingProgress.current / mappingProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Fetching movie details, ratings, and streaming info from multiple sources…
              </p>
              
              {/* New films breakdown */}
              {newFilmsBreakdown && newFilmsBreakdown.isReimport && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-green-700 mb-2">🆕 New since last import:</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {newFilmsBreakdown.newWatched > 0 && (
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newWatched} watched
                      </span>
                    )}
                    {newFilmsBreakdown.newWatchlist > 0 && (
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newWatchlist} watchlist
                      </span>
                    )}
                    {newFilmsBreakdown.newRatings > 0 && (
                      <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newRatings} rated
                      </span>
                    )}
                    {newFilmsBreakdown.newLikes > 0 && (
                      <span className="bg-pink-100 text-pink-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newLikes} liked
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Parsed Summary */}
      {summary.length > 0 && (
        <div className="mt-6 bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Parsed from your export
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summary.map((s) => (
              <div key={s.label} className="bg-gray-50 rounded p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{s.count.toLocaleString()}</p>
                <p className="text-xs text-gray-500 capitalize">{s.label}</p>
              </div>
            ))}
          </div>
          {distinct != null && (
            <p className="text-sm text-gray-600 mt-4 pt-3 border-t">
              <span className="font-medium">{distinct.toLocaleString()}</span> unique films detected
            </p>
          )}
        </div>
      )}
      
      {/* Complete state - show next steps */}
      {currentStep === 'complete' && (
        <div className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6 text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">🎬 You&apos;re all set!</h3>
          <p className="text-sm text-gray-600 mb-4">
            Your taste profile has been built from your watch history. Ready to discover your next favorite film?
          </p>
          <div className="flex gap-3 justify-center">
            <a
              href="/suggest"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Get Suggestions →
            </a>
            <a
              href="/stats"
              className="inline-flex items-center px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border hover:bg-gray-50 transition-colors"
            >
              View Your Stats
            </a>
          </div>
        </div>
      )}
    </AuthGate>
  );
}
