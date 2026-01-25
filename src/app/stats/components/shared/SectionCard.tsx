"use client";

import {
  forwardRef,
  useState,
  useCallback,
  type ReactNode,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

// ============================================================================
// SECTION CARD - Collapsible section wrapper for stats tabs
// Provides consistent section styling with optional collapse functionality
// ============================================================================

export interface SectionCardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Section title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Enable collapsible behavior */
  collapsible?: boolean;
  /** Default open state (when collapsible) */
  defaultOpen?: boolean;
  /** Optional icon for the header */
  icon?: ReactNode;
  /** Optional action element for the header (e.g., filter buttons) */
  headerAction?: ReactNode;
  /** Section content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * SectionCard component for wrapping collapsible sections within stats tabs.
 * Provides consistent Card-based styling with optional collapse/expand functionality.
 *
 * @example
 * ```tsx
 * <SectionCard
 *   title="Top Genres"
 *   subtitle="Based on your watch history"
 *   icon={<Icon name="film" />}
 *   collapsible
 *   defaultOpen
 *   headerAction={<Button size="sm" variant="ghost">Filter</Button>}
 * >
 *   <TagCloud tags={genres} />
 * </SectionCard>
 * ```
 */
export const SectionCard = forwardRef<HTMLDivElement, SectionCardProps>(
  (
    {
      title,
      subtitle,
      collapsible = false,
      defaultOpen = true,
      icon,
      headerAction,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const toggleOpen = useCallback(() => {
      if (collapsible) {
        setIsOpen((prev) => !prev);
      }
    }, [collapsible]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (collapsible && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggleOpen();
        }
      },
      [collapsible, toggleOpen],
    );

    const headerId = `section-header-${title.toLowerCase().replace(/\s+/g, "-")}`;
    const contentId = `section-content-${title.toLowerCase().replace(/\s+/g, "-")}`;

    return (
      <Card
        ref={ref}
        padding="none"
        className={cn(
          "rounded-xl overflow-hidden",
          "bg-white dark:bg-gray-800",
          "border border-gray-200 dark:border-gray-700",
          className,
        )}
        {...props}
      >
        {/* Header */}
        <div
          id={headerId}
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? isOpen : undefined}
          aria-controls={collapsible ? contentId : undefined}
          onClick={collapsible ? toggleOpen : undefined}
          onKeyDown={collapsible ? handleKeyDown : undefined}
          className={cn(
            "px-5 py-4",
            "flex items-center justify-between gap-3",
            collapsible &&
              cn(
                "cursor-pointer select-none",
                "transition-colors duration-150",
                "hover:bg-gray-50 dark:hover:bg-gray-700/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500",
              ),
            // Border only when content is open
            isOpen && "border-b border-gray-100 dark:border-gray-700/50",
          )}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Icon */}
            {icon && (
              <div className="flex-shrink-0 text-violet-500 dark:text-violet-400">
                {icon}
              </div>
            )}

            {/* Title and subtitle */}
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Right side: action and/or chevron */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Header action slot */}
            {headerAction && (
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {headerAction}
              </div>
            )}

            {/* Collapse chevron */}
            {collapsible && (
              <Icon
                name="chevron-down"
                size="sm"
                className={cn(
                  "text-gray-400 transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            )}
          </div>
        </div>

        {/* Content */}
        <div
          id={contentId}
          role="region"
          aria-labelledby={headerId}
          className={cn(
            "transition-all duration-200 ease-out",
            isOpen ? "opacity-100" : "opacity-0 h-0 overflow-hidden",
          )}
        >
          <div className="p-5">{children}</div>
        </div>
      </Card>
    );
  },
);

SectionCard.displayName = "SectionCard";

export default SectionCard;
