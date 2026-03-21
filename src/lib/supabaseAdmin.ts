import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. Server-side only.
// Never import this file into client components.
// Uses lazy initialization to avoid module-level throws that would crash
// Server Component renders if the env var is temporarily missing.

let _admin: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "[supabaseAdmin] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
          "Ensure these are set in your Netlify environment variables.",
      );
    }
    _admin = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _admin;
}

// Legacy named export for backward compatibility — lazily resolved via Proxy.
// Methods are bound to the real client to preserve correct `this` context.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const admin = getSupabaseAdmin();
    const value = admin[prop as keyof SupabaseClient];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(admin);
    }
    return value;
  },
});
