'use client';
import AuthGate from '@/components/AuthGate';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getBlockedSuggestions, unblockSuggestion } from '@/lib/enrich';
import Image from 'next/image';

export default function AdminPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [blockedMovies, setBlockedMovies] = useState<Array<{ tmdb_id: number; title?: string; poster_path?: string; year?: string }>>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      setUid(userId);
      
      if (userId) {
        await loadBlockedMovies(userId);
      }
    };
    void init();
  }, []);

  const loadBlockedMovies = async (userId: string) => {
    try {
      setLoadingBlocked(true);
      const blockedIds = await getBlockedSuggestions(userId);
      
      // Fetch movie details for each blocked ID
      const detailsPromises = Array.from(blockedIds).map(async (tmdbId) => {
        try {
          const response = await fetch(`/api/tmdb/movie/${tmdbId}`);
          if (response.ok) {
            const data = await response.json();
            if (data.ok && data.movie) {
              return {
                tmdb_id: tmdbId,
                title: data.movie.title,
                poster_path: data.movie.poster_path,
                year: data.movie.release_date?.slice(0, 4)
              };
            }
          }
        } catch (e) {
          console.error(`Failed to fetch details for ${tmdbId}:`, e);
        }
        return { tmdb_id: tmdbId };
      });
      
      const details = await Promise.all(detailsPromises);
      setBlockedMovies(details);
    } catch (e) {
      console.error('Failed to load blocked movies:', e);
    } finally {
      setLoadingBlocked(false);
    }
  };

  const handleUnblock = async (tmdbId: number) => {
    if (!uid) return;
    try {
      await unblockSuggestion(uid, tmdbId);
      setBlockedMovies(prev => prev.filter(m => m.tmdb_id !== tmdbId));
      
      // Notify suggest page to refresh
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lettr:blocked-updated'));
      }
    } catch (e) {
      console.error('Failed to unblock movie:', e);
    }
  };

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

      {/* Blocked Suggestions Section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Blocked Suggestions</h2>
        <p className="text-sm text-gray-600 mb-4">
          Movies you&apos;ve removed from suggestions. Click &quot;Unblock&quot; to allow them to appear again.
        </p>
        
        {loadingBlocked ? (
          <p className="text-sm text-gray-600">Loading blocked movies...</p>
        ) : blockedMovies.length === 0 ? (
          <p className="text-sm text-gray-600">No blocked movies yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {blockedMovies.map((movie) => (
              <div key={movie.tmdb_id} className="border rounded overflow-hidden bg-white shadow-sm">
                <div className="aspect-[2/3] bg-gray-200 relative">
                  {movie.poster_path ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
                      alt={movie.title || `Movie ${movie.tmdb_id}`}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 16vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 p-2 text-center">
                      {movie.title || `#${movie.tmdb_id}`}
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium leading-tight truncate" title={movie.title}>
                    {movie.title || `Movie #${movie.tmdb_id}`}
                  </p>
                  {movie.year && (
                    <p className="text-[10px] text-gray-500">{movie.year}</p>
                  )}
                  <button
                    onClick={() => handleUnblock(movie.tmdb_id)}
                    className="mt-2 w-full text-xs bg-blue-600 text-white rounded py-1 hover:bg-blue-700 transition-colors"
                  >
                    Unblock
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AuthGate>
  );
}
