"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { supabase } from "@/lib/supabaseClient";

type GateState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "denied" }
  | { status: "allowed" };

/**
 * Client-side UI gate — prevents non-admin users from seeing the admin UI.
 * NOT a security boundary: all admin mutations are protected server-side
 * via requireAdmin() in src/app/actions/admin.ts.
 */
export default function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    let unsub: (() => void) | undefined;

    const check = async () => {
      if (!supabase) {
        setState({ status: "signed_out" });
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.user?.id) {
        setState({ status: "signed_out" });
        return;
      }

      const userId = data.session.user.id;

      const { data: roleRow, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single();

      if (roleError) {
        setState({ status: "denied" });
        return;
      }

      if (roleRow?.role === "admin") {
        setState({ status: "allowed" });
      } else {
        setState({ status: "denied" });
      }
    };

    void check();

    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((event, _session) => {
        if (event === "INITIAL_SESSION") return; // already handled by initial check()
        setState({ status: "loading" });
        void check();
      });
      unsub = () => data.subscription.unsubscribe();
    }

    return () => {
      if (unsub) unsub();
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center py-10">
        <div
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900"
        />
      </div>
    );
  }

  if (state.status === "signed_out") {
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <p className="text-sm text-gray-700">Please sign in to continue.</p>
        <p className="mt-2">
          <Link className="underline" href="/auth/login">
            Go to login
          </Link>
        </p>
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="mx-auto max-w-xl py-10 text-center">
        <p className="text-sm font-semibold text-gray-900">
          Access Denied — Admin access required
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
