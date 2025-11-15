'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function HomePage() {
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
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">LettrSuggest</h1>
        <p className="text-gray-700 max-w-2xl">Loading...</p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Welcome back!</h1>
        <p className="text-gray-700 max-w-2xl">
          Get started by importing your Letterboxd data, exploring your library, or viewing personalized movie suggestions.
        </p>
        <div className="flex gap-3">
          <a className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800" href="/import">
            Import Data
          </a>
          <a className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300" href="/library">
            View Library
          </a>
          <a className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300" href="/suggest">
            Get Suggestions
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">LettrSuggest</h1>
      <p className="text-gray-700 max-w-2xl">
        Upload your Letterboxd data to get personalized movie suggestions with clear reasons and
        a rich stats dashboard across your history.
      </p>
      <div className="flex gap-3">
        <a className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800" href="/auth/login">
          Sign in
        </a>
        <a className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300" href="/auth/register">
          Create account
        </a>
      </div>
    </div>
  );
}
