/**
 * Required post-import work seam.
 *
 * Seeding feature preferences and learning from historical data are not
 * optional polish: a successful snapshot reconciliation must be followed by both
 * steps before the import can be reported complete. Failures here are therefore
 * fatal and propagated to the caller rather than swallowed, and seeding must
 * finish before learning starts.
 */

export type RequiredPostImportWorkInput = {
  /** Whether an authenticated Supabase client is available for the post-work. */
  hasSupabase: boolean;
  /** Seed feature preferences from the reconciled watch history. */
  seedPreferences: () => Promise<unknown>;
  /** Learn genre/transition models from historical data. */
  learnFromHistory: () => Promise<unknown>;
};

/**
 * Run the required post-import steps in order, failing closed. Throws when
 * Supabase is absent, and propagates any seeding or learning failure so the
 * caller cannot treat the import as complete. Resolves only when both steps
 * succeed, seeding before learning.
 */
export async function runRequiredPostImportWork(
  input: RequiredPostImportWorkInput,
): Promise<void> {
  if (!input.hasSupabase) {
    throw new Error("Supabase is required to complete post-import work");
  }

  // Seed first; learning depends on the seeded preferences and must not run if
  // seeding fails.
  await input.seedPreferences();
  await input.learnFromHistory();
}
