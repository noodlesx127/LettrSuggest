"use client";

import { useCallback } from "react";
import type { UserDetail } from "@/app/actions/admin";

interface ViewAsTabProps {
  userDetail: UserDetail;
}

export default function ViewAsTab({ userDetail }: ViewAsTabProps) {
  const handleCopyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userDetail.id);
    } catch {
      // Clipboard not available
    }
  }, [userDetail.id]);

  return (
    <div className="p-6 animate-fade-in">
      {/* Info Card */}
      <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-700/30 bg-zinc-700/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
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
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">
                View As User
              </h3>
              <p className="text-xs text-zinc-500">
                Impersonate this user to see their experience
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-zinc-400 leading-relaxed">
            View-As mode is coming soon. This will allow admins to browse the
            application as this user, seeing their library, recommendations, and
            settings — without modifying any data.
          </p>

          {/* User reference info */}
          <div className="bg-zinc-900/50 border border-zinc-700/30 rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-medium">Email</span>
              <span className="text-xs font-mono text-zinc-300">
                {userDetail.email}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-medium">User ID</span>
              <button
                onClick={handleCopyId}
                title="Copy user ID"
                className="group flex items-center gap-1.5"
              >
                <code className="text-xs font-mono text-zinc-400 select-all">
                  {userDetail.id}
                </code>
                <svg
                  className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors"
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
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-medium">Role</span>
              <span className="text-xs font-mono text-zinc-400 uppercase">
                {userDetail.role}
              </span>
            </div>
          </div>

          {/* Coming soon badge */}
          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex items-center px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[10px] font-semibold text-indigo-300 uppercase tracking-wider">
              Coming Soon
            </span>
            <span className="text-[10px] text-zinc-600">
              Planned for a future release
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
