"use client";

import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

// ============================================================================
// STAT CARD - Stats-specific metric display component
// Displays a single metric with icon, value, and optional trend indicator
// ============================================================================

export interface StatCardChange {
  /** Numeric change value */
  value: number;
  /** Direction of trend */
  trend: "up" | "down" | "neutral";
  /** Optional label for the change (e.g., "vs last month") */
  label?: string;
}

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Icon to display (can be ReactNode or IconName string) */
  icon?: ReactNode | IconName;
  /** Card title/label */
  title: string;
  /** Main value to display */
  value: string | number;
  /** Optional change indicator with trend */
  change?: StatCardChange;
  /** Visual variant */
  variant?: "default" | "highlight" | "subtle";
  /** Additional CSS classes */
  className?: string;
}

// Variant styles for the card
const variantStyles = {
  default: cn(
    "bg-white dark:bg-gray-800",
    "border border-gray-200 dark:border-gray-700",
  ),
  highlight: cn(
    "bg-gradient-to-br from-violet-50 to-purple-50",
    "dark:from-violet-900/20 dark:to-purple-900/20",
    "border border-violet-200 dark:border-violet-700/50",
    "shadow-sm shadow-violet-500/10",
  ),
  subtle: cn(
    "bg-gray-50 dark:bg-gray-800/50",
    "border border-gray-100 dark:border-gray-700/50",
  ),
};

// Trend indicator colors
const trendColors = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-red-600 dark:text-red-400",
  neutral: "text-gray-500 dark:text-gray-400",
};

// Trend icons
const trendIcons: Record<StatCardChange["trend"], IconName> = {
  up: "arrow-up",
  down: "arrow-down",
  neutral: "minus",
};

/**
 * StatCard component for displaying metric cards in stats dashboards.
 * Supports icons, trend indicators, and multiple visual variants.
 *
 * @example
 * ```tsx
 * <StatCard
 *   icon="film"
 *   title="Films Watched"
 *   value={247}
 *   change={{ value: 12, trend: 'up', label: 'this month' }}
 *   variant="highlight"
 * />
 * ```
 */
export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  (
    { icon, title, value, change, variant = "default", className, ...props },
    ref,
  ) => {
    // Determine if icon is a string (IconName) or ReactNode
    const renderIcon = () => {
      if (!icon) return null;
      if (typeof icon === "string") {
        return (
          <Icon
            name={icon as IconName}
            size="md"
            className="text-violet-500 dark:text-violet-400"
          />
        );
      }
      return icon;
    };

    return (
      <Card
        ref={ref}
        padding="md"
        className={cn(
          "rounded-xl overflow-hidden transition-all duration-200",
          variantStyles[variant],
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-3">
          {/* Header: Icon + Title */}
          <div className="flex items-center gap-2">
            {icon && <div className="flex-shrink-0">{renderIcon()}</div>}
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">
              {title}
            </span>
          </div>

          {/* Value */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
              {value}
            </span>
          </div>

          {/* Change Indicator */}
          {change && (
            <div
              className={cn(
                "flex items-center gap-1.5 text-sm",
                trendColors[change.trend],
              )}
            >
              <Icon name={trendIcons[change.trend]} size="xs" />
              <span className="font-medium">
                {change.trend === "up" && "+"}
                {change.value}
              </span>
              {change.label && (
                <span className="text-gray-500 dark:text-gray-400 font-normal">
                  {change.label}
                </span>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  },
);

StatCard.displayName = "StatCard";

export default StatCard;
