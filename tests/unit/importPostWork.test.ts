import { describe, expect, it, vi } from "vitest";

import { runRequiredPostImportWork } from "@/lib/importPostWork";

describe("runRequiredPostImportWork (post-import failures are fatal)", () => {
  it("throws rather than completing when Supabase is absent", async () => {
    const seedPreferences = vi.fn();
    const learnFromHistory = vi.fn();

    await expect(
      runRequiredPostImportWork({
        hasSupabase: false,
        seedPreferences,
        learnFromHistory,
      }),
    ).rejects.toThrow(/supabase is required/i);

    expect(seedPreferences).not.toHaveBeenCalled();
    expect(learnFromHistory).not.toHaveBeenCalled();
  });

  it("propagates a seedPreferences failure instead of swallowing it", async () => {
    const seedPreferences = vi.fn().mockRejectedValue(new Error("seed boom"));
    const learnFromHistory = vi.fn();

    await expect(
      runRequiredPostImportWork({
        hasSupabase: true,
        seedPreferences,
        learnFromHistory,
      }),
    ).rejects.toThrow(/seed boom/);

    // Learning must not run once seeding has failed.
    expect(learnFromHistory).not.toHaveBeenCalled();
  });

  it("propagates a learnFromHistory failure instead of swallowing it", async () => {
    const seedPreferences = vi.fn().mockResolvedValue(undefined);
    const learnFromHistory = vi.fn().mockRejectedValue(new Error("learn boom"));

    await expect(
      runRequiredPostImportWork({
        hasSupabase: true,
        seedPreferences,
        learnFromHistory,
      }),
    ).rejects.toThrow(/learn boom/);
  });

  it("completes only when both required steps succeed, in order", async () => {
    const order: string[] = [];
    const seedPreferences = vi.fn(async () => {
      order.push("seed");
    });
    const learnFromHistory = vi.fn(async () => {
      order.push("learn");
    });

    await expect(
      runRequiredPostImportWork({
        hasSupabase: true,
        seedPreferences,
        learnFromHistory,
      }),
    ).resolves.toBeUndefined();

    expect(seedPreferences).toHaveBeenCalledTimes(1);
    expect(learnFromHistory).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["seed", "learn"]);
  });
});
