"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";

import AdminGate from "@/components/AdminGate";
import AdminUserList from "@/app/admin/components/AdminUserList";
import AdminAuditLog from "@/app/admin/components/AdminAuditLog";
import { supabase } from "@/lib/supabaseClient";
import { getBlockedSuggestions, unblockSuggestion } from "@/lib/enrich";

// Heavy panel — lazy load via next/dynamic (bundle-dynamic-imports)
const UserDetailPanel = dynamic(
  () => import("@/app/admin/components/UserDetailPanel"),
  { ssr: false },
);

// ─── Tools section (preserved from old admin page) ───────────────────────────

interface TmdbSearchResult {
  id: number;
  title: string;
  release_date?: string;
}

interface BlockedMovie {
  tmdb_id: number;
  title?: string;
  poster_path?: string;
  year?: string;
}

function ToolsSection() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [blockedMovies, setBlockedMovies] = useState<BlockedMovie[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);

  useEffect(() => {
    const loadBlockedMovies = async (userId: string) => {
      try {
        setLoadingBlocked(true);
        const blockedIds = await getBlockedSuggestions(userId);

        const detailsPromises = Array.from(blockedIds).map(async (tmdbId) => {
          try {
            let movieData: {
              title?: string;
              poster_path?: string;
              release_date?: string;
            } | null = null;
            try {
              const tuiResponse = await fetch(
                `/api/tuimdb/movie?tmdb_id=${tmdbId}&_t=${Date.now()}`,
              );
              if (tuiResponse.ok) {
                const tuiData = (await tuiResponse.json()) as {
                  ok: boolean;
                  movie?: {
                    title?: string;
                    poster_path?: string;
                    release_date?: string;
                  };
                };
                if (tuiData.ok && tuiData.movie) movieData = tuiData.movie;
              }
            } catch {
              /* fallback to TMDB */
            }

            if (!movieData) {
              const response = await fetch(`/api/tmdb/movie/${tmdbId}`);
              if (response.ok) {
                const tmdbData = (await response.json()) as {
                  ok: boolean;
                  movie?: {
                    title?: string;
                    poster_path?: string;
                    release_date?: string;
                  };
                };
                if (tmdbData.ok && tmdbData.movie) movieData = tmdbData.movie;
              }
            }

            if (movieData) {
              return {
                tmdb_id: tmdbId,
                title: movieData.title,
                poster_path: movieData.poster_path,
                year: movieData.release_date?.slice(0, 4),
              };
            }
          } catch (e) {
            console.error(`[Admin] Failed to fetch details for ${tmdbId}:`, e);
          }
          return { tmdb_id: tmdbId };
        });

        const details = await Promise.all(detailsPromises);
        setBlockedMovies(details);
      } catch (e) {
        console.error("[Admin] Failed to load blocked movies:", e);
      } finally {
        setLoadingBlocked(false);
      }
    };

    const init = async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      setUid(userId);
      if (userId) {
        await loadBlockedMovies(userId);
      }
    };
    void init();
  }, []);

  const handleUnblock = async (tmdbId: number) => {
    if (!uid) return;
    try {
      await unblockSuggestion(uid, tmdbId);
      setBlockedMovies((prev) => prev.filter((m) => m.tmdb_id !== tmdbId));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lettr:blocked-updated"));
      }
    } catch (e) {
      console.error("[Admin] Failed to unblock movie:", e);
    }
  };

  const search = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch(`/api/tmdb/search?query=${encodeURIComponent(q)}`);
      const json = (await r.json()) as {
        ok: boolean;
        results?: TmdbSearchResult[];
        error?: string;
      };
      if (!r.ok || !json.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-700/20 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <svg
            className="w-4 h-4 text-indigo-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-sm font-semibold text-zinc-200">Tools</span>
          <span className="text-xs text-zinc-500">
            TMDB Search · Blocked Suggestions
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open ? (
        <div className="px-5 pb-5 pt-2 border-t border-zinc-700/40 space-y-6">
          {/* TMDB Search */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">
              TMDB Search
            </h3>
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                placeholder="Search movies…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void search();
                }}
              />
              <button
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                onClick={() => void search()}
                disabled={loading}
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
            {error !== null ? (
              <p className="text-sm text-red-400 mt-2">{error}</p>
            ) : null}
            {results.length > 0 ? (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Results
                </h4>
                <ul className="space-y-2">
                  {results.slice(0, 10).map((r) => (
                    <li
                      key={`${r.id}-${r.title}`}
                      className="border border-zinc-700/40 rounded-lg p-3 bg-zinc-800/40"
                    >
                      <div className="font-semibold text-sm text-zinc-200">
                        {r.title}{" "}
                        {r.release_date
                          ? `(${r.release_date.slice(0, 4)})`
                          : ""}
                      </div>
                      <div className="text-xs text-zinc-500 font-mono mt-0.5">
                        TMDB ID: {r.id}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Blocked Suggestions */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-1">
              Blocked Suggestions
            </h3>
            <p className="text-xs text-zinc-500 mb-4">
              Movies removed from suggestions. Click &quot;Unblock&quot; to
              allow them to appear again.
            </p>

            {loadingBlocked ? (
              <p className="text-sm text-zinc-500">Loading blocked movies…</p>
            ) : blockedMovies.length === 0 ? (
              <p className="text-sm text-zinc-500">No blocked movies yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {blockedMovies.map((movie) => (
                  <div
                    key={movie.tmdb_id}
                    className="border border-zinc-700/40 rounded-lg overflow-hidden bg-zinc-800/40"
                  >
                    <div className="aspect-[2/3] bg-zinc-700/40 relative">
                      {movie.poster_path ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w342${movie.poster_path}`}
                          alt={movie.title || `Movie ${movie.tmdb_id}`}
                          fill
                          sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 16vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500 p-2 text-center">
                          {movie.title || `#${movie.tmdb_id}`}
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p
                        className="text-xs font-medium leading-tight truncate text-zinc-200"
                        title={movie.title}
                      >
                        {movie.title || `Movie #${movie.tmdb_id}`}
                      </p>
                      {movie.year !== undefined ? (
                        <p className="text-[10px] text-zinc-500">
                          {movie.year}
                        </p>
                      ) : null}
                      <button
                        onClick={() => void handleUnblock(movie.tmdb_id)}
                        className="mt-2 w-full text-xs bg-indigo-600 text-white rounded py-1 hover:bg-indigo-500 transition-colors"
                      >
                        Unblock
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

function AdminDashboard() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [userListKey, setUserListKey] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAdminEmail(data.session?.user?.email ?? "");
    });
  }, []);

  const handleSelectUser = useCallback((userId: string) => {
    setSelectedUserId(userId);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedUserId(null);
  }, []);

  const handleUserUpdated = useCallback(() => {
    // Bump key to refresh the user list
    setUserListKey((k) => k + 1);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 -mx-4 -my-6 md:-mx-4 md:-my-6 w-[calc(100%+2rem)] md:w-[calc(100%+2rem)]">
      {/* ── Header ── */}
      <div className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-[1600px] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {/* Shield icon */}
              <svg
                className="w-5 h-5 text-indigo-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              <h1 className="text-lg font-bold text-zinc-100 tracking-tight">
                Admin{" "}
                <span className="font-mono text-indigo-400 text-base">
                  Dashboard
                </span>
              </h1>
            </div>
          </div>
          {adminEmail ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-mono text-zinc-400">{adminEmail}</span>
              <span className="px-1.5 py-0.5 bg-red-500/15 text-red-300 border border-red-500/20 rounded text-[10px] font-semibold uppercase tracking-wider">
                Admin
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
        {/* ── User Management + Detail Panel ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              User Management
            </h2>
          </div>

          <div
            className={`flex gap-0 border border-zinc-700/60 rounded-xl overflow-hidden bg-zinc-900 transition-all duration-300 ${
              selectedUserId !== null ? "min-h-[560px]" : "min-h-[420px]"
            }`}
          >
            {/* User list — flex-1 on desktop, full width on mobile when no panel */}
            <div
              className={`flex flex-col min-w-0 transition-all duration-300 ${
                selectedUserId !== null
                  ? "w-full md:flex-1 md:border-r md:border-zinc-700/60"
                  : "w-full"
              } ${selectedUserId !== null ? "hidden md:flex" : "flex"}`}
            >
              <AdminUserList
                key={userListKey}
                onSelectUser={handleSelectUser}
                selectedUserId={selectedUserId}
              />
            </div>

            {/* Detail panel — slide in when user selected */}
            {selectedUserId !== null ? (
              <div className="w-full md:w-[420px] flex-shrink-0 flex flex-col">
                {/* Mobile back button */}
                <div className="md:hidden px-4 py-2 border-b border-zinc-700/60 bg-zinc-800/50">
                  <button
                    onClick={handleClosePanel}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    Back to list
                  </button>
                </div>
                <div className="flex-1">
                  <UserDetailPanel
                    key={selectedUserId}
                    userId={selectedUserId}
                    onClose={handleClosePanel}
                    onUserUpdated={handleUserUpdated}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ── Tools (collapsible) ── */}
        <section>
          <ToolsSection />
        </section>

        {/* ── Audit Log ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Audit Log
            </h2>
          </div>
          <div className="border border-zinc-700/60 rounded-xl overflow-hidden bg-zinc-900 min-h-[320px]">
            <AdminAuditLog />
          </div>
        </section>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AdminGate>
      <AdminDashboard />
    </AdminGate>
  );
}
