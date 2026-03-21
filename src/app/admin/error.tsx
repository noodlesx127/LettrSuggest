"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-700 rounded-xl p-8 text-center">
        <div className="text-3xl mb-4">⚠️</div>
        <h2 className="text-lg font-semibold text-red-400 mb-2">
          Admin Dashboard Error
        </h2>
        <p className="text-sm text-zinc-400 mb-1">{error.message}</p>
        {error.digest && (
          <p className="text-xs text-zinc-600 font-mono mt-1">
            Digest: {error.digest}
          </p>
        )}
        <p className="text-xs text-zinc-500 mt-4 mb-6">
          If this is a configuration issue, ensure{" "}
          <code className="text-zinc-300">SUPABASE_SERVICE_ROLE_KEY</code> is
          set in your Netlify environment variables.
        </p>
        <button
          onClick={reset}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
