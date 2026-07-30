import "fake-indexeddb/auto";

import Dexie from "dexie";
import { describe, expect, it } from "vitest";

import {
  FILMS_SCHEMA,
  createUserFilmRows,
  db,
  loadAllFilms,
  saveFilmsLocally,
} from "@/lib/db";
import type { FilmEvent } from "@/lib/normalize";

const film: FilmEvent = {
  uri: "letterboxd://film/shared-uri",
  title: "Shared Film",
  year: 2024,
};

describe("per-user IndexedDB contracts", () => {
  it("replaces a populated legacy database with user-scoped film identities", async () => {
    db.close();
    await Dexie.delete("lettrsuggest");
    await Dexie.delete("lettrsuggest-v2");

    const legacyDb = new Dexie("lettrsuggest");
    legacyDb.version(3).stores({
      films:
        "&uri, title, year, rating, rewatch, lastDate, liked, onWatchlist, watchCount, watchlistAddedAt",
    });
    await legacyDb.table("films").add(film);
    legacyDb.close();

    try {
      expect(db.name).toBe("lettrsuggest-v2");
      await db.open();
      expect(await db.films.count()).toBe(0);

      await saveFilmsLocally("user-a", [film]);
      await saveFilmsLocally("user-b", [film]);

      expect(await loadAllFilms("user-a")).toEqual([film]);
      expect(await loadAllFilms("user-b")).toEqual([film]);
    } finally {
      db.close();
      await Dexie.delete("lettrsuggest");
      await Dexie.delete("lettrsuggest-v2");
    }
  });

  it("uses user ID and URI as the persisted film identity", () => {
    expect(FILMS_SCHEMA).toContain("[userId+uri]");
    expect(FILMS_SCHEMA).toContain("userId");

    expect(createUserFilmRows("user-a", [film])).toEqual([
      { ...film, userId: "user-a" },
    ]);
    expect(createUserFilmRows("user-b", [film])).toEqual([
      { ...film, userId: "user-b" },
    ]);
  });

});
