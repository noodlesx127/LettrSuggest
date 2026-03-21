"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import { supabase } from "@/lib/supabaseClient";
import { listUsers } from "@/app/actions/admin";
import type {
  AdminUser,
  PaginatedResult,
  UserRole,
  UserStatus,
} from "@/app/actions/admin";

interface AdminUserListProps {
  onSelectUser: (userId: string) => void;
  selectedUserId: string | null;
}

type SortColumn =
  | "email"
  | "role"
  | "status"
  | "film_count"
  | "last_sign_in_at"
  | "created_at";

type SortDir = "asc" | "desc";

const PER_PAGE = 25;

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    admin: "bg-red-500/15 text-red-300 border border-red-500/20",
    developer: "bg-blue-500/15 text-blue-300 border border-blue-500/20",
    user: "bg-zinc-500/15 text-zinc-400 border border-zinc-500/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium tracking-wide uppercase ${styles[role]}`}
    >
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: UserStatus }) {
  const styles: Record<UserStatus, string> = {
    active: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20",
    suspended: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === "active" ? "bg-emerald-400" : "bg-amber-400"
        }`}
      />
      {status}
    </span>
  );
}

function SortIcon({
  column,
  activeColumn,
  direction,
}: {
  column: SortColumn;
  activeColumn: SortColumn;
  direction: SortDir;
}) {
  if (column !== activeColumn) {
    return (
      <svg
        className="w-3 h-3 ml-1 opacity-30"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  }
  return (
    <svg
      className="w-3 h-3 ml-1 text-indigo-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      {direction === "asc" ? (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 15l7-7 7 7"
        />
      ) : (
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      )}
    </svg>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-700/50">
      <td className="px-4 py-3">
        <div className="h-4 w-40 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-16 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-16 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-10 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-24 animate-pulse bg-zinc-700 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-24 animate-pulse bg-zinc-700 rounded" />
      </td>
    </tr>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminUserList({
  onSelectUser,
  selectedUserId,
}: AdminUserListProps) {
  const [result, setResult] = useState<PaginatedResult<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search]);

  const fetchUsers = useCallback(async () => {
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
      const data = await listUsers(token, {
        page,
        perPage: PER_PAGE,
        search: debouncedSearch || undefined,
        roleFilter: roleFilter || undefined,
        statusFilter: statusFilter || undefined,
        sortBy,
        sortDir,
      });
      setResult(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load users";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, roleFilter, statusFilter, sortBy, sortDir]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (sortBy === column) {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(column);
        setSortDir("asc");
      }
      setPage(1);
    },
    [sortBy],
  );

  const totalPages = result ? Math.ceil(result.total / PER_PAGE) : 0;

  const columnHeaders: { key: SortColumn; label: string }[] = [
    { key: "email", label: "Email" },
    { key: "role", label: "Role" },
    { key: "status", label: "Status" },
    { key: "film_count", label: "Films" },
    { key: "last_sign_in_at", label: "Last Sign In" },
    { key: "created_at", label: "Created" },
  ];

  return (
    <div className="flex flex-col h-full relative">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-zinc-700/60 bg-zinc-800/50">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email..."
            aria-label="Search users by email"
            className="w-full pl-9 pr-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
          />
        </div>

        {/* Role filter */}
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
          className="px-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/60 transition-colors appearance-none cursor-pointer"
        >
          <option value="">All Roles</option>
          <option value="user">User</option>
          <option value="developer">Developer</option>
          <option value="admin">Admin</option>
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="px-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/60 transition-colors appearance-none cursor-pointer"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 bg-red-500/10 border-b border-red-500/20">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm" role="grid" aria-label="User list">
          <thead className="sticky top-0 z-10">
            <tr className="bg-zinc-800 border-b border-zinc-700/80">
              {columnHeaders.map(({ key, label }) => (
                <th
                  key={key}
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider cursor-pointer select-none hover:text-zinc-200 transition-colors"
                  onClick={() => handleSort(key)}
                  aria-sort={
                    sortBy === key
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <span className="inline-flex items-center">
                    {label}
                    <SortIcon
                      column={key}
                      activeColumn={sortBy}
                      direction={sortDir}
                    />
                  </span>
                </th>
              ))}
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
              result.data.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => onSelectUser(user.id)}
                  className={`cursor-pointer transition-colors ${
                    selectedUserId === user.id
                      ? "bg-indigo-500/10 border-l-2 border-l-indigo-500"
                      : "hover:bg-zinc-700/30 border-l-2 border-l-transparent"
                  }`}
                  role="row"
                  aria-selected={selectedUserId === user.id}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectUser(user.id);
                    }
                  }}
                >
                  <td className="px-4 py-3 text-zinc-200 font-medium truncate max-w-[240px]">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-400 tabular-nums">
                    {user.film_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {formatDate(user.last_sign_in_at)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
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
                        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v-2m22 0a4 4 0 01-4 4H5"
                      />
                    </svg>
                    <span className="text-sm">No users found</span>
                    {(debouncedSearch || roleFilter || statusFilter) && (
                      <span className="text-xs text-zinc-600">
                        Try adjusting your filters
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
            </span>{" "}
            users
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

      {/* Loading overlay */}
      {loading && result !== null && (
        <div
          className="absolute inset-0 bg-zinc-900/20 flex items-center justify-center"
          role="status"
          aria-label="Refreshing user list"
        >
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
        </div>
      )}
    </div>
  );
}
