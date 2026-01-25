"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

// ============================================================================
// DROPDOWN COMPONENT - Core Design System Select/Combobox
// Accessible dropdown with keyboard navigation, search, and multi-select
// ============================================================================

export interface DropdownOption {
  /** Unique value for the option */
  value: string;
  /** Display label for the option */
  label: string;
  /** Optional icon to display before the label */
  icon?: ReactNode;
  /** Whether the option is disabled */
  disabled?: boolean;
}

export interface DropdownProps {
  /** Array of options to display */
  options: DropdownOption[];
  /** Current selected value (single or array for multiple) */
  value?: string | string[];
  /** Callback when selection changes */
  onChange: (value: string | string[]) => void;
  /** Placeholder text when no selection */
  placeholder?: string;
  /** Enable search/filter functionality */
  searchable?: boolean;
  /** Allow multiple selections */
  multiple?: boolean;
  /** Disable the dropdown */
  disabled?: boolean;
  /** Additional className for the trigger button */
  className?: string;
  /** Size of the dropdown trigger */
  size?: "sm" | "md" | "lg";
}

// Size styles for trigger button
const triggerSizeClasses = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-13 px-5 text-base",
};

/**
 * Dropdown component with accessibility features.
 * Supports single/multi select, search, and full keyboard navigation.
 *
 * @example
 * ```tsx
 * // Single select
 * <Dropdown
 *   options={[
 *     { value: 'recent', label: 'Recently Watched' },
 *     { value: 'rating', label: 'Rating (High to Low)' },
 *     { value: 'title', label: 'Title A-Z' },
 *   ]}
 *   value={sortBy}
 *   onChange={setSortBy}
 *   placeholder="Sort by..."
 * />
 *
 * // Multi select with search
 * <Dropdown
 *   options={genres}
 *   value={selectedGenres}
 *   onChange={setSelectedGenres}
 *   multiple
 *   searchable
 *   placeholder="Select genres..."
 * />
 * ```
 */
export function Dropdown({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchable = false,
  multiple = false,
  disabled = false,
  className,
  size = "md",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useRef(
    `dropdown-listbox-${Math.random().toString(36).slice(2)}`,
  );

  // Normalize value to array for easier handling
  const selectedValues: string[] = Array.isArray(value)
    ? value
    : value
      ? [value]
      : [];

  // Filter options based on search
  const filteredOptions = searchQuery
    ? options.filter((opt) =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : options;

  // Get display text for trigger
  const getDisplayText = (): string => {
    if (selectedValues.length === 0) return placeholder;

    if (multiple) {
      if (selectedValues.length === 1) {
        const opt = options.find((o) => o.value === selectedValues[0]);
        return opt?.label || selectedValues[0];
      }
      return `${selectedValues.length} selected`;
    }

    const selected = options.find((o) => o.value === selectedValues[0]);
    return selected?.label || selectedValues[0];
  };

  // Check if an option is selected
  const isSelected = (optionValue: string): boolean => {
    return selectedValues.includes(optionValue);
  };

  // Handle option selection
  const handleSelect = useCallback(
    (optionValue: string) => {
      if (multiple) {
        const newValues = isSelected(optionValue)
          ? selectedValues.filter((v) => v !== optionValue)
          : [...selectedValues, optionValue];
        onChange(newValues);
      } else {
        onChange(optionValue);
        setIsOpen(false);
      }
      setSearchQuery("");
    },
    [multiple, selectedValues, onChange, isSelected],
  );

  // Close dropdown and reset
  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setSearchQuery("");
    setHighlightedIndex(-1);
    triggerRef.current?.focus();
  }, []);

  // Toggle dropdown
  const toggleDropdown = useCallback(() => {
    if (disabled) return;

    if (isOpen) {
      closeDropdown();
    } else {
      setIsOpen(true);
      setHighlightedIndex(0);
    }
  }, [disabled, isOpen, closeDropdown]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, searchable]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, closeDropdown]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const options = listRef.current.querySelectorAll('[role="option"]');
      const highlighted = options[highlightedIndex] as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setHighlightedIndex(0);
          } else if (
            highlightedIndex >= 0 &&
            filteredOptions[highlightedIndex]
          ) {
            const option = filteredOptions[highlightedIndex];
            if (!option.disabled) {
              handleSelect(option.value);
            }
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            setHighlightedIndex(0);
          } else {
            setHighlightedIndex((prev) => {
              const next = prev + 1;
              // Skip disabled options
              let newIndex = next;
              while (
                newIndex < filteredOptions.length &&
                filteredOptions[newIndex]?.disabled
              ) {
                newIndex++;
              }
              return newIndex >= filteredOptions.length ? prev : newIndex;
            });
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (isOpen) {
            setHighlightedIndex((prev) => {
              const next = prev - 1;
              // Skip disabled options
              let newIndex = next;
              while (newIndex >= 0 && filteredOptions[newIndex]?.disabled) {
                newIndex--;
              }
              return newIndex < 0 ? prev : newIndex;
            });
          }
          break;

        case "Escape":
          e.preventDefault();
          closeDropdown();
          break;

        case "Home":
          e.preventDefault();
          if (isOpen) {
            // Find first non-disabled option
            const firstEnabled = filteredOptions.findIndex((o) => !o.disabled);
            setHighlightedIndex(firstEnabled >= 0 ? firstEnabled : 0);
          }
          break;

        case "End":
          e.preventDefault();
          if (isOpen) {
            // Find last non-disabled option
            for (let i = filteredOptions.length - 1; i >= 0; i--) {
              if (!filteredOptions[i].disabled) {
                setHighlightedIndex(i);
                break;
              }
            }
          }
          break;

        case "Tab":
          if (isOpen) {
            closeDropdown();
          }
          break;
      }
    },
    [
      disabled,
      isOpen,
      highlightedIndex,
      filteredOptions,
      handleSelect,
      closeDropdown,
    ],
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block w-full", className)}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId.current}
        aria-disabled={disabled}
        onClick={toggleDropdown}
        disabled={disabled}
        className={cn(
          // Base styles
          "w-full flex items-center justify-between gap-2",
          "rounded-xl",
          "border border-gray-300 dark:border-gray-600",
          "bg-white dark:bg-gray-800",
          "text-gray-900 dark:text-gray-100",
          "transition-all duration-150",
          // Focus
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
          // Hover
          "hover:border-gray-400 dark:hover:border-gray-500",
          // Open state
          isOpen &&
            "border-violet-500 dark:border-violet-400 ring-2 ring-violet-500/20",
          // Disabled
          disabled && "opacity-50 cursor-not-allowed",
          // Size
          triggerSizeClasses[size],
        )}
      >
        <span
          className={cn(
            "flex-1 text-left truncate",
            selectedValues.length === 0 && "text-gray-500 dark:text-gray-400",
          )}
        >
          {getDisplayText()}
        </span>
        <Icon
          name="chevron-down"
          size="sm"
          className={cn(
            "flex-shrink-0 transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            "absolute z-50 w-full mt-1",
            "bg-white dark:bg-gray-800",
            "border border-gray-200 dark:border-gray-600",
            "rounded-xl",
            "shadow-lg",
            "animate-fade-in-up",
          )}
        >
          {/* Search Input */}
          {searchable && (
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder="Search..."
                className={cn(
                  "w-full px-3 py-2",
                  "text-sm",
                  "rounded-lg",
                  "border border-gray-200 dark:border-gray-600",
                  "bg-gray-50 dark:bg-gray-700",
                  "text-gray-900 dark:text-gray-100",
                  "placeholder:text-gray-500 dark:placeholder:text-gray-400",
                  "focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500",
                )}
                aria-label="Search options"
              />
            </div>
          )}

          {/* Options List */}
          <ul
            ref={listRef}
            id={listboxId.current}
            role="listbox"
            aria-multiselectable={multiple}
            className="max-h-60 overflow-y-auto py-1"
          >
            {filteredOptions.length === 0 ? (
              <li className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                No options found
              </li>
            ) : (
              filteredOptions.map((option, index) => (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected(option.value)}
                  aria-disabled={option.disabled}
                  onClick={() => {
                    if (!option.disabled) {
                      handleSelect(option.value);
                    }
                  }}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setHighlightedIndex(index);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer",
                    "text-sm",
                    "transition-colors duration-100",
                    // Highlighted state
                    highlightedIndex === index &&
                      !option.disabled &&
                      "bg-gray-100 dark:bg-gray-700",
                    // Selected state
                    isSelected(option.value) &&
                      "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400",
                    // Disabled state
                    option.disabled &&
                      "opacity-50 cursor-not-allowed text-gray-400 dark:text-gray-500",
                  )}
                >
                  {/* Checkbox for multiple select */}
                  {multiple && (
                    <span
                      className={cn(
                        "flex-shrink-0 w-4 h-4 rounded border",
                        "flex items-center justify-center",
                        isSelected(option.value)
                          ? "bg-violet-500 border-violet-500 text-white"
                          : "border-gray-300 dark:border-gray-500",
                      )}
                    >
                      {isSelected(option.value) && (
                        <Icon name="check" size="xs" />
                      )}
                    </span>
                  )}

                  {/* Icon */}
                  {option.icon && (
                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                      {option.icon}
                    </span>
                  )}

                  {/* Label */}
                  <span className="flex-1 truncate">{option.label}</span>

                  {/* Selected indicator for single select */}
                  {!multiple && isSelected(option.value) && (
                    <Icon
                      name="check"
                      size="sm"
                      className="flex-shrink-0 text-violet-500"
                    />
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

Dropdown.displayName = "Dropdown";

export default Dropdown;
