"use client";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    const init = async () => {
      if (!supabase) {
        setEmail(null);
        return;
      }
      const { data } = await supabase.auth.getSession();
      setEmail(data.session?.user?.email ?? null);

      // Check suspension status
      if (data.session?.user?.id) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("suspended_at")
          .eq("id", data.session.user.id)
          .single();
        setSuspended(!!profileData?.suspended_at);
      }

      const { data: sub } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          setEmail(session?.user?.email ?? null);
          if (session?.user?.id && supabase) {
            const { data: profileData } = await supabase
              .from("profiles")
              .select("suspended_at")
              .eq("id", session.user.id)
              .single();
            setSuspended(!!profileData?.suspended_at);
          } else {
            setSuspended(false);
          }
        },
      );
      unsub = () => sub.subscription.unsubscribe();
    };
    void init();
    return () => {
      if (unsub) unsub();
    };
  }, []);

  if (email === undefined) return <p>Loading…</p>;
  if (suspended)
    return (
      <p>Your account has been suspended. Contact support for assistance.</p>
    );
  if (!email)
    return (
      <p>
        Please{" "}
        <a className="underline" href="/auth/login">
          sign in
        </a>
        .
      </p>
    );
  return <>{children}</>;
}
