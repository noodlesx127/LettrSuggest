"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  /** Whether the toast is in the visible state (for animation) */
  visible: boolean;
}

interface ToastContextValue {
  toast: (opts: { message: string; type: ToastType }) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

// ─── Single Toast ─────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<ToastType, string> = {
  success: "bg-emerald-900/95 border-emerald-500/40 text-emerald-100",
  error: "bg-red-900/95 border-red-500/40 text-red-100",
  info: "bg-indigo-900/95 border-indigo-500/40 text-indigo-100",
};

const TYPE_ICON: Record<ToastType, ReactNode> = {
  success: (
    <svg
      className="w-4 h-4 flex-shrink-0 text-emerald-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  ),
  error: (
    <svg
      className="w-4 h-4 flex-shrink-0 text-red-400"
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
  ),
  info: (
    <svg
      className="w-4 h-4 flex-shrink-0 text-indigo-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

function ToastItem({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        "flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm",
        "text-sm font-medium max-w-sm w-full",
        "transition-all duration-300 ease-out",
        item.visible
          ? "translate-x-0 opacity-100"
          : "translate-x-full opacity-0",
        TYPE_STYLES[item.type],
      ].join(" ")}
    >
      {TYPE_ICON[item.type]}
      <p className="flex-1 leading-snug">{item.message}</p>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
      >
        <svg
          className="w-3.5 h-3.5"
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
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 4_000;
/** Fade-out animation duration — must match Tailwind transition-duration */
const FADE_OUT_MS = 300;

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Store timeout ids so we can cancel them on unmount
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Dismiss a toast: start fade-out, then remove
  const dismiss = useCallback((id: number) => {
    // Cancel auto-dismiss timer if still pending
    const existing = timersRef.current.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
      timersRef.current.delete(id);
    }

    // Trigger fade-out by flipping visible → false
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
    );

    // Remove from DOM after animation completes
    const removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, FADE_OUT_MS);

    timersRef.current.set(id, removeTimer);
  }, []);

  const toast = useCallback(
    ({ message, type }: { message: string; type: ToastType }) => {
      const id = nextId++;

      // Insert as invisible so the enter animation plays on the next frame
      setToasts((prev) => [...prev, { id, message, type, visible: false }]);

      // Flip to visible on next tick to trigger CSS transition
      const enterTimer = setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, visible: true } : t)),
        );
      }, 16); // one animation frame

      // Auto-dismiss after AUTO_DISMISS_MS
      const dismissTimer = setTimeout(() => {
        dismiss(id);
      }, AUTO_DISMISS_MS + 16);

      timersRef.current.set(id, enterTimer);
      // Override the enterTimer with dismissTimer reference after it fires
      setTimeout(() => {
        timersRef.current.set(id, dismissTimer);
      }, 16);
    },
    [dismiss],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container — fixed bottom-right, z-50 */}
      <div
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <ToastItem item={item} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
