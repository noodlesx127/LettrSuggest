"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toast";

// ============================================================================
// TYPES
// ============================================================================

interface ApiKey {
  id: string;
  key_prefix: string;
  label: string | null;
  key_type: "user" | "admin" | "developer";
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

type KeyStatus = "active" | "expired" | "revoked";

type UserRole = "user" | "admin" | "developer";

interface CreateKeyPayload {
  label?: string;
  key_type: "user" | "admin" | "developer";
  expires_at?: string | null;
}

interface ApiResponseEnvelope<T> {
  data: T;
  meta: { timestamp: string; requestId: string };
  error: null | { code: string; message: string; details: unknown };
}

interface CreateKeyData {
  id: string;
  rawKey: string;
  key_prefix: string;
  label: string | null;
  key_type: string;
  created_at: string;
  expires_at: string | null;
}

// ============================================================================
// HELPERS
// ============================================================================

function deriveStatus(key: ApiKey): KeyStatus {
  if (key.revoked_at) return "revoked";
  if (key.expires_at && new Date(key.expires_at) < new Date()) return "expired";
  return "active";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return `${diffMonths}mo ago`;
}

function maskKeyPrefix(prefix: string): string {
  const visible = prefix.slice(0, 10);
  return `${visible}${"*".repeat(4)}`;
}

const STATUS_BADGE_MAP: Record<
  KeyStatus,
  { variant: "success" | "warning" | "danger"; label: string }
> = {
  active: { variant: "success", label: "Active" },
  expired: { variant: "warning", label: "Expired" },
  revoked: { variant: "danger", label: "Revoked" },
};

const TYPE_BADGE_MAP: Record<
  string,
  { variant: "primary" | "info" | "warning"; label: string }
> = {
  user: { variant: "primary", label: "User" },
  developer: { variant: "info", label: "Developer" },
  admin: { variant: "warning", label: "Admin" },
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Shimmering skeleton row for loading state */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4 animate-pulse">
      <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded-md" />
      <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded-md" />
      <div className="h-5 w-14 bg-gray-200 dark:bg-gray-700 rounded-full" />
      <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded-md ml-auto" />
    </div>
  );
}

/** Empty state illustration */
function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {/* Key icon with decorative ring */}
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-violet-500/10 dark:bg-violet-400/10 rounded-full blur-xl scale-150" />
        <div
          className={cn(
            "relative w-16 h-16 rounded-2xl flex items-center justify-center",
            "bg-gradient-to-br from-violet-100 to-fuchsia-100",
            "dark:from-violet-900/40 dark:to-fuchsia-900/40",
            "border border-violet-200/60 dark:border-violet-700/40",
          )}
        >
          <svg
            className="w-7 h-7 text-violet-600 dark:text-violet-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
            />
          </svg>
        </div>
      </div>

      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
        No API keys yet
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mb-6 leading-relaxed">
        Create an API key to access the LettrSuggest API programmatically. Keys
        are hashed and stored securely.
      </p>

      <Button
        variant="primary"
        size="sm"
        onClick={onCreateClick}
        icon={<Icon name="plus" size="xs" />}
      >
        Create your first key
      </Button>
    </div>
  );
}

/** Error state display */
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <div
        className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center mb-4",
          "bg-red-100 dark:bg-red-900/30",
        )}
      >
        <Icon
          name="alert"
          size="lg"
          className="text-red-500 dark:text-red-400"
        />
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// ============================================================================
// KEY ROW (Desktop)
// ============================================================================

interface KeyRowProps {
  apiKey: ApiKey;
  status: KeyStatus;
  onRevoke: (id: string) => void;
  revoking: boolean;
}

function KeyRow({ apiKey, status, onRevoke, revoking }: KeyRowProps) {
  const statusBadge = STATUS_BADGE_MAP[status];
  const typeBadge = TYPE_BADGE_MAP[apiKey.key_type] ?? TYPE_BADGE_MAP.user;
  const isRevocable = status === "active";

  return (
    <tr
      className={cn(
        "group transition-colors duration-100",
        "hover:bg-gray-50/60 dark:hover:bg-gray-700/30",
        status !== "active" && "opacity-60",
      )}
    >
      {/* Key Prefix */}
      <td className="py-3 px-4">
        <code
          className={cn(
            "text-[13px] font-mono tracking-tight",
            "px-2 py-0.5 rounded-md",
            "bg-gray-100 dark:bg-gray-700/60",
            "text-gray-800 dark:text-gray-200",
            "border border-gray-200/60 dark:border-gray-600/40",
          )}
        >
          {maskKeyPrefix(apiKey.key_prefix)}
        </code>
      </td>

      {/* Label */}
      <td className="py-3 px-4">
        {apiKey.label ? (
          <span className="text-sm text-gray-900 dark:text-gray-100 truncate max-w-[180px] block">
            {apiKey.label}
          </span>
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500 italic">
            No label
          </span>
        )}
      </td>

      {/* Type */}
      <td className="py-3 px-4">
        <Badge variant={typeBadge.variant} size="sm">
          {typeBadge.label}
        </Badge>
      </td>

      {/* Created */}
      <td className="py-3 px-4">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatRelativeTime(apiKey.created_at)}
        </span>
      </td>

      {/* Last Used */}
      <td className="py-3 px-4">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {apiKey.last_used_at
            ? formatRelativeTime(apiKey.last_used_at)
            : "Never"}
        </span>
      </td>

      {/* Status */}
      <td className="py-3 px-4">
        <Badge
          variant={statusBadge.variant}
          size="sm"
          dot={status === "active"}
        >
          {statusBadge.label}
        </Badge>
      </td>

      {/* Actions */}
      <td className="py-3 px-4 text-right">
        {isRevocable ? (
          <button
            onClick={() => onRevoke(apiKey.id)}
            disabled={revoking}
            title="Revoke key"
            className={cn(
              "p-1.5 rounded-lg transition-all duration-150",
              "text-gray-400 hover:text-red-500 dark:hover:text-red-400",
              "hover:bg-red-50 dark:hover:bg-red-900/20",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
          >
            {revoking ? (
              <Icon name="spinner" size="sm" />
            ) : (
              <Icon name="x-circle" size="sm" />
            )}
          </button>
        ) : (
          <span className="inline-block w-8" />
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// KEY CARD (Mobile)
// ============================================================================

function KeyCard({ apiKey, status, onRevoke, revoking }: KeyRowProps) {
  const statusBadge = STATUS_BADGE_MAP[status];
  const typeBadge = TYPE_BADGE_MAP[apiKey.key_type] ?? TYPE_BADGE_MAP.user;
  const isRevocable = status === "active";

  return (
    <div
      className={cn(
        "p-4 rounded-xl border transition-colors duration-100",
        "bg-white dark:bg-gray-800",
        "border-gray-200 dark:border-gray-700",
        status !== "active" && "opacity-60",
      )}
    >
      {/* Header: prefix + status */}
      <div className="flex items-center justify-between mb-3">
        <code
          className={cn(
            "text-[13px] font-mono tracking-tight",
            "px-2 py-0.5 rounded-md",
            "bg-gray-100 dark:bg-gray-700/60",
            "text-gray-800 dark:text-gray-200",
            "border border-gray-200/60 dark:border-gray-600/40",
          )}
        >
          {maskKeyPrefix(apiKey.key_prefix)}
        </code>
        <Badge
          variant={statusBadge.variant}
          size="sm"
          dot={status === "active"}
        >
          {statusBadge.label}
        </Badge>
      </div>

      {/* Label + type */}
      <div className="flex items-center gap-2 mb-3">
        {apiKey.label ? (
          <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
            {apiKey.label}
          </span>
        ) : (
          <span className="text-sm text-gray-400 dark:text-gray-500 italic">
            No label
          </span>
        )}
        <Badge variant={typeBadge.variant} size="sm">
          {typeBadge.label}
        </Badge>
      </div>

      {/* Metadata row */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          <span>Created {formatRelativeTime(apiKey.created_at)}</span>
          <span className="text-gray-300 dark:text-gray-600">&middot;</span>
          <span>
            Used{" "}
            {apiKey.last_used_at
              ? formatRelativeTime(apiKey.last_used_at)
              : "never"}
          </span>
        </div>
        {isRevocable && (
          <button
            onClick={() => onRevoke(apiKey.id)}
            disabled={revoking}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150",
              "text-red-600 dark:text-red-400",
              "hover:bg-red-50 dark:hover:bg-red-900/20",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {revoking ? "Revoking..." : "Revoke"}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CREATE KEY MODAL
// ============================================================================

interface CreateKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (response: CreateKeyData) => void;
  userRole: UserRole;
  getToken: () => Promise<string | null>;
}

function CreateKeyModal({
  isOpen,
  onClose,
  onCreated,
  userRole,
  getToken,
}: CreateKeyModalProps) {
  const [label, setLabel] = useState("");
  const [keyType, setKeyType] = useState<"user" | "admin" | "developer">(
    "user",
  );
  const [expiryOption, setExpiryOption] = useState<
    "never" | "30d" | "90d" | "1y" | "custom"
  >("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setLabel("");
      setKeyType("user");
      setExpiryOption("never");
      setCustomExpiry("");
      setError(null);
    }
  }, [isOpen]);

  const computeExpiry = (): string | null => {
    const now = new Date();
    switch (expiryOption) {
      case "30d":
        return new Date(now.getTime() + 30 * 86400000).toISOString();
      case "90d":
        return new Date(now.getTime() + 90 * 86400000).toISOString();
      case "1y":
        return new Date(now.getTime() + 365 * 86400000).toISOString();
      case "custom":
        return customExpiry ? new Date(customExpiry).toISOString() : null;
      default:
        return null;
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Session expired. Please sign in again.");
        setCreating(false);
        return;
      }

      const payload: CreateKeyPayload = {
        key_type: keyType,
        ...(label.trim() && { label: label.trim() }),
        expires_at: computeExpiry(),
      };

      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error?.message || `Failed to create key (${res.status})`,
        );
      }

      const envelope: ApiResponseEnvelope<CreateKeyData> = await res.json();
      onCreated(envelope.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  };

  const canSelectType = (type: "user" | "admin" | "developer"): boolean => {
    if (type === "user") return true;
    if (type === "developer")
      return userRole === "developer" || userRole === "admin";
    if (type === "admin") return userRole === "admin";
    return false;
  };

  const keyTypes = [
    { value: "user" as const, label: "User", desc: "Standard API access" },
    {
      value: "developer" as const,
      label: "Developer",
      desc: "Extended rate limits",
    },
    {
      value: "admin" as const,
      label: "Admin",
      desc: "Full administrative access",
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create API Key"
      description="Generate a new key for programmatic access"
      size="md"
    >
      <div className="space-y-5">
        {/* Label */}
        <Input
          label="Label"
          placeholder="e.g. My AI Agent"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          helperText="Optional. Helps you identify this key later."
        />

        {/* Key Type */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Key Type
          </label>
          <div className="grid grid-cols-3 gap-2">
            {keyTypes.map((kt) => {
              const allowed = canSelectType(kt.value);
              const selected = keyType === kt.value;
              return (
                <button
                  key={kt.value}
                  type="button"
                  disabled={!allowed}
                  onClick={() => setKeyType(kt.value)}
                  className={cn(
                    "relative p-3 rounded-xl border-2 text-left transition-all duration-150",
                    selected
                      ? "border-violet-500 bg-violet-50/60 dark:bg-violet-900/20"
                      : "border-gray-200 dark:border-gray-700",
                    allowed &&
                      !selected &&
                      "hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer",
                    !allowed && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {kt.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {kt.desc}
                  </div>
                  {selected && (
                    <div className="absolute top-1.5 right-1.5 text-violet-500">
                      <Icon name="check-circle" size="sm" />
                    </div>
                  )}
                  {!allowed && (
                    <div className="absolute top-1.5 right-1.5 text-gray-300 dark:text-gray-600">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                        />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Expiry */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Expiration
          </label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "never", label: "Never" },
                { value: "30d", label: "30 days" },
                { value: "90d", label: "90 days" },
                { value: "1y", label: "1 year" },
                { value: "custom", label: "Custom" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setExpiryOption(opt.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                  "border",
                  expiryOption === opt.value
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300"
                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {expiryOption === "custom" && (
            <div className="mt-2">
              <input
                type="date"
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className={cn(
                  "w-full h-10 px-3 text-sm rounded-xl border transition-all duration-150",
                  "bg-white dark:bg-gray-800",
                  "border-gray-300 dark:border-gray-600",
                  "text-gray-900 dark:text-gray-100",
                  "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500",
                )}
              />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            className={cn(
              "flex items-start gap-2 p-3 rounded-xl text-sm",
              "bg-red-50 dark:bg-red-900/20",
              "text-red-700 dark:text-red-300",
              "border border-red-200 dark:border-red-800/40",
            )}
            role="alert"
          >
            <Icon name="alert" size="sm" className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreate}
            loading={creating}
          >
            {creating ? "Creating..." : "Create Key"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// KEY CREATED MODAL
// ============================================================================

interface KeyCreatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawKey: string | null;
}

function KeyCreatedModal({ isOpen, onClose, rawKey }: KeyCreatedModalProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
      toast({ message: "Key copied to clipboard", type: "success" });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = rawKey;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      toast({ message: "Key copied to clipboard", type: "success" });
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // Reset copied state when modal opens
  useEffect(() => {
    if (isOpen) setCopied(false);
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Key Created!"
      size="md"
      closeOnOverlayClick={false}
      closeOnEsc={false}
    >
      <div className="space-y-4">
        {/* Warning banner */}
        <div
          className={cn(
            "flex items-start gap-3 p-3.5 rounded-xl",
            "bg-amber-50 dark:bg-amber-900/20",
            "border border-amber-200 dark:border-amber-700/40",
          )}
        >
          <Icon
            name="warning"
            size="md"
            className="text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Copy this key now
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5 leading-relaxed">
              This key will only be shown once. Store it somewhere safe &mdash;
              you won&apos;t be able to see it again.
            </p>
          </div>
        </div>

        {/* Key display */}
        <div className="relative group">
          <div
            className={cn(
              "p-4 rounded-xl font-mono text-[13px] leading-relaxed break-all",
              "bg-gray-900 dark:bg-black",
              "text-emerald-400",
              "border border-gray-700 dark:border-gray-600",
              "select-all",
            )}
          >
            {rawKey}
          </div>

          {/* Copy button overlay */}
          <button
            onClick={handleCopy}
            className={cn(
              "absolute top-2 right-2 p-2 rounded-lg transition-all duration-150",
              copied
                ? "bg-emerald-600 text-white"
                : "bg-gray-700/80 hover:bg-gray-600 text-gray-300 hover:text-white",
              "backdrop-blur-sm",
            )}
            title="Copy to clipboard"
          >
            {copied ? (
              <Icon name="check" size="sm" />
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-end pt-1">
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// CONFIRM REVOKE MODAL
// ============================================================================

interface ConfirmRevokeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  keyPrefix: string;
  revoking: boolean;
}

function ConfirmRevokeModal({
  isOpen,
  onClose,
  onConfirm,
  keyPrefix,
  revoking,
}: ConfirmRevokeModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Revoke API Key"
      description="This action cannot be undone."
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Are you sure you want to revoke{" "}
          <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
            {maskKeyPrefix(keyPrefix)}
          </code>
          ? Any application using this key will immediately lose access.
        </p>

        <div className="flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={revoking}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onConfirm}
            loading={revoking}
          >
            {revoking ? "Revoking..." : "Revoke Key"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ApiKeyManager() {
  // Data state
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [userRole, setUserRole] = useState<UserRole>("user");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreatedModal, setShowCreatedModal] = useState(false);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { toast } = useToast();

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  // ── Fetch keys ──────────────────────────────────────────────────────────

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/v1/keys", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error?.message || `Failed to load keys (${res.status})`,
        );
      }

      const envelope: ApiResponseEnvelope<ApiKey[]> = await res.json();
      setKeys(Array.isArray(envelope.data) ? envelope.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  // ── Fetch user role ─────────────────────────────────────────────────────

  const fetchUserRole = useCallback(async () => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .single();

    if (data?.role) {
      setUserRole(data.role as UserRole);
    }
  }, []);

  // ── Init ────────────────────────────────────────────────────────────────

  useEffect(() => {
    void fetchKeys();
    void fetchUserRole();
  }, [fetchKeys, fetchUserRole]);

  // ── Create handler ──────────────────────────────────────────────────────

  const handleKeyCreated = useCallback(
    (response: CreateKeyData) => {
      setShowCreateModal(false);
      setCreatedRawKey(response.rawKey);
      setShowCreatedModal(true);

      // Add the new key to list (without the rawKey)
      const newKey: ApiKey = {
        id: response.id,
        key_prefix: response.key_prefix,
        label: response.label,
        key_type: response.key_type as ApiKey["key_type"],
        created_at: response.created_at,
        last_used_at: null,
        expires_at: response.expires_at,
        revoked_at: null,
      };
      setKeys((prev) => [newKey, ...prev]);
      toast({ message: "API key created successfully", type: "success" });
    },
    [toast],
  );

  // ── Revoke handler ──────────────────────────────────────────────────────

  const handleRevokeConfirm = useCallback(async () => {
    if (!revokeTarget) return;
    setRevokingId(revokeTarget.id);

    try {
      const token = await getToken();
      if (!token) {
        toast({ message: "Session expired", type: "error" });
        return;
      }

      const res = await fetch(`/api/v1/keys/${revokeTarget.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to revoke key");
      }

      // Update local state
      setKeys((prev) =>
        prev.map((k) =>
          k.id === revokeTarget.id
            ? { ...k, revoked_at: new Date().toISOString() }
            : k,
        ),
      );
      toast({ message: "API key revoked", type: "success" });
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : "Failed to revoke key",
        type: "error",
      });
    } finally {
      setRevokingId(null);
      setRevokeTarget(null);
    }
  }, [revokeTarget, getToken, toast]);

  // ── Sort: active first, then by created date ───────────────────────────

  const sortedKeys = [...keys].sort((a, b) => {
    const sa = deriveStatus(a);
    const sb = deriveStatus(b);
    if (sa === "active" && sb !== "active") return -1;
    if (sa !== "active" && sb === "active") return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // ── Render ──────────────────────────────────────────────────────────────

  const roleBadgeMap: Record<
    string,
    { variant: "warning" | "info"; label: string }
  > = {
    admin: { variant: "warning", label: "Admin" },
    developer: { variant: "info", label: "Developer" },
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <svg
                className="w-5 h-5 text-violet-500 dark:text-violet-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                />
              </svg>
              <span className="text-gray-900 dark:text-gray-100">API Keys</span>
            </h2>
            {roleBadgeMap[userRole] && (
              <Badge variant={roleBadgeMap[userRole].variant} size="sm">
                {roleBadgeMap[userRole].label}
              </Badge>
            )}
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateModal(true)}
            icon={<Icon name="plus" size="xs" />}
          >
            New Key
          </Button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          Manage API keys for programmatic access to the LettrSuggest API. Keys
          are securely hashed &mdash; only the prefix is stored.
        </p>

        {/* Content */}
        {loading ? (
          <div className="space-y-1 divide-y divide-gray-100 dark:divide-gray-700/50">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchKeys} />
        ) : sortedKeys.length === 0 ? (
          <EmptyState onCreateClick={() => setShowCreateModal(true)} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto -mx-6 px-6">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700/50">
                    {[
                      "Key",
                      "Label",
                      "Type",
                      "Created",
                      "Last Used",
                      "Status",
                      "",
                    ].map((header) => (
                      <th
                        key={header || "actions"}
                        className={cn(
                          "py-2.5 px-4 text-xs font-medium uppercase tracking-wider",
                          "text-gray-400 dark:text-gray-500",
                        )}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/30">
                  {sortedKeys.map((key) => (
                    <KeyRow
                      key={key.id}
                      apiKey={key}
                      status={deriveStatus(key)}
                      onRevoke={(id) => {
                        const target = keys.find((k) => k.id === id);
                        if (target) setRevokeTarget(target);
                      }}
                      revoking={revokingId === key.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {sortedKeys.map((key) => (
                <KeyCard
                  key={key.id}
                  apiKey={key}
                  status={deriveStatus(key)}
                  onRevoke={(id) => {
                    const target = keys.find((k) => k.id === id);
                    if (target) setRevokeTarget(target);
                  }}
                  revoking={revokingId === key.id}
                />
              ))}
            </div>

            {/* Key count */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700/50">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {sortedKeys.length} key{sortedKeys.length !== 1 ? "s" : ""}{" "}
                &middot;{" "}
                {sortedKeys.filter((k) => deriveStatus(k) === "active").length}{" "}
                active
              </p>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <CreateKeyModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleKeyCreated}
        userRole={userRole}
        getToken={getToken}
      />

      <KeyCreatedModal
        isOpen={showCreatedModal}
        onClose={() => {
          setShowCreatedModal(false);
          setCreatedRawKey(null);
        }}
        rawKey={createdRawKey}
      />

      {revokeTarget && (
        <ConfirmRevokeModal
          isOpen={!!revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onConfirm={handleRevokeConfirm}
          keyPrefix={revokeTarget.key_prefix}
          revoking={revokingId === revokeTarget.id}
        />
      )}
    </>
  );
}
