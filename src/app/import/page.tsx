'use client';
import AuthGate from '@/components/AuthGate';
import { useCallback, useMemo, useState } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { normalizeData } from '@/lib/normalize';

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
  const [data, setData] = useState<ParsedData>({});
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [distinct, setDistinct] = useState<number | null>(null);

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
      setStatus('Parsed and normalized');
    } catch (e: any) {
      setStatus('Parsed');
    }
  }, []);

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
    </AuthGate>
  );
}
