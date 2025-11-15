'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function NavBar() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkUser() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      setLoading(false);
    }
    checkUser();

    // Listen for auth changes
    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });

      return () => subscription.unsubscribe();
    }
  }, []);

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
  };

  return (
    <header className="border-b bg-white">
      <nav className="mx-auto max-w-6xl px-4 py-3 flex gap-4 items-center">
        <a href="/" className="font-semibold">LettrSuggest</a>
        {user && (
          <>
            <a href="/import" className="text-sm text-gray-600 hover:text-gray-900">Import</a>
            <a href="/library" className="text-sm text-gray-600 hover:text-gray-900">Library</a>
            <a href="/watchlist" className="text-sm text-gray-600 hover:text-gray-900">Watchlist</a>
            <a href="/suggest" className="text-sm text-gray-600 hover:text-gray-900">Suggestions</a>
            <a href="/stats" className="text-sm text-gray-600 hover:text-gray-900">Stats</a>
          </>
        )}
        <div className="ml-auto flex gap-3 items-center">
          {loading ? (
            <span className="text-sm text-gray-400">...</span>
          ) : user ? (
            <>
              <span className="text-sm text-gray-600">
                {user.email}
              </span>
              <button 
                onClick={handleSignOut}
                className="text-sm text-gray-600 hover:text-gray-900 underline"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href="/auth/login" className="text-sm text-gray-600 hover:text-gray-900">
                Sign in
              </a>
              <a href="/auth/register" className="text-sm text-gray-600 hover:text-gray-900">
                Create account
              </a>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
