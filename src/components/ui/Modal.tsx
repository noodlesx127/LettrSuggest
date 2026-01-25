"use client";

import {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

// ============================================================================
// MODAL COMPONENT - Core Design System Overlay
// Accessible dialog with focus trap, ESC close, and portal rendering
// ============================================================================

export interface ModalProps {
  /** Controls modal visibility */
  isOpen: boolean;
  /** Callback when modal requests close */
  onClose: () => void;
  /** Modal title (optional) */
  title?: string;
  /** Description text below title (optional) */
  description?: string;
  /** Size of the modal */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Modal content */
  children: ReactNode;
  /** Show close button in header (default: true) */
  showCloseButton?: boolean;
  /** Close on overlay/backdrop click (default: true) */
  closeOnOverlayClick?: boolean;
  /** Close on ESC key (default: true) */
  closeOnEsc?: boolean;
  /** Additional class for modal panel */
  className?: string;
}

// Size mapping for max-width
const sizeClasses = {
  sm: "max-w-md", // 448px
  md: "max-w-lg", // 512px
  lg: "max-w-2xl", // 672px
  xl: "max-w-4xl", // 896px
  full: "max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]",
};

/**
 * Modal component with accessibility features.
 * Uses React Portal to render at document root.
 *
 * @example
 * ```tsx
 * <Modal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="Confirm Action"
 *   description="Are you sure you want to proceed?"
 *   size="md"
 * >
 *   <div className="space-y-4">
 *     <p>This action cannot be undone.</p>
 *     <div className="flex gap-3 justify-end">
 *       <Button variant="secondary" onClick={() => setIsOpen(false)}>
 *         Cancel
 *       </Button>
 *       <Button variant="danger" onClick={handleConfirm}>
 *         Confirm
 *       </Button>
 *     </div>
 *   </div>
 * </Modal>
 * ```
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size = "md",
  children,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  className,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  const descId = useRef(`modal-desc-${Math.random().toString(36).slice(2)}`);

  // Focus trap - keep focus within modal
  const handleFocusTrap = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;

    const focusableElements = modalRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    if (!focusableElements || focusableElements.length === 0) return;

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement;

    if (e.shiftKey) {
      // Shift + Tab: go backwards
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab: go forwards
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }, []);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const handleEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, closeOnEsc, onClose]);

  // Manage focus and body scroll
  useEffect(() => {
    if (isOpen) {
      // Store currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Prevent body scroll
      document.body.style.overflow = "hidden";

      // Focus first focusable element in modal
      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusableElements && focusableElements.length > 0) {
        (focusableElements[0] as HTMLElement)?.focus();
      }
    } else {
      // Restore body scroll
      document.body.style.overflow = "";

      // Return focus to previous element
      previousActiveElement.current?.focus();
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (closeOnOverlayClick && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose],
  );

  // Don't render if not open
  if (!isOpen) return null;

  // SSR check - only render portal on client
  if (typeof window === "undefined") return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      {/* Backdrop/Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 backdrop-blur-sm",
          "animate-fade-in-up",
        )}
        aria-hidden="true"
        onClick={handleOverlayClick}
      />

      {/* Modal Panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId.current : undefined}
        aria-describedby={description ? descId.current : undefined}
        onKeyDown={handleFocusTrap}
        className={cn(
          // Base styles
          "relative w-full",
          // Background and border
          "bg-white dark:bg-gray-800",
          "rounded-2xl",
          "shadow-2xl",
          // Animation
          "animate-slide-up",
          // Size
          sizeClasses[size],
          // Full screen mode adjustments
          size === "full" && "h-full flex flex-col",
          className,
        )}
      >
        {/* Header - if title or close button */}
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between gap-4 p-6 pb-0">
            {/* Title & Description */}
            {title && (
              <div className="flex-1 min-w-0">
                <h2
                  id={titleId.current}
                  className="text-xl font-semibold text-gray-900 dark:text-gray-100"
                >
                  {title}
                </h2>
                {description && (
                  <p
                    id={descId.current}
                    className="mt-1 text-sm text-gray-600 dark:text-gray-400"
                  >
                    {description}
                  </p>
                )}
              </div>
            )}

            {/* Close Button */}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  "flex-shrink-0",
                  "p-2 -m-2",
                  "rounded-xl",
                  "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300",
                  "hover:bg-gray-100 dark:hover:bg-gray-700",
                  "transition-colors duration-150",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
                )}
                aria-label="Close modal"
              >
                <Icon name="close" size="md" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className={cn("p-6", size === "full" && "flex-1 overflow-auto")}>
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

Modal.displayName = "Modal";

export default Modal;
