'use client';
import AuthGate from '@/components/AuthGate';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getBlockedSuggestions, unblockSuggestion } from '@/lib/enrich';
import { useImportData } from '@/lib/importStore';
import Image from 'next/image';

export default function ProfilePage() {
  const { clear: clearImportStore } = useImportData();
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
          // Try TuiMDB first, fallback to TMDB
          let data = null;
          try {
            const tuiResponse = await fetch(`/api/tuimdb/movie?id=${tmdbId}&_t=${Date.now()}`);
            if (tuiResponse.ok) {
              const tuiData = await tuiResponse.json();
              if (tuiData.ok && tuiData.movie) data = tuiData.movie;
            }
          } catch (e) { /* fallback to TMDB */ }
          
          if (!data) {
            const response = await fetch(`/api/tmdb/movie/${tmdbId}`);
            if (response.ok) {
              const tmdbData = await response.json();
              if (tmdbData.ok && tmdbData.movie) data = tmdbData.movie;
            }
          }
          
          if (data) {
            return {
              tmdb_id: tmdbId,
              title: data.title,
              poster_path: data.poster_path,
              year: data.release_date?.slice(0, 4)
            };
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

  const handleDeleteAll = async () => {
    if (confirmText !== 'DELETE ALL') {
      setError('Please type "DELETE ALL" to confirm');
      return;
    }

    if (!supabase) {
      setError('Supabase not initialized');
      return;
    }

    try {
      setDeleting(true);
      setError(null);
      setSuccess(null);

      const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const uid = sessionRes.session?.user?.id;
      if (!uid) throw new Error('Not signed in');

      // Delete all user data in order (child tables first)
      // 1. Delete blocked suggestions
      const { error: blockedError } = await supabase
        .from('blocked_suggestions')
        .delete()
        .eq('user_id', uid);
      if (blockedError) throw blockedError;

      // 2. Delete diary events (individual watch entries)
      const { error: diaryError } = await supabase
        .from('film_diary_events')
        .delete()
        .eq('user_id', uid);
      if (diaryError) throw diaryError;

      // 3. Delete film mappings
      const { error: mappingError } = await supabase
        .from('film_tmdb_map')
        .delete()
        .eq('user_id', uid);
      if (mappingError) throw mappingError;

      // 4. Delete film events (aggregated film data)
      const { error: eventsError } = await supabase
        .from('film_events')
        .delete()
        .eq('user_id', uid);
      if (eventsError) throw eventsError;

      // 5. Clear local cache
      clearImportStore();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('lettr-import-v1');
      }

      // 6. Reset blocked movies state
      setBlockedMovies([]);

      setSuccess('All your data has been deleted successfully. You can now import fresh data.');
      setConfirmText('');
    } catch (e: any) {
      console.error('[Profile] Delete all error:', e);
      setError(e?.message ?? 'Failed to delete data');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AuthGate>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Profile Settings</h1>

        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Account Information</h2>
          <p className="text-sm text-gray-600 mb-4">
            Manage your LettrSuggest profile and data.
          </p>
        </div>

        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Blocked Suggestions</h2>
          <p className="text-sm text-gray-600 mb-4">
            Movies you&apos;ve removed from your suggestions. Click to add them back.
          </p>
          
          {loadingBlocked ? (
            <p className="text-sm text-gray-500">Loading blocked movies...</p>
          ) : blockedMovies.length === 0 ? (
            <p className="text-sm text-gray-500">No blocked suggestions yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {blockedMovies.map((movie) => (
                <div key={movie.tmdb_id} className="group relative">
                  <div className="aspect-[2/3] bg-gray-100 rounded-md overflow-hidden relative">
                    {movie.poster_path ? (
                      <Image
                        src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
                        alt={movie.title || 'Movie poster'}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center p-2">
                        No poster
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-60 transition-all flex items-center justify-center">
                      <button
                        onClick={() => handleUnblock(movie.tmdb_id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity bg-white text-gray-900 px-3 py-1 rounded-md text-sm font-medium"
                      >
                        Unblock
                      </button>
                    </div>
                  </div>
                  {movie.title && (
                    <p className="mt-2 text-xs text-gray-700 line-clamp-2">
                      {movie.title} {movie.year && `(${movie.year})`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-red-50 rounded-lg border border-red-200 p-6">
          <h2 className="text-xl font-semibold text-red-900 mb-2">Danger Zone</h2>
          <p className="text-sm text-red-700 mb-4">
            This action will permanently delete all your imported data, including:
          </p>
          <ul className="text-sm text-red-700 mb-4 list-disc list-inside space-y-1">
            <li>All film entries and ratings</li>
            <li>Watch history and diary events</li>
            <li>TMDB mappings</li>
            <li>Watchlist items</li>
          </ul>
          <p className="text-sm text-red-700 mb-4 font-semibold">
            This cannot be undone. You will need to re-import your Letterboxd data to restore it.
          </p>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type <span className="font-mono bg-gray-100 px-1">DELETE ALL</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="DELETE ALL"
              disabled={deleting}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-sm text-red-800">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded-md text-sm text-green-800">
              {success}
            </div>
          )}

          <button
            onClick={handleDeleteAll}
            disabled={deleting || confirmText !== 'DELETE ALL'}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {deleting ? 'Deleting...' : 'Delete All My Data'}
          </button>
        </div>
      </div>
    </AuthGate>
  );
}
