"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

// ============================================================================
// TABS COMPONENT - Core Design System Primitive
// Accessible tab interface with keyboard navigation (Arrow keys, Home, End)
// Composition API: Tabs, TabsList, TabsTrigger, TabsContent
// ============================================================================

// ============================================================================
// TABS CONTEXT
// ============================================================================

interface TabsContextValue {
  /** Currently active tab value */
  value: string;
  /** Callback to change active tab */
  onValueChange: (value: string) => void;
  /** Base ID for generating accessible IDs */
  baseId: string;
  /** Register a tab trigger for keyboard navigation */
  registerTrigger: (value: string, element: HTMLButtonElement | null) => void;
  /** Get all registered trigger values in order */
  getTriggerValues: () => string[];
  /** Focus a specific trigger by value */
  focusTrigger: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error(
      "Tabs compound components must be used within a <Tabs> component",
    );
  }
  return context;
}

// ============================================================================
// TABS ROOT
// ============================================================================

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  /** Default active tab value (uncontrolled) */
  defaultValue: string;
  /** Controlled active tab value */
  value?: string;
  /** Callback when active tab changes */
  onValueChange?: (value: string) => void;
  /** Children elements */
  children: ReactNode;
}

/**
 * Root tabs container that manages state and provides context.
 *
 * @example
 * ```tsx
 * <Tabs defaultValue="overview">
 *   <TabsList>
 *     <TabsTrigger value="overview">Overview</TabsTrigger>
 *     <TabsTrigger value="taste">Taste Profile</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="overview">...</TabsContent>
 *   <TabsContent value="taste">...</TabsContent>
 * </Tabs>
 * ```
 */
export const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      className,
      defaultValue,
      value: controlledValue,
      onValueChange,
      children,
      ...props
    },
    ref,
  ) => {
    const baseId = useId();
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);

    // Determine if we're in controlled mode
    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : uncontrolledValue;

    // Map of trigger values to their DOM elements
    const triggersRef = useRef<Map<string, HTMLButtonElement>>(new Map());
    // Ordered list of trigger values (in DOM order)
    const triggerOrderRef = useRef<string[]>([]);

    const handleValueChange = useCallback(
      (newValue: string) => {
        if (!isControlled) {
          setUncontrolledValue(newValue);
        }
        onValueChange?.(newValue);
      },
      [isControlled, onValueChange],
    );

    const registerTrigger = useCallback(
      (triggerValue: string, element: HTMLButtonElement | null) => {
        if (element) {
          triggersRef.current.set(triggerValue, element);
          // Update order based on current map (approximation - order is based on registration)
          if (!triggerOrderRef.current.includes(triggerValue)) {
            triggerOrderRef.current.push(triggerValue);
          }
        } else {
          triggersRef.current.delete(triggerValue);
          triggerOrderRef.current = triggerOrderRef.current.filter(
            (v) => v !== triggerValue,
          );
        }
      },
      [],
    );

    const getTriggerValues = useCallback(() => {
      return triggerOrderRef.current;
    }, []);

    const focusTrigger = useCallback((triggerValue: string) => {
      const element = triggersRef.current.get(triggerValue);
      element?.focus();
    }, []);

    return (
      <TabsContext.Provider
        value={{
          value,
          onValueChange: handleValueChange,
          baseId,
          registerTrigger,
          getTriggerValues,
          focusTrigger,
        }}
      >
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  },
);

Tabs.displayName = "Tabs";

// ============================================================================
// TABS LIST
// ============================================================================

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  /** Tab trigger children */
  children: ReactNode;
}

/**
 * Container for tab triggers with horizontal scroll on mobile.
 */
export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="tablist"
        aria-orientation="horizontal"
        className={cn(
          // Layout
          "flex items-center",
          // Spacing between tabs
          "gap-1",
          // Bottom border for underline effect
          "border-b border-gray-200 dark:border-gray-700",
          // Horizontal scroll on mobile
          "overflow-x-auto scrollbar-hide",
          // Hide scrollbar (cross-browser)
          "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          // Prevent wrapping
          "whitespace-nowrap",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

TabsList.displayName = "TabsList";

// ============================================================================
// TABS TRIGGER
// ============================================================================

export interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  /** Value that identifies this tab */
  value: string;
  /** Disable the tab */
  disabled?: boolean;
  /** Children elements */
  children: ReactNode;
}

/**
 * Tab trigger button with keyboard navigation support.
 *
 * Keyboard controls:
 * - ArrowLeft/ArrowRight: Navigate between tabs
 * - Home: Go to first tab
 * - End: Go to last tab
 * - Enter/Space: Activate tab (default button behavior)
 */
export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, disabled = false, children, ...props }, ref) => {
    const context = useTabsContext();
    const isActive = context.value === value;
    const triggerId = `${context.baseId}-trigger-${value}`;
    const contentId = `${context.baseId}-content-${value}`;

    // Local ref for registration
    const localRef = useRef<HTMLButtonElement | null>(null);

    // Combine refs
    const setRef = useCallback(
      (element: HTMLButtonElement | null) => {
        localRef.current = element;
        context.registerTrigger(value, element);

        // Handle forwardRef
        if (typeof ref === "function") {
          ref(element);
        } else if (ref) {
          ref.current = element;
        }
      },
      [context, value, ref],
    );

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      const triggerValues = context.getTriggerValues();
      const currentIndex = triggerValues.indexOf(value);

      let nextValue: string | null = null;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          // Wrap to end if at start
          const prevIndex =
            currentIndex === 0 ? triggerValues.length - 1 : currentIndex - 1;
          nextValue = triggerValues[prevIndex];
          break;

        case "ArrowRight":
          event.preventDefault();
          // Wrap to start if at end
          const nextIndex =
            currentIndex === triggerValues.length - 1 ? 0 : currentIndex + 1;
          nextValue = triggerValues[nextIndex];
          break;

        case "Home":
          event.preventDefault();
          nextValue = triggerValues[0];
          break;

        case "End":
          event.preventDefault();
          nextValue = triggerValues[triggerValues.length - 1];
          break;
      }

      if (nextValue) {
        context.focusTrigger(nextValue);
        context.onValueChange(nextValue);
      }
    };

    const handleClick = () => {
      if (!disabled) {
        context.onValueChange(value);
      }
    };

    return (
      <button
        ref={setRef}
        id={triggerId}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-controls={contentId}
        aria-disabled={disabled}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          // Layout
          "relative inline-flex items-center justify-center",
          // Padding
          "px-4 py-2.5",
          // Typography
          "text-sm font-medium",
          // Remove default button styles
          "bg-transparent border-none outline-none",
          // Cursor
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          // Bottom border placeholder (for animation)
          "border-b-2 border-transparent",
          // Offset the parent's bottom border
          "-mb-px",
          // Transitions
          "transition-all duration-200",
          // Focus state
          "focus:outline-none focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-0",
          "focus-visible:rounded-t-md",
          // States based on active/disabled
          isActive
            ? cn(
                // Active state
                "border-b-violet-600 dark:border-b-violet-400",
                "text-violet-600 dark:text-violet-400",
                "font-semibold",
              )
            : cn(
                // Inactive state
                "text-gray-600 dark:text-gray-400",
                // Hover (only if not disabled)
                !disabled && "hover:text-gray-900 dark:hover:text-gray-200",
                !disabled &&
                  "hover:border-b-gray-300 dark:hover:border-b-gray-600",
              ),
          // Disabled state
          disabled && "opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

TabsTrigger.displayName = "TabsTrigger";

// ============================================================================
// TABS CONTENT
// ============================================================================

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  /** Value that identifies this content panel */
  value: string;
  /** Children elements */
  children: ReactNode;
}

/**
 * Content panel that shows when its corresponding tab is active.
 * Features a smooth fade-in animation when appearing.
 */
export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = useTabsContext();
    const isActive = context.value === value;
    const contentId = `${context.baseId}-content-${value}`;
    const triggerId = `${context.baseId}-trigger-${value}`;

    if (!isActive) {
      return null;
    }

    return (
      <div
        ref={ref}
        id={contentId}
        role="tabpanel"
        aria-labelledby={triggerId}
        tabIndex={0}
        className={cn(
          // Padding for content
          "pt-4",
          // Focus styles for keyboard navigation
          "focus:outline-none focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
          "focus-visible:rounded-md",
          // Fade-in animation
          "animate-fade-in",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

TabsContent.displayName = "TabsContent";

export default Tabs;
