'use client';
import AuthGate from '@/components/AuthGate';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function ProfilePage() {
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

      // Delete all user data (cascading deletes will handle related tables)
      // Delete film events
      const { error: eventsError } = await supabase
        .from('film_events')
        .delete()
        .eq('user_id', uid);
      if (eventsError) throw eventsError;

      // Delete diary events
      const { error: diaryError } = await supabase
        .from('film_diary_events')
        .delete()
        .eq('user_id', uid);
      if (diaryError) throw diaryError;

      // Delete film mappings
      const { error: mappingError } = await supabase
        .from('film_tmdb_map')
        .delete()
        .eq('user_id', uid);
      if (mappingError) throw mappingError;

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
