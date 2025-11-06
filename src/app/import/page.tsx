'use client';
import AuthGate from '@/components/AuthGate';
import { useCallback, useMemo, useState, useEffect } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { normalizeData } from '@/lib/normalize';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { searchTmdb, upsertFilmMapping, upsertTmdbCache, getFilmMappings } from '@/lib/enrich';
import { saveFilmsLocally } from '@/lib/db';
import type { FilmEvent } from '@/lib/normalize';

type ParsedData = {
  watched?: Record<string, string>[];
  diary?: Record<string, string>[];
  ratings?: Record<string, string>[];
  watchlist?: Record<string, string>[];
  likesFilms?: Record<string, string>[];
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
  const [showMapper, setShowMapper] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    setStatus('Processing files…');
    const next: ParsedData = {};

    const fileArr = Array.from(files);
    // If a ZIP is present, prefer it; otherwise parse CSVs directly
    const zipFile = fileArr.find((f) => f.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      try {
        const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
        const entries = Object.keys(zip.files);
        for (const entry of entries) {
          const key = entry.replace(/^.*\//, '').toLowerCase();
          // support likes/films.csv nested path
          const logical = ((): keyof ParsedData | null => {
            if (key === 'watched.csv') return 'watched';
            if (key === 'diary.csv') return 'diary';
            if (key === 'ratings.csv') return 'ratings';
            if (key === 'watchlist.csv') return 'watchlist';
            if (entry.toLowerCase().endsWith('likes/films.csv')) return 'likesFilms';
            return null;
          })();
          if (!logical) continue;
          const fileText = await zip.files[entry].async('string');
          (next as any)[logical] = parseCsv(fileText);
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed to read ZIP');
      }
    } else {
      // Handle individual CSVs; allow folder drag-and-drop
      for (const f of fileArr) {
        if (!f.name.toLowerCase().endsWith('.csv')) continue;
        const lower = f.webkitRelativePath?.toLowerCase() || f.name.toLowerCase();
        let logical: keyof ParsedData | null = null;
        if (lower.endsWith('watched.csv')) logical = 'watched';
        else if (lower.endsWith('diary.csv')) logical = 'diary';
        else if (lower.endsWith('ratings.csv')) logical = 'ratings';
        else if (lower.endsWith('watchlist.csv')) logical = 'watchlist';
        else if (lower.endsWith('likes/films.csv')) logical = 'likesFilms';
        if (!logical) continue;
        const text = await f.text();
        (next as any)[logical] = parseCsv(text);
      }
    }

    setData(next);
    try {
  const norm = normalizeData(next);
      setDistinct(norm.distinctFilms);
      setFilms(norm.films);
  // Persist locally (IndexedDB)
  await saveFilmsLocally(norm.films);
      setStatus('Parsed and normalized');
      // Lightweight enrichment: try top N films to seed cache
      try {
        const { data: sessionRes } = supabase ? await supabase.auth.getSession() : { data: { session: null } } as any;
        const uid = sessionRes?.session?.user?.id;
        const toTry = norm.films.slice(0, 25); // limit for now
        for (const f of toTry) {
          if (!f.title) continue;
          try {
            const results = await searchTmdb(f.title, f.year ?? undefined);
            const best = results?.[0];
            if (best) {
              await upsertTmdbCache(best);
              if (uid) await upsertFilmMapping(uid, f.uri, best.id);
            }
          } catch {
            // ignore per-film errors
          }
        }
      } catch {
        // ignore enrichment errors, non-blocking
      }
    } catch (e: any) {
      setStatus('Parsed');
    }
  }, [setFilms]);

  const summary = useMemo(() => {
    const s: { label: string; count: number }[] = [];
    if (data.watched) s.push({ label: 'watched', count: data.watched.length });
    if (data.diary) s.push({ label: 'diary', count: data.diary.length });
    if (data.ratings) s.push({ label: 'ratings', count: data.ratings.length });
    if (data.watchlist) s.push({ label: 'watchlist', count: data.watchlist.length });
    if (data.likesFilms) s.push({ label: 'likes/films', count: data.likesFilms.length });
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
        {status && <p className="text-sm text-gray-600">{status}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
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

      <PreviewTable />

      {films && films.length > 0 && (
        <div className="mt-4">
          <button
            className="ml-3 px-4 py-2 bg-emerald-600 text-white rounded"
            onClick={async () => {
              try {
                if (!supabase) throw new Error('Supabase not initialized');
                const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
                if (sessErr) throw sessErr;
                const uid = sessionRes.session?.user?.id;
                if (!uid) throw new Error('Not signed in');
                // Upsert in batches to avoid payload limits
                const batchSize = 500;
                for (let i = 0; i < films.length; i += batchSize) {
                  const chunk = films.slice(i, i + batchSize).map((f) => ({
                    user_id: uid,
                    uri: f.uri,
                    title: f.title,
                    year: f.year ?? null,
                    rating: f.rating ?? null,
                    rewatch: f.rewatch ?? null,
                    last_date: f.lastDate ?? null,
                    liked: f.liked ?? null,
                    on_watchlist: f.onWatchlist ?? null,
                  }));
                  const { error } = await supabase.from('film_events').upsert(chunk, { onConflict: 'user_id,uri' });
                  if (error) throw error;
                }
                setStatus('Saved to Supabase');
              } catch (e: any) {
                setError(e?.message ?? 'Failed to save to Supabase');
              }
            }}
          >
            Save to Supabase
          </button>
          <button
            className="ml-3 px-4 py-2 bg-blue-600 text-white rounded"
            onClick={() => setShowMapper(true)}
          >
            Map to TMDB
          </button>
          <button
            className="ml-3 px-4 py-2 bg-gray-200 rounded"
            onClick={() => {
              const blob = new Blob([JSON.stringify(films, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'lettrsuggest-films.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export JSON
          </button>
        </div>
      )}
      {showMapper && films && (
        <MapperDrawer films={films} onClose={() => setShowMapper(false)} />)
      }
    </AuthGate>
  );
}

function PreviewTable() {
  const { films } = useImportData();
  if (!films || films.length === 0) return null;
  const rows = films.slice(0, 10);
  return (
    <div className="mt-6 bg-white border rounded p-4">
      <h2 className="font-medium mb-2">Preview (first 10 films)</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">Title</th>
              <th className="text-left p-2">Year</th>
              <th className="text-left p-2">Rating</th>
              <th className="text-left p-2">Liked</th>
              <th className="text-left p-2">Watchlist</th>
              <th className="text-left p-2">Rewatch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.uri} className="border-t">
                <td className="p-2">{f.title || f.uri}</td>
                <td className="p-2">{f.year ?? ''}</td>
                <td className="p-2">{f.rating ?? ''}</td>
                <td className="p-2">{f.liked ? '✓' : ''}</td>
                <td className="p-2">{f.onWatchlist ? '✓' : ''}</td>
                <td className="p-2">{f.rewatch ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MapperDrawer({ films, onClose }: { films: FilmEvent[]; onClose: () => void }) {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapped, setMapped] = useState<Record<string, number>>({});
  const [autoCount, setAutoCount] = useState(0);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState<string>('');
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        if (!supabase) throw new Error('Supabase not initialized');
        const { data: sessionRes, error: sErr } = await supabase.auth.getSession();
        if (sErr) throw sErr;
        const u = sessionRes.session?.user?.id ?? null;
        setUid(u);
        if (!u) return;
        const uris = films.map((f) => f.uri);
        const m = await getFilmMappings(u, uris);
        const rec: Record<string, number> = {};
        for (const [k, v] of m.entries()) rec[k] = v;
        setMapped(rec);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load mappings');
      }
    };
    void init();
  }, [films]);

  const total = films.length;
  const mappedKeys = Object.keys(mapped);
  const mappedCount = mappedKeys.length;
  const unmapped = films.filter((f) => mapped[f.uri] == null);

  const autoMap = async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    let success = 0;
    try {
      const N = Math.min(50, unmapped.length);
      for (let i = 0; i < N; i += 1) {
        const f = unmapped[i];
        if (!f?.title) continue;
        try {
          const results = await searchTmdb(f.title, f.year ?? undefined);
          const best = results?.[0];
          if (best) {
            await upsertTmdbCache(best);
            await upsertFilmMapping(uid, f.uri, best.id);
            setMapped((prev) => ({ ...prev, [f.uri]: best.id }));
            success += 1;
          }
        } catch {
          // ignore individual failures
        }
      }
      setAutoCount(success);
    } catch (e: any) {
      setError(e?.message ?? 'Auto-map failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 border rounded bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">TMDB Mapping</h2>
        <button className="text-sm underline" onClick={onClose}>Close</button>
      </div>
      <p className="text-sm text-gray-700 mt-2">
        {mappedCount}/{total} films mapped. Unmapped: {Math.max(total - mappedCount, 0)}
      </p>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-60"
          disabled={loading || !uid || unmapped.length === 0}
          onClick={autoMap}
        >
          {loading ? 'Auto-mapping…' : 'Auto-map first 50'}
        </button>
        {autoCount > 0 && (
          <span className="text-sm text-gray-600">Mapped {autoCount} just now</span>
        )}
      </div>
      <div className="mt-4 max-h-64 overflow-auto text-sm">
        <ul className="space-y-1">
          {unmapped.slice(0, 25).map((f) => (
            <li key={f.uri} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {f.title} {f.year ? `(${f.year})` : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 text-xs bg-gray-200 rounded"
                  onClick={() => {
                    setSelectedUri(f.uri);
                    setSearchQ(f.title);
                    setResults(null);
                  }}
                >
                  Search & map
                </button>
                <span className="text-gray-500">Unmapped</span>
              </div>
            </li>
          ))}
        </ul>
        {unmapped.length > 25 && (
          <p className="text-xs text-gray-500 mt-2">…and {unmapped.length - 25} more</p>
        )}
      </div>
      {selectedUri && (
        <div className="mt-4 border-t pt-4">
          <h3 className="font-medium text-sm mb-2">Manual mapping</h3>
          <div className="flex gap-2 items-center">
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search TMDB…"
              className="border rounded px-2 py-1 flex-1"
            />
            <button
              className="px-3 py-1 bg-black text-white text-sm rounded disabled:opacity-60"
              disabled={searching || !searchQ}
              onClick={async () => {
                try {
                  setSearching(true);
                  const res = await searchTmdb(searchQ);
                  setResults(res);
                } catch (e) {
                  setResults([]);
                } finally {
                  setSearching(false);
                }
              }}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
            <button className="text-sm underline" onClick={() => { setSelectedUri(null); setResults(null); }}>Cancel</button>
          </div>
          {results && (
            <ul className="mt-3 space-y-2 text-sm">
              {results.slice(0, 8).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between border rounded p-2">
                  <div>
                    <div className="font-medium">{r.title} {r.release_date ? `(${String(r.release_date).slice(0,4)})` : ''}</div>
                    <div className="text-gray-600">TMDB ID: {r.id}</div>
                  </div>
                  <button
                    className="px-2 py-1 bg-emerald-600 text-white rounded"
                    onClick={async () => {
                      if (!uid || !selectedUri) return;
                      try {
                        await upsertTmdbCache({ id: r.id, title: r.title, release_date: r.release_date, poster_path: r.poster_path, backdrop_path: r.backdrop_path, overview: r.overview });
                        await upsertFilmMapping(uid, selectedUri, r.id);
                        setMapped((prev) => ({ ...prev, [selectedUri]: r.id }));
                        setSelectedUri(null);
                        setResults(null);
                      } catch (e) {
                        // ignore
                      }
                    }}
                  >
                    Map
                  </button>
                </li>
              ))}
              {results.length === 0 && (
                <li className="text-gray-600">No results</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
