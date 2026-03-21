"use client";

import { useState, useEffect, useCallback } from "react";

import { supabase } from "@/lib/supabaseClient";
import { getAuditLog } from "@/app/actions/admin";
import type { AuditLogEntry, PaginatedResult } from "@/app/actions/admin";

const PER_PAGE = 25;

const KNOWN_ACTIONS = [
  "role.changed",
  "account.email_changed",
  "account.password_reset",
  "account.suspended",
  "account.unsuspended",
  "data.deleted",
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ActionBadge({ action }: { action: string }) {
  const colorMap: Record<string, string> = {
    "role.changed": "bg-blue-500/12 text-blue-300 border-blue-500/20",
    "account.email_changed":
      "bg-indigo-500/12 text-indigo-300 border-indigo-500/20",
    "account.password_reset":
      "bg-amber-500/12 text-amber-300 border-amber-500/20",
    "account.suspended": "bg-red-500/12 text-red-300 border-red-500/20",
    "account.unsuspended":
      "bg-emerald-500/12 text-emerald-300 border-emerald-500/20",
    "data.deleted": "bg-rose-500/12 text-rose-300 border-rose-500/20",
  };

  const style =
    colorMap[action] ?? "bg-zinc-500/12 text-zinc-400 border-zinc-500/20";

  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs font-mono font-medium border ${style}`}
    >
      {action}
    </span>
  );
}

function DetailsCell({ details }: { details: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  // SECURITY: Safe because React auto-escapes JSX children.
  // Do NOT refactor to use dangerouslySetInnerHTML or innerHTML.
  const json = JSON.stringify(details, null, 2);
  const preview = JSON.stringify(details);
  const isLong = preview.length > 60;

  if (Object.keys(details).length === 0) {
    return <span className="text-xs text-zinc-600 italic">\u2014</span>;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="group text-left"
        aria-expanded={expanded}
        aria-label="Toggle details"
      >
        <code className="text-[11px] font-mono text-zinc-400 bg-zinc-700/40 px-2 py-0.5 rounded border border-zinc-600/30 inline-block max-w-[200px] truncate group-hover:bg-zinc-600/40 transition-colors">
          {isLong ? preview.slice(0, 57) + "..." : preview}
        </code>
      </button>
      {expanded && (
        <pre className="mt-2 p-3 bg-zinc-900 border border-zinc-700/50 rounded-md text-[11px] font-mono text-zinc-300 overflow-auto max-h-48 leading-relaxed whitespace-pre-wrap">
          {json}
        </pre>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-700/40">
      <td className="px-4 py-3">
        <div className="h-4 w-28 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-32 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-24 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-32 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-36 animate-pulse bg-zinc-700 rounded" />
      </td>
    </tr>
  );
}

export default function AdminAuditLog() {
  const [result, setResult] = useState<PaginatedResult<AuditLogEntry> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!supabase) {
        setError("Supabase client not configured");
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setError("Session expired — please sign in again");
        return;
      }
      const data = await getAuditLog(token, {
        page,
        perPage: PER_PAGE,
        actionFilter: actionFilter || undefined,
      });
      setResult(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load audit log";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  const totalPages = result ? Math.ceil(result.total / PER_PAGE) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700/60 bg-zinc-800/50">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">Audit Log</h3>
          {result && (
            <span className="text-xs font-mono text-zinc-500">
              {result.total.toLocaleString()} entries
            </span>
          )}
        </div>
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by action type"
          className="px-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/60 transition-colors appearance-none cursor-pointer"
        >
          <option value="">All Actions</option>
          {KNOWN_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 bg-red-500/10 border-b border-red-500/20">
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm" role="grid" aria-label="Audit log">
          <thead className="sticky top-0 z-10">
            <tr className="bg-zinc-800 border-b border-zinc-700/80">
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider"
              >
                Timestamp
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider"
              >
                Admin
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider"
              >
                Action
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider"
              >
                Target User
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider"
              >
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-700/40">
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : result && result.data.length > 0 ? (
              result.data.map((entry) => (
                <tr
                  key={entry.id}
                  className="hover:bg-zinc-700/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400 whitespace-nowrap">
                    {formatTimestamp(entry.created_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-300 truncate max-w-[180px]">
                    {entry.admin_email || (
                      <span className="font-mono text-zinc-500">
                        {entry.admin_id.slice(0, 8)}...
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ActionBadge action={entry.action} />
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400 truncate max-w-[180px]">
                    {entry.target_email ??
                      (entry.target_id ? (
                        <span className="font-mono text-zinc-500">
                          {entry.target_id.slice(0, 8)}...
                        </span>
                      ) : (
                        <span className="text-zinc-600">\u2014</span>
                      ))}
                  </td>
                  <td className="px-4 py-3">
                    <DetailsCell details={entry.details} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-16 text-center text-zinc-500"
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg
                      className="w-8 h-8 text-zinc-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <span className="text-sm">No audit log entries</span>
                    {actionFilter && (
                      <span className="text-xs text-zinc-600">
                        Try removing the action filter
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {result && result.total > 0 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-700/60 bg-zinc-800/50">
          <span className="text-xs text-zinc-500">
            Showing{" "}
            <span className="font-mono text-zinc-400">
              {(page - 1) * PER_PAGE + 1}
            </span>
            {"\u2013"}
            <span className="font-mono text-zinc-400">
              {Math.min(page * PER_PAGE, result.total)}
            </span>{" "}
            of{" "}
            <span className="font-mono text-zinc-400">
              {result.total.toLocaleString()}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-700/50 border border-zinc-600/50 rounded-md hover:bg-zinc-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <span className="text-xs font-mono text-zinc-400">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-700/50 border border-zinc-600/50 rounded-md hover:bg-zinc-600/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
