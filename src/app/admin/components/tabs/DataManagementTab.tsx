"use client";

import { useState, useCallback } from "react";

import { deleteUserData } from "@/app/actions/admin";

interface DataManagementTabProps {
  userId: string;
  /** Fetches a fresh access token on every call — never cached/stale. */
  getAccessToken: () => Promise<string>;
  onUserUpdated: () => void;
  onToast?: (message: string, type: "success" | "error") => void;
}

type DeleteScope = "import" | "liked" | "blocked" | "all";

interface DeleteAction {
  scope: DeleteScope;
  label: string;
  description: string;
  variant: "default" | "danger";
}

const DELETE_ACTIONS: DeleteAction[] = [
  {
    scope: "import",
    label: "Delete Import Data",
    description:
      "Removes all imported film events from Letterboxd. The user can re-import at any time.",
    variant: "default",
  },
  {
    scope: "liked",
    label: "Delete Liked Films",
    description:
      "Removes all positive feedback (liked suggestions). This resets their recommendation taste signals.",
    variant: "default",
  },
  {
    scope: "blocked",
    label: "Delete Blocked Films",
    description:
      "Removes all blocked suggestions. Previously hidden movies will appear again.",
    variant: "default",
  },
  {
    scope: "all",
    label: "Delete All Data",
    description:
      "Removes ALL user data: imports, likes, blocks, watchlist, diary, and taste profile. Cannot be undone.",
    variant: "danger",
  },
];

interface ConfirmState {
  scope: DeleteScope | null;
}

export default function DataManagementTab({
  userId,
  getAccessToken,
  onUserUpdated,
  onToast,
}: DataManagementTabProps) {
  const [confirm, setConfirm] = useState<ConfirmState>({ scope: null });
  const [loading, setLoading] = useState<DeleteScope | null>(null);
  const [results, setResults] = useState<
    Record<string, Record<string, number>>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleDelete = useCallback(
    async (scope: DeleteScope) => {
      setLoading(scope);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[scope];
        return next;
      });
      try {
        const token = await getAccessToken();
        const counts = await deleteUserData(token, userId, scope);
        setResults((prev) => ({ ...prev, [scope]: counts }));
        setConfirm({ scope: null });
        onToast?.(`Deleted ${scope} data successfully`, "success");
        onUserUpdated();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Deletion failed";
        setErrors((prev) => ({ ...prev, [scope]: msg }));
        onToast?.("Deletion failed: " + msg, "error");
      } finally {
        setLoading(null);
      }
    },
    [getAccessToken, userId, onUserUpdated, onToast],
  );

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Warning Banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-500/8 border border-amber-500/20 rounded-lg">
        <svg
          className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div>
          <p className="text-sm font-semibold text-amber-300">
            Permanent Data Deletion
          </p>
          <p className="text-xs text-amber-400/70 mt-1">
            Actions on this page permanently delete user data and cannot be
            undone. Use with caution.
          </p>
        </div>
      </div>

      {/* Delete Actions */}
      {DELETE_ACTIONS.map((action) => {
        const isConfirming = confirm.scope === action.scope;
        const isLoading = loading === action.scope;
        const result = results[action.scope];
        const error = errors[action.scope];
        const isDanger = action.variant === "danger";

        return (
          <div
            key={action.scope}
            className={`bg-zinc-800/60 border rounded-lg p-5 transition-colors ${
              isDanger ? "border-red-500/30" : "border-zinc-700/40"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-zinc-200">
                  {action.label}
                </h4>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  {action.description}
                </p>
              </div>

              {isConfirming ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-amber-300 font-medium mr-1">
                    Are you sure?
                  </span>
                  <button
                    onClick={() => void handleDelete(action.scope)}
                    disabled={isLoading}
                    className={`px-3 py-1.5 text-xs font-medium text-white rounded-md transition-colors disabled:opacity-40 ${
                      isDanger
                        ? "bg-red-600 hover:bg-red-500"
                        : "bg-amber-600 hover:bg-amber-500"
                    }`}
                  >
                    {isLoading ? "Deleting..." : "Confirm"}
                  </button>
                  <button
                    onClick={() => setConfirm({ scope: null })}
                    disabled={isLoading}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-700/50 rounded-md hover:bg-zinc-600/50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirm({ scope: action.scope })}
                  disabled={isLoading}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex-shrink-0 ${
                    isDanger
                      ? "bg-red-600/80 text-white hover:bg-red-500 border border-red-500/30"
                      : "bg-zinc-700 text-zinc-200 border border-zinc-600/50 hover:bg-zinc-600"
                  }`}
                >
                  {action.label}
                </button>
              )}
            </div>

            {/* Success result */}
            {result && (
              <div className="mt-3 p-3 bg-emerald-500/8 border border-emerald-500/20 rounded-md">
                <p className="text-xs text-emerald-400 font-medium mb-1">
                  Deletion complete
                </p>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(result).map(([key, count]) => (
                    <span
                      key={key}
                      className="text-xs font-mono text-emerald-300/80"
                    >
                      {key}: <span className="font-semibold">{count}</span>
                    </span>
                  ))}
                  {Object.keys(result).length === 0 && (
                    <span className="text-xs text-emerald-300/60 italic">
                      No records found to delete
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <p role="alert" className="mt-3 text-xs text-red-400 font-medium">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
