'use client';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useEffect, useState, type ReactNode } from 'react';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    if (!auth) {
      setUser(null);
      return;
    }
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);
  if (user === undefined) return <p>Loading…</p>;
  if (!user) return <p>Please <a className="underline" href="/auth/login">sign in</a>.</p>;
  return (
    <div>
      <div className="text-sm text-gray-600 mb-3 flex items-center gap-2">
        <span>Signed in as {user.email}</span>
  <button className="underline" onClick={() => auth && signOut(auth)}>Sign out</button>
      </div>
      {children}
    </div>
  );
}
