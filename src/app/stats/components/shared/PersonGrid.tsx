"use client";

import { forwardRef, type HTMLAttributes, useMemo, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

// ============================================================================
// PERSON GRID - Actor/Director/Crew display grid
// Displays profile images with names, roles, and counts
// ============================================================================

export interface Person {
  /** Unique identifier */
  id: number;
  /** Person's name */
  name: string;
  /** Optional role description */
  role?: string;
  /** TMDB profile image path (e.g., "/abc123.jpg") */
  profilePath?: string | null;
  /** Number of appearances in filtered films */
  count?: number;
}

export interface PersonGridProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Array of people to display */
  people: Person[];
  /** Maximum number of people to show */
  maxPeople?: number;
  /** Display variant */
  variant?: "compact" | "detailed";
  /** Click handler for individual person cards */
  onPersonClick?: (person: Person) => void;
  /** Additional CSS classes */
  className?: string;
}

// TMDB image base URL
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185";

// Fallback avatar component
const FallbackAvatar = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "flex items-center justify-center",
      "bg-gradient-to-br from-gray-200 to-gray-300",
      "dark:from-gray-600 dark:to-gray-700",
      className,
    )}
  >
    <Icon name="user" size="lg" className="text-gray-400 dark:text-gray-500" />
  </div>
);

// Individual person card component
interface PersonCardProps {
  person: Person;
  variant: "compact" | "detailed";
  isClickable: boolean;
  onClick?: () => void;
  useLazyLoad: boolean;
}

const PersonCard = forwardRef<HTMLButtonElement, PersonCardProps>(
  ({ person, variant, isClickable, onClick, useLazyLoad }, ref) => {
    const [imageError, setImageError] = useState(false);
    const hasImage = person.profilePath && !imageError;

    const imageSize = variant === "compact" ? 64 : 96;
    const imageSizeClass = variant === "compact" ? "w-16 h-16" : "w-24 h-24";

    return (
      <button
        ref={ref}
        type="button"
        disabled={!isClickable}
        onClick={onClick}
        className={cn(
          "group flex flex-col items-center gap-2",
          "p-2 rounded-xl transition-all duration-200",
          // Interactive states
          isClickable &&
            cn(
              "cursor-pointer",
              "hover:bg-gray-100 dark:hover:bg-gray-700/50",
              "hover:shadow-md hover:scale-105",
              "active:scale-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
            ),
          !isClickable && "cursor-default",
        )}
        aria-label={`${person.name}${person.count ? `, ${person.count} films` : ""}`}
      >
        {/* Profile Image */}
        <div
          className={cn(
            "relative rounded-full overflow-hidden",
            imageSizeClass,
          )}
        >
          {hasImage ? (
            <Image
              src={`${TMDB_IMAGE_BASE}${person.profilePath}`}
              alt={person.name}
              width={imageSize}
              height={imageSize}
              loading={useLazyLoad ? "lazy" : "eager"}
              className="object-cover w-full h-full"
              onError={() => setImageError(true)}
            />
          ) : (
            <FallbackAvatar className={cn("w-full h-full", imageSizeClass)} />
          )}

          {/* Count badge overlay */}
          {person.count !== undefined && person.count > 0 && (
            <div className="absolute -bottom-1 -right-1">
              <Badge
                variant="primary"
                size="sm"
                className="shadow-md font-bold min-w-[1.5rem] justify-center"
              >
                {person.count}
              </Badge>
            </div>
          )}
        </div>

        {/* Name */}
        <div className="text-center max-w-full">
          <p
            className={cn(
              "font-medium text-gray-900 dark:text-gray-100 truncate",
              variant === "compact" ? "text-xs" : "text-sm",
            )}
            title={person.name}
          >
            {person.name}
          </p>

          {/* Role (detailed variant only) */}
          {variant === "detailed" && person.role && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
              {person.role}
            </p>
          )}
        </div>
      </button>
    );
  },
);

PersonCard.displayName = "PersonCard";

/**
 * PersonGrid component for displaying actor/director/crew grids.
 * Supports profile images with fallback avatars, count badges, and lazy loading.
 *
 * @example
 * ```tsx
 * <PersonGrid
 *   people={[
 *     { id: 1, name: 'Christopher Nolan', role: 'Director', count: 8, profilePath: '/abc.jpg' },
 *     { id: 2, name: 'Denis Villeneuve', role: 'Director', count: 5 },
 *   ]}
 *   variant="detailed"
 *   onPersonClick={(person) => console.log('Clicked:', person.name)}
 * />
 * ```
 */
export const PersonGrid = forwardRef<HTMLDivElement, PersonGridProps>(
  (
    {
      people,
      maxPeople = 12,
      variant = "compact",
      onPersonClick,
      className,
      ...props
    },
    ref,
  ) => {
    // Limit people and determine lazy loading threshold
    const displayedPeople = useMemo(() => {
      return people.slice(0, maxPeople);
    }, [people, maxPeople]);

    const useLazyLoad = displayedPeople.length > 20;
    const isClickable = Boolean(onPersonClick);

    if (displayedPeople.length === 0) {
      return null;
    }

    // Grid columns based on variant and screen size
    const gridCols =
      variant === "compact"
        ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-8"
        : "grid-cols-3 sm:grid-cols-4 md:grid-cols-6";

    return (
      <div
        ref={ref}
        className={cn("grid gap-3", gridCols, className)}
        role="list"
        aria-label="People grid"
        {...props}
      >
        {displayedPeople.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            variant={variant}
            isClickable={isClickable}
            onClick={() => onPersonClick?.(person)}
            useLazyLoad={useLazyLoad}
          />
        ))}
      </div>
    );
  },
);

PersonGrid.displayName = "PersonGrid";

export default PersonGrid;
