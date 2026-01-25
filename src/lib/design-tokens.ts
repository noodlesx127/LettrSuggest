/**
 * Design Tokens for LettrSuggest
 * Central source of truth for colors, typography, spacing, and other design values
 */

// Color System
export const colors = {
  brand: {
    50: "#faf5ff",
    100: "#f3e8ff",
    200: "#e9d5ff",
    300: "#d8b4fe",
    400: "#c084fc",
    500: "#a855f7",
    600: "#9333ea",
    700: "#7e22ce",
    800: "#6b21a8",
    900: "#581c87",
    DEFAULT: "#a855f7",
  },
  success: {
    light: "#10b981",
    DEFAULT: "#059669",
    dark: "#047857",
  },
  warning: {
    light: "#f59e0b",
    DEFAULT: "#d97706",
    dark: "#b45309",
  },
  danger: {
    light: "#ef4444",
    DEFAULT: "#dc2626",
    dark: "#b91c1c",
  },
  info: {
    light: "#3b82f6",
    DEFAULT: "#2563eb",
    dark: "#1d4ed8",
  },
} as const;

// Typography Scale
export const typography = {
  display: {
    size: "3rem",
    lineHeight: "1.1",
    letterSpacing: "-0.02em",
    weight: "700",
  },
  h1: {
    size: "1.875rem",
    lineHeight: "1.2",
    letterSpacing: "-0.01em",
    weight: "700",
  },
  h2: {
    size: "1.25rem",
    lineHeight: "1.3",
    letterSpacing: "0",
    weight: "600",
  },
  h3: {
    size: "1rem",
    lineHeight: "1.4",
    letterSpacing: "0",
    weight: "600",
  },
  body: {
    size: "0.875rem",
    lineHeight: "1.5",
    letterSpacing: "0",
    weight: "400",
  },
  caption: {
    size: "0.75rem",
    lineHeight: "1.4",
    letterSpacing: "0.01em",
    weight: "500",
  },
} as const;

// Spacing Scale (4px base)
export const spacing = {
  xs: "0.25rem", // 4px
  sm: "0.5rem", // 8px
  md: "0.75rem", // 12px
  lg: "1rem", // 16px
  xl: "1.5rem", // 24px
  "2xl": "2rem", // 32px
  "3xl": "3rem", // 48px
} as const;

// Border Radius
export const borderRadius = {
  sm: "0.375rem", // 6px
  md: "0.5rem", // 8px
  lg: "0.75rem", // 12px
  xl: "1rem", // 16px
  "2xl": "1.5rem", // 24px
  full: "9999px",
} as const;

// Shadows
export const shadows = {
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
  "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
  brand: "0 10px 15px -3px rgba(168, 85, 247, 0.3)",
  "brand-lg": "0 20px 25px -5px rgba(168, 85, 247, 0.3)",
} as const;

// Type exports for TypeScript
export type ColorScale = typeof colors;
export type TypographyScale = typeof typography;
export type SpacingScale = typeof spacing;
export type BorderRadiusScale = typeof borderRadius;
export type ShadowScale = typeof shadows;
