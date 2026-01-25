"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./Icon";

// ============================================================================
// TOAST COMPONENT - Core Design System Notification
// Toast notifications with provider pattern and useToast hook
// ============================================================================

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastData {
  /** Unique identifier */
  id: string;
  /** Visual variant */
  variant: ToastVariant;
  /** Toast title */
  title: string;
  /** Optional description */
  description?: string;
  /** Duration in ms (0 = no auto-dismiss) */
  duration?: number;
}

interface ToastProps extends ToastData {
  /** Callback when toast is closed */
  onClose: (id: string) => void;
  /** Whether toast is hovered (pauses timer) */
  isPaused?: boolean;
}

// Variant configuration
const variantConfig: Record<
  ToastVariant,
  { icon: IconName; borderColor: string; iconColor: string; bgColor: string }
> = {
  success: {
    icon: "check-circle",
    borderColor: "border-l-emerald-500",
    iconColor: "text-emerald-500",
    bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
  },
  error: {
    icon: "x-circle",
    borderColor: "border-l-red-500",
    iconColor: "text-red-500",
    bgColor: "bg-red-50 dark:bg-red-900/20",
  },
  warning: {
    icon: "warning",
    borderColor: "border-l-amber-500",
    iconColor: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
  },
  info: {
    icon: "info",
    borderColor: "border-l-blue-500",
    iconColor: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
};

// Default duration in milliseconds
const DEFAULT_DURATION = 5000;
const MAX_TOASTS = 3;

/**
 * Individual Toast component
 */
function Toast({
  id,
  variant,
  title,
  description,
  duration = DEFAULT_DURATION,
  onClose,
}: ToastProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(100);
  const [isExiting, setIsExiting] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const remainingTimeRef = useRef<number>(duration);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const config = variantConfig[variant];

  // Handle close with exit animation
  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(id);
    }, 200); // Match animation duration
  }, [id, onClose]);

  // Progress bar animation
  useEffect(() => {
    if (duration === 0) return; // No auto-dismiss

    if (isPaused) {
      // Store remaining time when paused
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(
        0,
        remainingTimeRef.current - elapsed,
      );
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      return;
    }

    // Reset start time when resuming
    startTimeRef.current = Date.now();

    // Update progress bar
    const updateInterval = 50; // Update every 50ms for smooth animation
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const newRemaining = remainingTimeRef.current - elapsed;

      if (newRemaining <= 0) {
        handleClose();
      } else {
        setProgress((newRemaining / duration) * 100);
      }
    }, updateInterval);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [duration, isPaused, handleClose]);

  return (
    <div
      role="alert"
      aria-live="polite"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => {
        startTimeRef.current = Date.now();
        setIsPaused(false);
      }}
      className={cn(
        // Base styles
        "relative w-full max-w-md overflow-hidden",
        "bg-white dark:bg-gray-800",
        "rounded-lg shadow-lg",
        "border border-gray-200 dark:border-gray-700",
        // Left border accent
        "border-l-4",
        config.borderColor,
        // Animation
        isExiting ? "animate-toast-exit" : "animate-toast-enter",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className={cn("flex-shrink-0 mt-0.5", config.iconColor)}>
          <Icon name={config.icon} size="md" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </p>
          {description && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className={cn(
            "flex-shrink-0 p-1 -m-1",
            "rounded-lg",
            "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300",
            "hover:bg-gray-100 dark:hover:bg-gray-700",
            "transition-colors duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          )}
          aria-label="Dismiss notification"
        >
          <Icon name="close" size="sm" />
        </button>
      </div>

      {/* Progress Bar */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-100 dark:bg-gray-700">
          <div
            className={cn(
              "h-full transition-all duration-75",
              variant === "success" && "bg-emerald-500",
              variant === "error" && "bg-red-500",
              variant === "warning" && "bg-amber-500",
              variant === "info" && "bg-blue-500",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TOAST CONTEXT & PROVIDER
// ============================================================================

interface ToastContextType {
  toast: ToastFunction;
}

interface ToastFunction {
  (data: Omit<ToastData, "id">): void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

/**
 * ToastProvider - Wraps your app to enable toast notifications
 *
 * @example
 * ```tsx
 * // In app/layout.tsx
 * import { ToastProvider } from '@/components/ui/Toast';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ToastProvider>
 *           {children}
 *         </ToastProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [isMounted, setIsMounted] = useState(false);

  // Handle client-side mounting for portal
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Add a new toast
  const addToast = useCallback((data: Omit<ToastData, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: ToastData = {
      ...data,
      id,
      duration: data.duration ?? DEFAULT_DURATION,
    };

    setToasts((prev) => {
      const updated = [newToast, ...prev];
      // Remove oldest if exceeding max
      if (updated.length > MAX_TOASTS) {
        return updated.slice(0, MAX_TOASTS);
      }
      return updated;
    });
  }, []);

  // Remove a toast
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Create toast function with convenience methods
  const toastFunction: ToastFunction = useCallback(
    (data: Omit<ToastData, "id">) => addToast(data),
    [addToast],
  ) as ToastFunction;

  // Add convenience methods
  toastFunction.success = useCallback(
    (title: string, description?: string) =>
      addToast({ variant: "success", title, description }),
    [addToast],
  );
  toastFunction.error = useCallback(
    (title: string, description?: string) =>
      addToast({ variant: "error", title, description }),
    [addToast],
  );
  toastFunction.warning = useCallback(
    (title: string, description?: string) =>
      addToast({ variant: "warning", title, description }),
    [addToast],
  );
  toastFunction.info = useCallback(
    (title: string, description?: string) =>
      addToast({ variant: "info", title, description }),
    [addToast],
  );

  return (
    <ToastContext.Provider value={{ toast: toastFunction }}>
      {children}
      {/* Toast Container - rendered via portal */}
      {isMounted &&
        createPortal(
          <div
            aria-live="polite"
            aria-label="Notifications"
            className={cn(
              "fixed top-4 right-4 z-[100]",
              "flex flex-col gap-3",
              "w-full max-w-md",
              "pointer-events-none",
            )}
          >
            {toasts.map((toast) => (
              <div key={toast.id} className="pointer-events-auto">
                <Toast {...toast} onClose={removeToast} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

ToastProvider.displayName = "ToastProvider";

/**
 * Hook to access toast functionality
 *
 * @example
 * ```tsx
 * import { useToast } from '@/components/ui/Toast';
 *
 * function MyComponent() {
 *   const { toast } = useToast();
 *
 *   const handleSave = async () => {
 *     try {
 *       await saveData();
 *       toast.success('Changes saved!');
 *     } catch (error) {
 *       toast.error('Failed to save', error.message);
 *     }
 *   };
 *
 *   return <button onClick={handleSave}>Save</button>;
 * }
 * ```
 */
export function useToast(): ToastContextType {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}

// Export individual Toast for edge cases
export { Toast };
export type { ToastProps };
