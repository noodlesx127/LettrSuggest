"use client";

import { useCallback } from "react";
import type { UserDetail, TasteProfileSummary } from "@/app/actions/admin";

interface OverviewTabProps {
  userDetail: UserDetail;
  tasteProfile: TasteProfileSummary | null;
  loading: boolean;
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-4 bg-zinc-800/60 border border-zinc-700/40 rounded-lg">
      <div className="p-2 bg-zinc-700/50 rounded-md text-zinc-400">{icon}</div>
      <div>
        <p className="text-lg font-semibold font-mono text-zinc-100 tabular-nums">
          {value.toLocaleString()}
        </p>
        <p className="text-xs text-zinc-500 font-medium">{label}</p>
      </div>
    </div>
  );
}

function ChipList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) {
    return (
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          {label}
        </p>
        <p className="text-xs text-zinc-600 italic">None yet</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex px-2.5 py-1 bg-zinc-700/60 border border-zinc-600/40 rounded-md text-xs text-zinc-300"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function CopyableId({ label, value }: { label: string; value: string }) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API not available
    }
  }, [value]);

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-zinc-500 font-medium">{label}</span>
      <button
        onClick={handleCopy}
        title="Copy to clipboard"
        className="group flex items-center gap-2 px-2 py-1 -mr-2 rounded hover:bg-zinc-700/40 transition-colors"
      >
        <code className="text-xs font-mono text-zinc-300 select-all">
          {value}
        </code>
        <svg
          className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      </button>
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OverviewTab({
  userDetail,
  tasteProfile,
  loading,
}: OverviewTabProps) {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Stats Grid */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Activity
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard
            label="Films Tracked"
            value={userDetail.film_count}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                />
              </svg>
            }
          />
          <StatCard
            label="Ratings"
            value={userDetail.rating_count}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            }
          />
          <StatCard
            label="Watchlist"
            value={userDetail.watchlist_count}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                />
              </svg>
            }
          />
          <StatCard
            label="Diary Entries"
            value={userDetail.diary_count}
            icon={
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            }
          />
          <StatCard
            label="API Keys"
            value={userDetail.api_key_count}
            icon={
              <svg
                className="w-4 h-4"
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
            }
          />
        </div>
      </div>

      {/* Account Info */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Account Info
        </h3>
        <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-4 divide-y divide-zinc-700/30">
          <CopyableId label="User ID" value={userDetail.id} />
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-zinc-500 font-medium">Created</span>
            <span className="text-xs font-mono text-zinc-300">
              {formatDateTime(userDetail.created_at)}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-zinc-500 font-medium">
              Last Sign In
            </span>
            <span className="text-xs font-mono text-zinc-300">
              {formatDateTime(userDetail.last_sign_in_at)}
            </span>
          </div>
          {userDetail.suspended_at && (
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-zinc-500 font-medium">
                Suspended At
              </span>
              <span className="text-xs font-mono text-amber-300">
                {formatDateTime(userDetail.suspended_at)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Taste Profile */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Taste Profile
        </h3>
        {loading ? (
          <div
            className="flex items-center gap-2 p-4 bg-zinc-800/60 border border-zinc-700/40 rounded-lg"
            role="status"
            aria-label="Loading taste profile"
          >
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
            <span className="text-xs text-zinc-500">
              Loading taste profile...
            </span>
          </div>
        ) : tasteProfile ? (
          <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-4 space-y-4">
            {/* Feedback counts */}
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 flex items-center justify-center rounded bg-emerald-500/15 text-emerald-400">
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                  </svg>
                </span>
                <span className="text-sm font-mono text-zinc-300 tabular-nums">
                  {tasteProfile.likedCount}
                </span>
                <span className="text-xs text-zinc-500">liked</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 flex items-center justify-center rounded bg-red-500/15 text-red-400">
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M18 9.5a1.5 1.5 0 11-3 0v-6a1.5 1.5 0 013 0v6zM14 9.667v-5.43a2 2 0 00-1.106-1.79l-.05-.025A4 4 0 0011.057 2H5.64a2 2 0 00-1.962 1.608l-1.2 6A2 2 0 004.44 12H8v4a2 2 0 002 2 1 1 0 001-1v-.667a4 4 0 01.8-2.4l1.4-1.866a4 4 0 00.8-2.4z" />
                  </svg>
                </span>
                <span className="text-sm font-mono text-zinc-300 tabular-nums">
                  {tasteProfile.dislikedCount}
                </span>
                <span className="text-xs text-zinc-500">disliked</span>
              </div>
            </div>

            <ChipList label="Top Genres" items={tasteProfile.topGenres} />
            <ChipList label="Top Directors" items={tasteProfile.topDirectors} />
            <ChipList label="Top Actors" items={tasteProfile.topActors} />
          </div>
        ) : (
          <div className="p-4 bg-zinc-800/60 border border-zinc-700/40 rounded-lg">
            <p className="text-xs text-zinc-600 italic">
              No taste profile data available
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
