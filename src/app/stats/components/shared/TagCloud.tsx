"use client";

import { forwardRef, type HTMLAttributes, useMemo } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

// ============================================================================
// TAG CLOUD - Weighted tag display component
// Renders tags with size/opacity based on weight for visual hierarchy
// ============================================================================

export interface Tag {
  /** Display label for the tag */
  label: string;
  /** Weight value between 0-1 for visual scaling */
  weight: number;
  /** Optional count to display */
  count?: number;
}

export interface TagCloudProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Array of tags to display */
  tags: Tag[];
  /** Maximum number of tags to show */
  maxTags?: number;
  /** Click handler for individual tags */
  onTagClick?: (tag: Tag) => void;
  /** Visual variant for tag styling */
  variant?: "gradient" | "solid";
  /** Additional CSS classes */
  className?: string;
}

// Calculate font size based on weight (0.875rem to 1.5rem)
const getFontSize = (weight: number): string => {
  const minSize = 0.875; // 14px
  const maxSize = 1.375; // 22px
  const size = minSize + (maxSize - minSize) * weight;
  return `${size}rem`;
};

// Calculate opacity based on weight (0.6 to 1)
const getOpacity = (weight: number): number => {
  const minOpacity = 0.65;
  const maxOpacity = 1;
  return minOpacity + (maxOpacity - minOpacity) * weight;
};

/**
 * TagCloud component for displaying weighted tags.
 * Tags scale in size and opacity based on their weight values.
 *
 * @example
 * ```tsx
 * <TagCloud
 *   tags={[
 *     { label: 'Drama', weight: 1, count: 45 },
 *     { label: 'Thriller', weight: 0.7, count: 28 },
 *     { label: 'Comedy', weight: 0.4, count: 15 },
 *   ]}
 *   onTagClick={(tag) => console.log('Clicked:', tag.label)}
 *   variant="gradient"
 * />
 * ```
 */
export const TagCloud = forwardRef<HTMLDivElement, TagCloudProps>(
  (
    { tags, maxTags = 15, onTagClick, variant = "solid", className, ...props },
    ref,
  ) => {
    // Sort by weight descending and limit to maxTags
    const sortedTags = useMemo(() => {
      return [...tags].sort((a, b) => b.weight - a.weight).slice(0, maxTags);
    }, [tags, maxTags]);

    if (sortedTags.length === 0) {
      return null;
    }

    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap gap-2 items-center", className)}
        role="list"
        aria-label="Tag cloud"
        {...props}
      >
        {sortedTags.map((tag, index) => {
          const fontSize = getFontSize(tag.weight);
          const opacity = getOpacity(tag.weight);
          const isClickable = Boolean(onTagClick);

          return (
            <button
              key={`${tag.label}-${index}`}
              type="button"
              disabled={!isClickable}
              onClick={() => onTagClick?.(tag)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
                "transition-all duration-200 ease-out",
                "font-medium",
                // Base styles
                variant === "gradient"
                  ? cn(
                      "bg-gradient-to-r from-violet-100 to-purple-100",
                      "dark:from-violet-900/40 dark:to-purple-900/40",
                      "text-violet-800 dark:text-violet-200",
                      "border border-violet-200/50 dark:border-violet-700/50",
                    )
                  : cn(
                      "bg-gray-100 dark:bg-gray-700",
                      "text-gray-800 dark:text-gray-200",
                      "border border-gray-200 dark:border-gray-600",
                    ),
                // Interactive states
                isClickable &&
                  cn(
                    "cursor-pointer",
                    "hover:scale-105 hover:shadow-md",
                    "active:scale-100",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
                  ),
                !isClickable && "cursor-default",
              )}
              style={{
                fontSize,
                opacity,
              }}
              role="listitem"
              aria-label={
                tag.count !== undefined
                  ? `${tag.label}: ${tag.count}`
                  : tag.label
              }
            >
              <span>{tag.label}</span>
              {tag.count !== undefined && (
                <Badge
                  variant="primary"
                  size="sm"
                  className="ml-0.5 text-xs font-semibold"
                >
                  {tag.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    );
  },
);

TagCloud.displayName = "TagCloud";

export default TagCloud;
