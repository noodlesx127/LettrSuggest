import React from "react";
import { cn } from "@/lib/cn";

interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
  children: React.ReactNode;
}

/**
 * Display text - Large hero text (3rem)
 * Use for landing page headers and major section heroes
 *
 * @example
 * <Display>Welcome to LettrSuggest</Display>
 */
export function Display({
  as: Component = "h1",
  className,
  children,
  ...props
}: TypographyProps) {
  return (
    <Component className={cn("text-display font-bold", className)} {...props}>
      {children}
    </Component>
  );
}

/**
 * Heading component with level variants
 *
 * @example
 * <Heading level={1}>Page Title</Heading>
 * <Heading level={2}>Section Header</Heading>
 * <Heading level={3}>Card Header</Heading>
 */
interface HeadingProps extends TypographyProps {
  level?: 1 | 2 | 3;
}

export function Heading({
  level = 1,
  as,
  className,
  children,
  ...props
}: HeadingProps) {
  const Component = as || (`h${level}` as React.ElementType);

  const styles = {
    1: "text-h1 font-bold",
    2: "text-h2 font-semibold",
    3: "text-h3 font-semibold",
  };

  return (
    <Component className={cn(styles[level], className)} {...props}>
      {children}
    </Component>
  );
}

/**
 * Body text - Standard paragraph text (0.875rem)
 *
 * @example
 * <Body>This is standard paragraph text used throughout the application.</Body>
 */
export function Body({
  as: Component = "p",
  className,
  children,
  ...props
}: TypographyProps) {
  return (
    <Component className={cn("text-body", className)} {...props}>
      {children}
    </Component>
  );
}

/**
 * Caption text - Small labels and metadata (0.75rem)
 *
 * @example
 * <Caption>Posted 2 hours ago</Caption>
 */
export function Caption({
  as: Component = "span",
  className,
  children,
  ...props
}: TypographyProps) {
  return (
    <Component
      className={cn("text-caption text-gray-600 dark:text-gray-400", className)}
      {...props}
    >
      {children}
    </Component>
  );
}

/**
 * MovieTitle - Serif font for movie titles
 * Crimson Pro font gives movie titles a classic, cinematic feel
 *
 * @example
 * <MovieTitle>The Shawshank Redemption</MovieTitle>
 */
export function MovieTitle({
  as: Component = "h2",
  className,
  children,
  ...props
}: TypographyProps) {
  return (
    <Component
      className={cn("font-serif text-h2 font-semibold", className)}
      {...props}
    >
      {children}
    </Component>
  );
}
