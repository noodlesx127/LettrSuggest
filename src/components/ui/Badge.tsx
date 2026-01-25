"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ============================================================================
// BADGE COMPONENT - Core Design System Primitive
// Pill-shaped labels with 6 variants, 3 sizes, icon and dot support
// ============================================================================

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual style variant */
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "info";
  /** Size of the badge */
  size?: "sm" | "md" | "lg";
  /** Icon element to display on the left */
  icon?: ReactNode;
  /** Show a status dot indicator */
  dot?: boolean;
}

// Base styles shared by all variants
const baseStyles = cn(
  // Layout
  "inline-flex items-center justify-center gap-1.5",
  // Shape
  "rounded-full",
  // Typography
  "font-medium",
  // Transitions
  "transition-colors duration-150",
  // Prevent text selection for UI badges
  "select-none",
);

// Size-specific styles
const sizeStyles = {
  sm: cn(
    "text-xs px-2 py-0.5",
    // Icon sizing
    "[&>svg]:w-3 [&>svg]:h-3",
  ),
  md: cn(
    "text-sm px-2.5 py-1",
    // Icon sizing
    "[&>svg]:w-3.5 [&>svg]:h-3.5",
  ),
  lg: cn(
    "text-base px-3 py-1.5",
    // Icon sizing
    "[&>svg]:w-4 [&>svg]:h-4",
  ),
};

// Variant-specific styles with light and dark mode support
const variantStyles = {
  default: cn(
    // Light mode
    "bg-gray-100 text-gray-700",
    "border border-gray-200",
    // Dark mode
    "dark:bg-gray-700 dark:text-gray-200",
    "dark:border-gray-600",
  ),
  primary: cn(
    // Light mode - Brand violet
    "bg-violet-100 text-violet-800",
    "border border-violet-200",
    // Dark mode
    "dark:bg-violet-900/50 dark:text-violet-200",
    "dark:border-violet-700/50",
  ),
  success: cn(
    // Light mode - Green for positive consensus
    "bg-emerald-100 text-emerald-800",
    "border border-emerald-200",
    // Dark mode
    "dark:bg-emerald-900/50 dark:text-emerald-200",
    "dark:border-emerald-700/50",
  ),
  warning: cn(
    // Light mode - Amber for mixed reviews
    "bg-amber-100 text-amber-800",
    "border border-amber-200",
    // Dark mode
    "dark:bg-amber-900/50 dark:text-amber-200",
    "dark:border-amber-700/50",
  ),
  danger: cn(
    // Light mode - Red for negative indicators
    "bg-red-100 text-red-800",
    "border border-red-200",
    // Dark mode
    "dark:bg-red-900/50 dark:text-red-200",
    "dark:border-red-700/50",
  ),
  info: cn(
    // Light mode - Blue for informational
    "bg-blue-100 text-blue-800",
    "border border-blue-200",
    // Dark mode
    "dark:bg-blue-900/50 dark:text-blue-200",
    "dark:border-blue-700/50",
  ),
};

// Dot colors matching each variant
const dotColors = {
  default: "bg-gray-500 dark:bg-gray-400",
  primary: "bg-violet-500 dark:bg-violet-400",
  success: "bg-emerald-500 dark:bg-emerald-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-red-500 dark:bg-red-400",
  info: "bg-blue-500 dark:bg-blue-400",
};

// Dot sizes matching badge sizes
const dotSizes = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
  lg: "w-2.5 h-2.5",
};

/**
 * Badge component for status indicators, labels, and tags.
 *
 * @example
 * ```tsx
 * <Badge variant="success">Certified Fresh</Badge>
 * <Badge variant="warning" icon={<AlertIcon />}>Mixed Reviews</Badge>
 * <Badge variant="primary" size="sm" dot>Featured</Badge>
 * <Badge variant="danger" size="lg">Critical</Badge>
 * ```
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      icon,
      dot = false,
      children,
      ...props
    },
    ref,
  ) => {
    const badgeClasses = cn(
      baseStyles,
      sizeStyles[size],
      variantStyles[variant],
      className,
    );

    return (
      <span ref={ref} className={badgeClasses} {...props}>
        {/* Status dot indicator */}
        {dot && (
          <span
            className={cn(
              "rounded-full flex-shrink-0",
              "animate-pulse",
              dotSizes[size],
              dotColors[variant],
            )}
            aria-hidden="true"
          />
        )}

        {/* Icon */}
        {icon && !dot && (
          <span className="flex-shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}

        {/* Content */}
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";

export default Badge;
