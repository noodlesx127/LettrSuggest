'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const init = async () => {
      if (!supabase) {
        setEmail(null);
        return;
      }
      const { data } = await supabase.auth.getSession();
      setEmail(data.session?.user?.email ?? null);
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setEmail(session?.user?.email ?? null);
      });
      unsub = () => sub.subscription.unsubscribe();
    };
    void init();
    return () => {
      if (unsub) unsub();
    };
  }, []);
  if (email === undefined) return <p>Loading…</p>;
  if (!email) return <p>Please <a className="underline" href="/auth/login">sign in</a>.</p>;
  return (
    <div>
      <div className="text-sm text-gray-600 mb-3 flex items-center gap-2">
        <span>Signed in as {email}</span>
        <button
          className="underline"
          onClick={async () => {
            if (supabase) await supabase.auth.signOut();
          }}
        >
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}
