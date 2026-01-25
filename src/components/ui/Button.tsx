"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ============================================================================
// BUTTON COMPONENT - Core Design System Primitive
// Production-ready button with 5 variants, 3 sizes, loading state, icons
// ============================================================================

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  /** Size of the button */
  size?: "sm" | "md" | "lg";
  /** Shows loading spinner and disables button */
  loading?: boolean;
  /** Icon element to display on the left */
  icon?: ReactNode;
  /** Makes button take full width of container */
  fullWidth?: boolean;
  /** If provided, renders as an anchor tag */
  href?: string;
  /** Additional content after children */
  rightIcon?: ReactNode;
}

// Loading spinner component
function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// Base styles shared by all variants
const baseStyles = cn(
  // Layout
  "inline-flex items-center justify-center gap-2",
  // Typography
  "font-medium text-sm",
  // Border radius
  "rounded-xl",
  // Transitions
  "transition-all duration-150 ease-out",
  // Focus ring for accessibility
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  // Disabled state
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none",
  // Touch-friendly
  "select-none",
);

// Variant-specific styles
const variantStyles = {
  primary: cn(
    // Gradient background
    "bg-gradient-to-r from-violet-600 to-fuchsia-600",
    // Text color
    "text-white",
    // Shadow with brand color tint
    "shadow-lg shadow-violet-500/30",
    // Hover effects
    "hover:from-violet-700 hover:to-fuchsia-700",
    "hover:shadow-xl hover:shadow-violet-500/40",
    "hover:scale-[1.02]",
    // Active state
    "active:scale-[0.98]",
    // Focus ring
    "focus-visible:ring-violet-500",
  ),
  secondary: cn(
    // Background
    "bg-gray-100 dark:bg-gray-700",
    // Text color
    "text-gray-900 dark:text-gray-100",
    // Border for definition
    "border border-gray-200 dark:border-gray-600",
    // Hover effects
    "hover:bg-gray-200 dark:hover:bg-gray-600",
    "hover:scale-[1.01]",
    // Active state
    "active:scale-[0.99]",
    // Focus ring
    "focus-visible:ring-gray-500",
  ),
  ghost: cn(
    // Transparent background
    "bg-transparent",
    // Text color
    "text-gray-700 dark:text-gray-300",
    // Hover effects
    "hover:bg-gray-100 dark:hover:bg-gray-700/50",
    // Active state
    "active:bg-gray-200 dark:active:bg-gray-700",
    // Focus ring
    "focus-visible:ring-gray-500",
  ),
  danger: cn(
    // Gradient background
    "bg-gradient-to-r from-red-500 to-rose-600",
    // Text color
    "text-white",
    // Shadow with danger color tint
    "shadow-lg shadow-red-500/30",
    // Hover effects
    "hover:from-red-600 hover:to-rose-700",
    "hover:shadow-xl hover:shadow-red-500/40",
    "hover:scale-[1.02]",
    // Active state
    "active:scale-[0.98]",
    // Focus ring
    "focus-visible:ring-red-500",
  ),
  success: cn(
    // Gradient background
    "bg-gradient-to-r from-emerald-500 to-green-600",
    // Text color
    "text-white",
    // Shadow with success color tint
    "shadow-lg shadow-emerald-500/30",
    // Hover effects
    "hover:from-emerald-600 hover:to-green-700",
    "hover:shadow-xl hover:shadow-emerald-500/40",
    "hover:scale-[1.02]",
    // Active state
    "active:scale-[0.98]",
    // Focus ring
    "focus-visible:ring-emerald-500",
  ),
};

// Size-specific styles
const sizeStyles = {
  sm: cn(
    "h-9 px-3 text-xs",
    // Icon sizing
    "[&>svg]:w-3.5 [&>svg]:h-3.5",
  ),
  md: cn(
    "h-11 px-4 text-sm",
    // Minimum touch target of 44px
    "min-h-[44px]",
    // Icon sizing
    "[&>svg]:w-4 [&>svg]:h-4",
  ),
  lg: cn(
    "h-13 px-6 text-base",
    // Larger touch target
    "min-h-[52px]",
    // Icon sizing
    "[&>svg]:w-5 [&>svg]:h-5",
  ),
};

/**
 * Button component with multiple variants, sizes, and states.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="md" icon={<StarIcon />}>
 *   Get Suggestions
 * </Button>
 *
 * <Button variant="danger" loading>
 *   Deleting...
 * </Button>
 *
 * <Button variant="ghost" href="/settings">
 *   Settings
 * </Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      icon,
      rightIcon,
      fullWidth = false,
      href,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    const buttonClasses = cn(
      baseStyles,
      variantStyles[variant],
      sizeStyles[size],
      fullWidth && "w-full",
      className,
    );

    const content = (
      <>
        {loading ? (
          <LoadingSpinner
            className={cn(
              size === "sm" && "w-3.5 h-3.5",
              size === "md" && "w-4 h-4",
              size === "lg" && "w-5 h-5",
            )}
          />
        ) : icon ? (
          <span className="flex-shrink-0" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children && <span>{children}</span>}
        {rightIcon && !loading && (
          <span className="flex-shrink-0" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </>
    );

    // Render as anchor if href is provided
    if (href && !isDisabled) {
      return (
        <a href={href} className={buttonClasses} role="button">
          {content}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        className={buttonClasses}
        disabled={isDisabled}
        aria-busy={loading}
        aria-disabled={isDisabled}
        {...props}
      >
        {content}
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
