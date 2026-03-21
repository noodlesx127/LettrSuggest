"use client";

import { useState, useCallback, useEffect, useRef } from "react";

import {
  changeUserRole,
  changeUserEmail,
  resetUserPassword,
  suspendUser,
  unsuspendUser,
} from "@/app/actions/admin";
import type { UserDetail, UserRole } from "@/app/actions/admin";

interface RoleAccountTabProps {
  userDetail: UserDetail;
  /** Fetches a fresh access token on every call — never cached/stale. */
  getAccessToken: () => Promise<string>;
  onUserUpdated: () => void;
  onToast?: (message: string, type: "success" | "error") => void;
}

type FeedbackState = {
  type: "success" | "error";
  message: string;
} | null;

function useFeedback(): [FeedbackState, (fb: FeedbackState) => void] {
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((fb: FeedbackState) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFeedback(fb);
    if (fb) {
      timerRef.current = setTimeout(() => setFeedback(null), 3000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return [feedback, set];
}

function Feedback({ state }: { state: FeedbackState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`text-xs mt-2 font-medium animate-fade-in ${
        state.type === "success" ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {state.message}
    </p>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-5">
      <h4 className="text-sm font-semibold text-zinc-200 mb-1">{title}</h4>
      {description && (
        <p className="text-xs text-zinc-500 mb-4">{description}</p>
      )}
      {children}
    </div>
  );
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "user", label: "User" },
  { value: "developer", label: "Developer" },
  { value: "admin", label: "Admin" },
];

export default function RoleAccountTab({
  userDetail,
  getAccessToken,
  onUserUpdated,
  onToast,
}: RoleAccountTabProps) {
  // Role state
  const [selectedRole, setSelectedRole] = useState<UserRole>(userDetail.role);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleFeedback, setRoleFeedback] = useFeedback();
  const roleInflightRef = useRef(false);

  // Email state
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailFeedback, setEmailFeedback] = useFeedback();
  const emailInflightRef = useRef(false);

  // Password state
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useFeedback();
  const passwordInflightRef = useRef(false);
  // Auto-clear the reset link after 60 seconds (H4: avoid lingering sensitive URL)
  const resetLinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Suspend state
  const [suspendLoading, setSuspendLoading] = useState(false);
  const [suspendFeedback, setSuspendFeedback] = useFeedback();
  const suspendInflightRef = useRef(false);
  // Inline confirm state for suspend/unsuspend (H2)
  const [confirmSuspendAction, setConfirmSuspendAction] = useState<
    "suspend" | "unsuspend" | null
  >(null);

  // Cleanup reset link timer on unmount
  useEffect(() => {
    return () => {
      if (resetLinkTimerRef.current) clearTimeout(resetLinkTimerRef.current);
    };
  }, []);

  // Sync selected role when userDetail changes
  useEffect(() => {
    setSelectedRole(userDetail.role);
  }, [userDetail.role]);

  const handleRoleChange = useCallback(async () => {
    if (selectedRole === userDetail.role) return;
    if (roleInflightRef.current) return;
    roleInflightRef.current = true;
    setRoleLoading(true);
    try {
      const token = await getAccessToken();
      await changeUserRole(token, userDetail.id, selectedRole);
      setRoleFeedback({
        type: "success",
        message: `Role changed to ${selectedRole}`,
      });
      onToast?.(`Role changed to ${selectedRole}`, "success");
      onUserUpdated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to change role";
      setRoleFeedback({ type: "error", message: msg });
      onToast?.(msg, "error");
    } finally {
      setRoleLoading(false);
      roleInflightRef.current = false;
    }
  }, [
    getAccessToken,
    userDetail.id,
    userDetail.role,
    selectedRole,
    onUserUpdated,
    setRoleFeedback,
    onToast,
  ]);

  const handleEmailChange = useCallback(async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    if (emailInflightRef.current) return;
    emailInflightRef.current = true;
    setEmailLoading(true);
    try {
      const token = await getAccessToken();
      await changeUserEmail(token, userDetail.id, trimmed);
      setEmailFeedback({ type: "success", message: "Email updated" });
      onToast?.("Email updated successfully", "success");
      setNewEmail("");
      onUserUpdated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to change email";
      setEmailFeedback({ type: "error", message: msg });
      onToast?.("Failed to update email: " + msg, "error");
    } finally {
      setEmailLoading(false);
      emailInflightRef.current = false;
    }
  }, [
    getAccessToken,
    userDetail.id,
    newEmail,
    onUserUpdated,
    setEmailFeedback,
    onToast,
  ]);

  const handlePasswordReset = useCallback(async () => {
    if (passwordInflightRef.current) return;
    passwordInflightRef.current = true;
    setPasswordLoading(true);
    if (resetLinkTimerRef.current) clearTimeout(resetLinkTimerRef.current);
    setResetLink(null);
    try {
      const token = await getAccessToken();
      const result = await resetUserPassword(token, userDetail.id);
      setResetLink(result.resetLink);
      setPasswordFeedback({
        type: "success",
        message: "Reset link generated — expires in 60s",
      });
      // Auto-clear after 60 seconds (H4: avoid lingering sensitive one-time URL)
      resetLinkTimerRef.current = setTimeout(() => setResetLink(null), 60_000);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to generate reset link";
      setPasswordFeedback({ type: "error", message: msg });
    } finally {
      setPasswordLoading(false);
      passwordInflightRef.current = false;
    }
  }, [getAccessToken, userDetail.id, setPasswordFeedback]);

  const handleSuspend = useCallback(async () => {
    if (suspendInflightRef.current) return;
    suspendInflightRef.current = true;
    setSuspendLoading(true);
    setConfirmSuspendAction(null);
    try {
      const token = await getAccessToken();
      await suspendUser(token, userDetail.id);
      setSuspendFeedback({ type: "success", message: "User suspended" });
      onToast?.("User suspended successfully", "success");
      onUserUpdated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to suspend user";
      setSuspendFeedback({ type: "error", message: msg });
      onToast?.("Failed to suspend user: " + msg, "error");
    } finally {
      setSuspendLoading(false);
      suspendInflightRef.current = false;
    }
  }, [
    getAccessToken,
    userDetail.id,
    onUserUpdated,
    setSuspendFeedback,
    onToast,
  ]);

  const handleUnsuspend = useCallback(async () => {
    if (suspendInflightRef.current) return;
    suspendInflightRef.current = true;
    setSuspendLoading(true);
    setConfirmSuspendAction(null);
    try {
      const token = await getAccessToken();
      await unsuspendUser(token, userDetail.id);
      setSuspendFeedback({ type: "success", message: "User unsuspended" });
      onToast?.("User unsuspended successfully", "success");
      onUserUpdated();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to unsuspend user";
      setSuspendFeedback({ type: "error", message: msg });
      onToast?.("Failed to unsuspend user: " + msg, "error");
    } finally {
      setSuspendLoading(false);
      suspendInflightRef.current = false;
    }
  }, [
    getAccessToken,
    userDetail.id,
    onUserUpdated,
    setSuspendFeedback,
    onToast,
  ]);

  const handleCopyLink = useCallback(async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink);
    } catch {
      // Clipboard not available
    }
  }, [resetLink]);

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Role Section */}
      <SectionCard
        title="User Role"
        description="Change the user's access level within the application."
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-zinc-500">Current:</span>
          <span className="text-xs font-mono font-semibold text-zinc-300 uppercase">
            {userDetail.role}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as UserRole)}
            aria-label="Select new role"
            className="px-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-indigo-500/60 transition-colors"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleRoleChange}
            disabled={roleLoading || selectedRole === userDetail.role}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {roleLoading ? "Updating..." : "Update Role"}
          </button>
        </div>
        <Feedback state={roleFeedback} />
      </SectionCard>

      {/* Email Section */}
      <SectionCard
        title="Email Address"
        description="Update the user's email in both auth and profile records."
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-zinc-500">Current:</span>
          <span className="text-xs font-mono text-zinc-300">
            {userDetail.email}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new@email.com"
            aria-label="New email address"
            className="flex-1 px-3 py-2 bg-zinc-900/60 border border-zinc-600/50 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60 transition-colors"
          />
          <button
            onClick={handleEmailChange}
            disabled={emailLoading || !newEmail.trim()}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {emailLoading ? "Updating..." : "Update Email"}
          </button>
        </div>
        <Feedback state={emailFeedback} />
      </SectionCard>

      {/* Password Reset Section */}
      <SectionCard
        title="Password Reset"
        description="Generate a one-time password reset link for this user."
      >
        <button
          onClick={handlePasswordReset}
          disabled={passwordLoading}
          className="px-4 py-2 text-sm font-medium bg-zinc-700 text-zinc-200 border border-zinc-600/50 rounded-lg hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {passwordLoading ? "Generating..." : "Send Password Reset Link"}
        </button>
        {resetLink && (
          <div className="mt-3 flex items-start gap-2">
            <code className="flex-1 p-3 bg-zinc-900 border border-zinc-700/60 rounded-md text-xs font-mono text-zinc-300 break-all select-all leading-relaxed">
              {resetLink}
            </code>
            <button
              onClick={handleCopyLink}
              title="Copy reset link"
              aria-label="Copy reset link to clipboard"
              className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 rounded-md transition-colors flex-shrink-0"
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
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
          </div>
        )}
        <Feedback state={passwordFeedback} />
      </SectionCard>

      {/* Suspend / Unsuspend Section */}
      <SectionCard
        title="Account Suspension"
        description="Suspend or reactivate this user's account. Suspended users cannot sign in."
      >
        {confirmSuspendAction === "suspend" ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-300 font-medium mr-1">
              Suspend this user?
            </span>
            <button
              onClick={() => void handleSuspend()}
              disabled={suspendLoading}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-500 disabled:opacity-40 transition-colors"
            >
              {suspendLoading ? "Suspending..." : "Confirm Suspend"}
            </button>
            <button
              onClick={() => setConfirmSuspendAction(null)}
              disabled={suspendLoading}
              className="px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-700/50 rounded-md hover:bg-zinc-600/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : confirmSuspendAction === "unsuspend" ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-300 font-medium mr-1">
              Unsuspend this user?
            </span>
            <button
              onClick={() => void handleUnsuspend()}
              disabled={suspendLoading}
              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
              {suspendLoading ? "Unsuspending..." : "Confirm Unsuspend"}
            </button>
            <button
              onClick={() => setConfirmSuspendAction(null)}
              disabled={suspendLoading}
              className="px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-700/50 rounded-md hover:bg-zinc-600/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setConfirmSuspendAction("suspend")}
              disabled={suspendLoading || userDetail.status === "suspended"}
              className="px-4 py-2 text-sm font-medium bg-red-600/80 text-white rounded-lg hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Suspend User
            </button>
            <button
              onClick={() => setConfirmSuspendAction("unsuspend")}
              disabled={suspendLoading || userDetail.status === "active"}
              className="px-4 py-2 text-sm font-medium bg-emerald-600/80 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Unsuspend User
            </button>
          </div>
        )}
        {userDetail.suspended_at && (
          <p className="text-xs text-amber-400/70 mt-2 font-mono">
            Suspended since {new Date(userDetail.suspended_at).toLocaleString()}
          </p>
        )}
        <Feedback state={suspendFeedback} />
      </SectionCard>
    </div>
  );
}
