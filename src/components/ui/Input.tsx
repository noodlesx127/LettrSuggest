"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";
import { cn } from "@/lib/cn";

// ============================================================================
// INPUT COMPONENT - Core Design System Primitive
// Accessible text input with label, error, helper text, icon support
// ============================================================================

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Label text displayed above the input */
  label?: string;
  /** Error message displayed below the input (triggers error state) */
  error?: string;
  /** Helper text displayed below the input */
  helperText?: string;
  /** Icon element displayed on the left side of the input */
  icon?: ReactNode;
  /** Makes input take full width of container */
  fullWidth?: boolean;
  /** Additional classes for the container div */
  containerClassName?: string;
  /** Size of the input */
  inputSize?: "sm" | "md" | "lg";
}

// Base input styles
const baseInputStyles = cn(
  // Layout
  "w-full",
  // Typography
  "text-sm",
  // Background with dark mode
  "bg-white dark:bg-gray-800",
  // Border
  "border border-gray-300 dark:border-gray-600",
  // Border radius
  "rounded-xl",
  // Transitions
  "transition-all duration-150",
  // Placeholder
  "placeholder:text-gray-400 dark:placeholder:text-gray-500",
  // Text color
  "text-gray-900 dark:text-gray-100",
  // Focus state
  "focus:outline-none focus:ring-2 focus:ring-offset-0",
  "focus:ring-violet-500 focus:border-violet-500",
  // Disabled state
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900",
);

// Size-specific styles
const sizeStyles = {
  sm: "h-9 px-3 text-xs",
  md: cn(
    "h-11 px-4 text-sm",
    // Minimum touch target of 44px
    "min-h-[44px]",
  ),
  lg: "h-13 px-5 text-base min-h-[52px]",
};

// Icon padding adjustments
const iconPaddingStyles = {
  sm: "pl-9",
  md: "pl-11",
  lg: "pl-12",
};

// Error state styles
const errorStyles = cn(
  "border-red-500 dark:border-red-400",
  "focus:ring-red-500 focus:border-red-500",
  // Light red background hint
  "bg-red-50/50 dark:bg-red-950/20",
);

// Icon wrapper styles per size
const iconWrapperStyles = {
  sm: "left-3 [&>svg]:w-3.5 [&>svg]:h-3.5",
  md: "left-4 [&>svg]:w-4 [&>svg]:h-4",
  lg: "left-4 [&>svg]:w-5 [&>svg]:h-5",
};

/**
 * Input component with label, error state, helper text, and icon support.
 *
 * @example
 * ```tsx
 * <Input
 *   label="Email address"
 *   type="email"
 *   placeholder="you@example.com"
 *   error={errors.email}
 * />
 *
 * <Input
 *   placeholder="Search movies..."
 *   icon={<SearchIcon />}
 * />
 *
 * <Input
 *   label="Username"
 *   helperText="Choose a unique username"
 * />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      containerClassName,
      label,
      error,
      helperText,
      icon,
      fullWidth = false,
      inputSize = "md",
      disabled,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    // Generate a unique ID for accessibility
    const generatedId = useId();
    const inputId = providedId || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const hasError = Boolean(error);

    return (
      <div className={cn(fullWidth ? "w-full" : "w-auto", containerClassName)}>
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              "block text-sm font-medium mb-1.5",
              "text-gray-700 dark:text-gray-300",
              hasError && "text-red-600 dark:text-red-400",
            )}
          >
            {label}
          </label>
        )}

        {/* Input wrapper for icon positioning */}
        <div className="relative">
          {/* Icon */}
          {icon && (
            <span
              className={cn(
                "absolute inset-y-0 flex items-center",
                "text-gray-400 dark:text-gray-500",
                "pointer-events-none",
                iconWrapperStyles[inputSize],
              )}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}

          {/* Input element */}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={
              hasError ? errorId : helperText ? helperId : undefined
            }
            className={cn(
              baseInputStyles,
              sizeStyles[inputSize],
              icon && iconPaddingStyles[inputSize],
              hasError && errorStyles,
              className,
            )}
            {...props}
          />
        </div>

        {/* Error message */}
        {hasError && (
          <p
            id={errorId}
            className="mt-1.5 text-sm text-red-600 dark:text-red-400 flex items-start gap-1.5"
            role="alert"
          >
            <svg
              className="w-4 h-4 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{error}</span>
          </p>
        )}

        {/* Helper text (only show if no error) */}
        {helperText && !hasError && (
          <p
            id={helperId}
            className="mt-1.5 text-sm text-gray-500 dark:text-gray-400"
          >
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

// ============================================================================
// SEARCH INPUT - Pre-configured search variant
// ============================================================================

export interface SearchInputProps extends Omit<InputProps, "icon" | "type"> {
  /** Optional custom search icon */
  searchIcon?: ReactNode;
}

/**
 * Pre-configured search input with search icon
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ searchIcon, placeholder = "Search...", ...props }, ref) => {
    const defaultSearchIcon = (
      <svg
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    );

    return (
      <Input
        ref={ref}
        type="search"
        icon={searchIcon || defaultSearchIcon}
        placeholder={placeholder}
        {...props}
      />
    );
  },
);

SearchInput.displayName = "SearchInput";

export default Input;
