import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;

if (typeof window !== 'undefined') {
  if (!supabaseUrl) console.warn('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!supabaseAnonKey) console.warn('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : undefined;

export type SupabaseClientType = typeof supabase;
