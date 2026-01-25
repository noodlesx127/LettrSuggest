import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// ============================================================================
// PROGRESS BAR - Animated progress/coverage bar component
// Displays progress with optional labels and color variants
// ============================================================================

export interface ProgressBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "value"> {
  /** Current value (0-100 or custom max) */
  value: number;
  /** Maximum value (default 100) */
  max?: number;
  /** Optional label text */
  label?: string;
  /** Show percentage value */
  showPercentage?: boolean;
  /** Color variant */
  variant?: "default" | "success" | "warning" | "danger";
  /** Size of the bar */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
}

// Size configurations
const sizeStyles = {
  sm: "h-2",
  md: "h-3",
  lg: "h-4",
};

// Variant gradient styles for the fill bar
const variantStyles = {
  default: cn(
    "bg-gradient-to-r from-violet-500 to-purple-500",
    "dark:from-violet-400 dark:to-purple-400",
  ),
  success: cn(
    "bg-gradient-to-r from-emerald-500 to-teal-500",
    "dark:from-emerald-400 dark:to-teal-400",
  ),
  warning: cn(
    "bg-gradient-to-r from-amber-500 to-yellow-500",
    "dark:from-amber-400 dark:to-yellow-400",
  ),
  danger: cn(
    "bg-gradient-to-r from-red-500 to-rose-500",
    "dark:from-red-400 dark:to-rose-400",
  ),
};

// Background track styles
const trackStyles = cn(
  "bg-gray-200 dark:bg-gray-700",
  "rounded-full overflow-hidden",
);

/**
 * ProgressBar component for displaying progress/coverage metrics.
 * Features smooth gradient fills, animated mount, and accessibility support.
 *
 * @example
 * ```tsx
 * <ProgressBar
 *   value={75}
 *   label="Metadata Coverage"
 *   showPercentage
 *   variant="success"
 *   size="md"
 * />
 * ```
 */
export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  (
    {
      value,
      max = 100,
      label,
      showPercentage = false,
      variant = "default",
      size = "md",
      className,
      ...props
    },
    ref,
  ) => {
    // Calculate percentage, clamped between 0-100
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    const displayValue = Math.round(percentage);

    return (
      <div ref={ref} className={cn("w-full", className)} {...props}>
        {/* Label and percentage row */}
        {(label || showPercentage) && (
          <div className="flex items-center justify-between mb-1.5">
            {label && (
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {label}
              </span>
            )}
            {showPercentage && (
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {displayValue}%
              </span>
            )}
          </div>
        )}

        {/* Progress track */}
        <div
          className={cn(trackStyles, sizeStyles[size])}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={label || "Progress"}
        >
          {/* Progress fill */}
          <div
            className={cn(
              "h-full rounded-full",
              "transition-all duration-500 ease-out",
              variantStyles[variant],
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  },
);

ProgressBar.displayName = "ProgressBar";

export default ProgressBar;
