"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ============================================================================
// CARD COMPONENT - Core Design System Primitive
// Versatile container with 5 variants, gradient support, dark mode ready
// ============================================================================

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual style variant */
  variant?: "default" | "gradient" | "outlined" | "interactive" | "elevated";
  /** Padding size */
  padding?: "none" | "sm" | "md" | "lg";
  /** Gradient color scheme (only applies when variant="gradient") */
  gradient?: "brand" | "success" | "warning" | "info" | "danger";
  /** Children elements */
  children?: ReactNode;
}

// Padding styles
const paddingStyles = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

// Base styles shared by all variants
const baseStyles = cn(
  // Border radius matching TasteProfileSummary
  "rounded-xl",
  // Overflow handling
  "overflow-hidden",
  // Transition for smooth state changes
  "transition-all duration-200",
);

// Variant-specific styles
const variantStyles = {
  default: cn(
    // Background with dark mode support
    "bg-white dark:bg-gray-800",
    // Border for definition
    "border border-gray-200 dark:border-gray-700",
  ),
  gradient: cn(
    // Base gradient will be applied separately based on gradient prop
    "border border-transparent",
  ),
  outlined: cn(
    // Transparent background
    "bg-transparent",
    // Border for definition
    "border-2 border-gray-200 dark:border-gray-700",
  ),
  interactive: cn(
    // Background
    "bg-white dark:bg-gray-800",
    // Border
    "border border-gray-200 dark:border-gray-700",
    // Interactive states
    "cursor-pointer",
    "hover:shadow-lg dark:hover:shadow-black/20",
    "hover:scale-[1.01]",
    "hover:border-gray-300 dark:hover:border-gray-600",
    // Focus for keyboard navigation
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
    // Active state
    "active:scale-[0.99]",
  ),
  elevated: cn(
    // Background
    "bg-white dark:bg-gray-800",
    // Border
    "border border-gray-100 dark:border-gray-700/50",
    // Shadow for elevation
    "shadow-md dark:shadow-black/20",
    // Subtle hover lift
    "hover:shadow-lg dark:hover:shadow-black/30",
  ),
};

// Gradient color schemes
const gradientStyles = {
  brand: cn(
    "bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500",
    "text-white",
    // Decorative shadow
    "shadow-lg shadow-violet-500/20",
  ),
  success: cn(
    "bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500",
    "text-white",
    "shadow-lg shadow-emerald-500/20",
  ),
  warning: cn(
    "bg-gradient-to-br from-amber-400 via-orange-500 to-yellow-500",
    "text-white",
    "shadow-lg shadow-amber-500/20",
  ),
  info: cn(
    "bg-gradient-to-br from-blue-500 via-cyan-500 to-sky-500",
    "text-white",
    "shadow-lg shadow-blue-500/20",
  ),
  danger: cn(
    "bg-gradient-to-br from-red-500 via-rose-500 to-pink-500",
    "text-white",
    "shadow-lg shadow-red-500/20",
  ),
};

/**
 * Card component for containing related content and actions.
 *
 * @example
 * ```tsx
 * <Card>
 *   <h2>Default Card</h2>
 * </Card>
 *
 * <Card variant="gradient" gradient="brand" padding="lg">
 *   <h2 className="text-white">Featured Content</h2>
 * </Card>
 *
 * <Card variant="interactive" onClick={handleClick}>
 *   <p>Clickable card</p>
 * </Card>
 * ```
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      variant = "default",
      padding = "md",
      gradient = "brand",
      children,
      ...props
    },
    ref,
  ) => {
    const cardClasses = cn(
      baseStyles,
      paddingStyles[padding],
      variant === "gradient"
        ? gradientStyles[gradient]
        : variantStyles[variant],
      className,
    );

    // For interactive cards, ensure proper semantics
    const interactiveProps =
      variant === "interactive"
        ? {
            role: "button" as const,
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
              // Handle Enter and Space for keyboard accessibility
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                (e.currentTarget as HTMLDivElement).click();
              }
              props.onKeyDown?.(e);
            },
          }
        : {};

    return (
      <div ref={ref} className={cardClasses} {...interactiveProps} {...props}>
        {children}
      </div>
    );
  },
);

Card.displayName = "Card";

// ============================================================================
// CARD HEADER - Optional composition component
// ============================================================================

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col space-y-1.5",
          "pb-4 border-b border-gray-100 dark:border-gray-700/50",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

CardHeader.displayName = "CardHeader";

// ============================================================================
// CARD TITLE - Optional composition component
// ============================================================================

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children?: ReactNode;
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <h3
        ref={ref}
        className={cn(
          "text-lg font-semibold tracking-tight",
          "text-gray-900 dark:text-gray-100",
          className,
        )}
        {...props}
      >
        {children}
      </h3>
    );
  },
);

CardTitle.displayName = "CardTitle";

// ============================================================================
// CARD CONTENT - Optional composition component
// ============================================================================

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("pt-4", className)} {...props}>
        {children}
      </div>
    );
  },
);

CardContent.displayName = "CardContent";

// ============================================================================
// CARD FOOTER - Optional composition component
// ============================================================================

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3",
          "pt-4 mt-4 border-t border-gray-100 dark:border-gray-700/50",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

CardFooter.displayName = "CardFooter";

export default Card;
