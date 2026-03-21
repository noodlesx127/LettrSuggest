import type { ReactNode } from "react";

/**
 * Admin-specific layout: overrides the root layout's `max-w-6xl` main wrapper
 * by rendering children directly without a constraining container.
 * The admin page manages its own max-width (max-w-[1600px]).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
