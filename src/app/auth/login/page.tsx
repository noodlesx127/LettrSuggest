'use client';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type FormData = { email: string; password: string };

export default function LoginPage() {
  const { register, handleSubmit } = useForm<FormData>();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      if (!supabase) throw new Error('Auth not initialized');
      const { error } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password });
      if (error) throw error;
      router.push('/');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to sign in');
    }
  };

  return (
    <div className="max-w-sm">
      <h1 className="text-xl font-semibold mb-4">Sign in</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" suppressHydrationWarning>
        <div suppressHydrationWarning>
          <label className="block text-sm mb-1">Email</label>
          <input {...register('email')} type="email" className="w-full border rounded px-3 py-2" required suppressHydrationWarning />
        </div>
        <div suppressHydrationWarning>
          <label className="block text-sm mb-1">Password</label>
          <input {...register('password')} type="password" className="w-full border rounded px-3 py-2" required suppressHydrationWarning />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="px-4 py-2 bg-black text-white rounded">Sign in</button>
      </form>
      <p className="text-sm mt-3">
        No account? <a className="underline" href="/auth/register">Create one</a>
      </p>
    </div>
  );
}
