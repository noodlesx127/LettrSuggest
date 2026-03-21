"use client";

import { useState, useEffect, useCallback } from "react";

import { supabase } from "@/lib/supabaseClient";
import { getUserDetail, getUserTasteProfile } from "@/app/actions/admin";
import type {
  UserDetail,
  TasteProfileSummary,
  UserStatus,
} from "@/app/actions/admin";
import { useToast } from "@/components/Toast";

import OverviewTab from "@/app/admin/components/tabs/OverviewTab";
import RoleAccountTab from "@/app/admin/components/tabs/RoleAccountTab";
import DataManagementTab from "@/app/admin/components/tabs/DataManagementTab";
import ApiKeysTab from "@/app/admin/components/tabs/ApiKeysTab";
import ViewAsTab from "@/app/admin/components/tabs/ViewAsTab";

interface UserDetailPanelProps {
  userId: string;
  onClose: () => void;
  onUserUpdated: () => void;
}

type TabId = "overview" | "role" | "data" | "apikeys" | "viewas";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

function StatusDot({ status }: { status: UserStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        status === "active"
          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
          : "bg-amber-500/15 text-amber-300 border border-amber-500/25"
      }`}
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

const TABS: TabDef[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
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
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
        />
      </svg>
    ),
  },
  {
    id: "role",
    label: "Role & Account",
    icon: (
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
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    ),
  },
  {
    id: "data",
    label: "Data",
    icon: (
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
          d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 12h6m-3-3v6"
        />
      </svg>
    ),
  },
  {
    id: "apikeys",
    label: "API Keys",
    icon: (
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
    ),
  },
  {
    id: "viewas",
    label: "View As",
    icon: (
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
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
        />
      </svg>
    ),
  },
];

export default function UserDetailPanel({
  userId,
  onClose,
  onUserUpdated,
}: UserDetailPanelProps) {
  const { toast } = useToast();

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      toast({ message, type });
    },
    [toast],
  );
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [tasteProfile, setTasteProfile] = useState<TasteProfileSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadingTaste, setLoadingTaste] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches a fresh Supabase access token on every call — never stale. */
  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!supabase) throw new Error("Supabase client not available");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Session expired — please sign in again");
    return token;
  }, []);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const detail = await getUserDetail(token, userId);
      setUserDetail(detail);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load user";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [userId, getAccessToken]);

  const fetchTaste = useCallback(async () => {
    setLoadingTaste(true);
    try {
      const token = await getAccessToken();
      const taste = await getUserTasteProfile(token, userId);
      setTasteProfile(taste);
    } catch {
      setTasteProfile(null);
    } finally {
      setLoadingTaste(false);
    }
  }, [userId, getAccessToken]);

  useEffect(() => {
    void fetchDetail();
    void fetchTaste();
  }, [fetchDetail, fetchTaste]);

  const handleUserUpdated = useCallback(() => {
    void fetchDetail();
    onUserUpdated();
  }, [fetchDetail, onUserUpdated]);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-zinc-900">
        {/* Header skeleton */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60">
          <div className="flex items-center gap-3">
            <div className="h-5 w-48 animate-pulse bg-zinc-700 rounded" />
            <div className="h-5 w-16 animate-pulse bg-zinc-700 rounded-full" />
          </div>
          <div className="h-8 w-8 animate-pulse bg-zinc-700 rounded" />
        </div>
        {/* Body skeleton */}
        <div
          className="flex-1 p-6 space-y-4"
          role="status"
          aria-label="Loading user details"
        >
          <div className="h-4 w-3/4 animate-pulse bg-zinc-700 rounded" />
          <div className="h-4 w-1/2 animate-pulse bg-zinc-700 rounded" />
          <div className="h-32 animate-pulse bg-zinc-700/50 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !userDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-zinc-900 text-zinc-400 gap-3">
        <svg
          className="w-10 h-10 text-red-400/60"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-sm">{error ?? "User not found"}</p>
        <button
          onClick={onClose}
          className="mt-2 px-4 py-2 text-xs font-medium bg-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-600 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700/60 bg-zinc-800/40">
        <div className="flex items-center gap-3 min-w-0">
          {/* User avatar placeholder */}
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-indigo-300 uppercase">
              {userDetail.email.charAt(0)}
            </span>
          </div>
          <h2 className="text-base font-semibold text-zinc-100 truncate">
            {userDetail.email}
          </h2>
          <StatusDot status={userDetail.status} />
        </div>
        <button
          onClick={onClose}
          aria-label="Close user detail panel"
          className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 rounded-md transition-colors flex-shrink-0"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-700/60 bg-zinc-800/20 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-selected={activeTab === tab.id}
            role="tab"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? "bg-zinc-700 text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/30"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "overview" ? (
          <OverviewTab
            userDetail={userDetail}
            tasteProfile={tasteProfile}
            loading={loadingTaste}
          />
        ) : null}
        {activeTab === "role" ? (
          <RoleAccountTab
            userDetail={userDetail}
            getAccessToken={getAccessToken}
            onUserUpdated={handleUserUpdated}
            onToast={showToast}
          />
        ) : null}
        {activeTab === "data" ? (
          <DataManagementTab
            userId={userId}
            getAccessToken={getAccessToken}
            onUserUpdated={handleUserUpdated}
            onToast={showToast}
          />
        ) : null}
        {activeTab === "apikeys" ? (
          <ApiKeysTab
            userId={userId}
            getAccessToken={getAccessToken}
            onToast={showToast}
          />
        ) : null}
        {activeTab === "viewas" ? <ViewAsTab userDetail={userDetail} /> : null}
      </div>
    </div>
  );
}
