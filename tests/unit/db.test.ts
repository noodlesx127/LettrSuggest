import { describe, expect, it, vi } from "vitest";

import {
  FILMS_SCHEMA_V4,
  createUserFilmRows,
  discardLegacyFilmRows,
} from "@/lib/db";
import type { FilmEvent } from "@/lib/normalize";

const film: FilmEvent = {
  uri: "letterboxd://film/shared-uri",
  title: "Shared Film",
  year: 2024,
};

describe("per-user IndexedDB contracts", () => {
  it("uses user ID and URI as the persisted film identity", () => {
    expect(FILMS_SCHEMA_V4).toContain("[userId+uri]");
    expect(FILMS_SCHEMA_V4).toContain("userId");

    expect(createUserFilmRows("user-a", [film])).toEqual([
      { ...film, userId: "user-a" },
    ]);
    expect(createUserFilmRows("user-b", [film])).toEqual([
      { ...film, userId: "user-b" },
    ]);
  });

  it("discards unowned legacy rows instead of assigning them to a user", async () => {
    const clear = vi.fn(async () => undefined);

    await discardLegacyFilmRows({ clear });

    expect(clear).toHaveBeenCalledOnce();
  });
});
