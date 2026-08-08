/**
 * Ambient declaration for the `server-only` marker module. The real guard is
 * enforced by the bundler at build time; TypeScript only needs the module to
 * exist for side-effect imports.
 */
declare module "server-only";
