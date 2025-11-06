'use client';
import AuthGate from '@/components/AuthGate';
import { useState } from 'react';

export default function AdminPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch(`/api/tmdb/search?query=${encodeURIComponent(q)}`);
      const json = await r.json();
      if (!r.ok || !json.ok) throw new Error(json.error || 'Search failed');
      setResults(json.results || []);
    } catch (e: any) {
      setError(e?.message ?? 'Search failed');
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Admin</h1>
      <div className="mb-6">
        <label className="block text-sm mb-1">TMDB Search</label>
        <div className="flex gap-2">
          <input
            className="border rounded px-3 py-2 flex-1"
            placeholder="Search movies…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="px-4 py-2 bg-black text-white rounded" onClick={search} disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {results.length > 0 && (
          <div className="mt-4 text-sm">
            <h2 className="font-medium mb-2">Results</h2>
            <ul className="space-y-2">
              {results.slice(0, 10).map((r) => (
                <li key={`${r.id}-${r.title}`} className="border rounded p-2">
                  <div className="font-semibold">{r.title} {r.release_date ? `(${r.release_date.slice(0,4)})` : ''}</div>
                  <div className="text-gray-600">TMDB ID: {r.id}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AuthGate>
  );
}
