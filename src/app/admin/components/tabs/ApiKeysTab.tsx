"use client";

import { useState, useEffect, useCallback } from "react";

import { getUserApiKeys } from "@/app/actions/admin";

interface ApiKeysTabProps {
  userId: string;
  /** Fetches a fresh access token on every call — never cached/stale. */
  getAccessToken: () => Promise<string>;
  onToast?: (message: string, type: "success" | "error") => void;
}

export default function ApiKeysTab({
  userId,
  getAccessToken,
  onToast: _onToast,
}: ApiKeysTabProps) {
  const [loaded, setLoaded] = useState(false);
  const [keys, setKeys] = useState<unknown[]>([]);

  const fetchKeys = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const result = await getUserApiKeys(token, userId);
      setKeys(result);
    } catch {
      setKeys([]);
    } finally {
      setLoaded(true);
    }
  }, [getAccessToken, userId]);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex flex-col items-center justify-center py-16 px-6 bg-zinc-800/40 border border-zinc-700/30 rounded-lg border-dashed">
        {/* Key icon */}
        <div className="w-14 h-14 rounded-full bg-zinc-700/50 flex items-center justify-center mb-4">
          <svg
            className="w-7 h-7 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
        </div>

        <h3 className="text-sm font-semibold text-zinc-300 mb-1">
          API Key Management
        </h3>
        <p className="text-xs text-zinc-500 text-center max-w-xs leading-relaxed">
          API key management coming soon &mdash; no{" "}
          <code className="font-mono bg-zinc-700/60 px-1 py-0.5 rounded text-zinc-400">
            api_keys
          </code>{" "}
          table exists yet.
        </p>

        {loaded && keys.length === 0 && (
          <div className="mt-4 px-3 py-1.5 bg-zinc-700/30 border border-zinc-600/30 rounded-md">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              0 keys found
            </span>
          </div>
        )}

        {!loaded && (
          <div
            className="mt-4 flex items-center gap-2"
            role="status"
            aria-label="Loading API keys"
          >
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
            <span className="text-xs text-zinc-500">Checking...</span>
          </div>
        )}
      </div>
    </div>
  );
}
