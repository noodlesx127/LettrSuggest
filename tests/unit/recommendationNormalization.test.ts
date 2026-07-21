import { describe, expect, it } from "vitest";

import {
  normalizeFilmTuples,
  selectRecentFeatures,
  selectRecentFilmsWithPinned,
} from "@/lib/recommendationNormalization";

type FilmFixture = {
  uri: string;
  tmdbId: number;
  rating: number;
  watchDate: string | null;
};

type DetailsFixture = {
  id: number;
  marker: string;
};

const films: FilmFixture[] = [
  {
    uri: "letterboxd://film/a",
    tmdbId: 101,
    rating: 5,
    watchDate: "2026-01-01",
  },
  {
    uri: "letterboxd://film/b",
    tmdbId: 202,
    rating: 4,
    watchDate: "2026-02-01",
  },
  {
    uri: "letterboxd://film/c",
    tmdbId: 303,
    rating: 3.5,
    watchDate: "2026-03-01",
  },
];

const detailsById = new Map<number, DetailsFixture | null>([
  [101, { id: 101, marker: "details-a" }],
  [202, null],
  [303, { id: 303, marker: "details-c" }],
]);

const normalize = (input: readonly FilmFixture[]) =>
  normalizeFilmTuples({
    films: input,
    getIdentity: (film) => film,
    detailsById,
    extractFeatures: (details) => ({ marker: `features-${details.id}` }),
  });

describe("normalizeFilmTuples", () => {
  it("preserves film identity when the middle details fetch fails", () => {
    const tuples = normalize(films);

    expect(tuples).toHaveLength(3);
    expect(tuples.find((tuple) => tuple.tmdbId === 101)).toMatchObject({
      uri: "letterboxd://film/a",
      rating: 5,
      watchDate: "2026-01-01",
      detailsHealth: "ok",
      details: { id: 101, marker: "details-a" },
      features: { marker: "features-101" },
    });
    expect(tuples.find((tuple) => tuple.tmdbId === 202)).toMatchObject({
      uri: "letterboxd://film/b",
      rating: 4,
      watchDate: "2026-02-01",
      detailsHealth: "failed",
      details: null,
      features: null,
    });
    expect(tuples.find((tuple) => tuple.tmdbId === 303)).toMatchObject({
      uri: "letterboxd://film/c",
      rating: 3.5,
      watchDate: "2026-03-01",
      detailsHealth: "ok",
      details: { id: 303, marker: "details-c" },
      features: { marker: "features-303" },
    });
  });

  it("sorts recent films independently of input order", () => {
    const shuffled = [films[2], films[0], films[1]];

    expect(normalize(films).map((tuple) => tuple.tmdbId)).toEqual([
      303, 202, 101,
    ]);
    expect(normalize(shuffled).map((tuple) => tuple.tmdbId)).toEqual([
      303, 202, 101,
    ]);
  });

  it("uses TMDB ID as the tie-breaker and places invalid dates last", () => {
    const sameDate = films.map((film) => ({
      ...film,
      watchDate:
        film.tmdbId === 202 ? "not-a-date" : "2026-04-01T00:00:00Z",
    }));

    expect(normalize(sameDate).map((tuple) => tuple.tmdbId)).toEqual([
      101, 303, 202,
    ]);
    expect(
      normalize([sameDate[2], sameDate[1], sameDate[0]]).map(
        (tuple) => tuple.tmdbId,
      ),
    ).toEqual([101, 303, 202]);
  });

  it("applies the recency window before skipping failed details", () => {
    const tuples = normalize(films);

    expect(selectRecentFeatures(tuples, 2)).toEqual([
      { marker: "features-303" },
    ]);
  });

  it("counts distinct films in the recent feature window", () => {
    const duplicateNewest = {
      ...films[2],
      uri: "letterboxd://film/c-positive-feedback",
    };
    const tuples = normalize([films[2], duplicateNewest, films[0]]);

    expect(selectRecentFeatures(tuples, 2)).toEqual([
      { marker: "features-303" },
      { marker: "features-101" },
    ]);
  });

  it("reserves capped history space for explicit feedback", () => {
    const pinned = {
      uri: "tmdb:404",
      tmdbId: 404,
      rating: 0,
      watchDate: null,
    };

    expect(
      selectRecentFilmsWithPinned({
        films,
        pinned: [pinned],
        limit: 2,
        getIdentity: (film) => film,
      }).map((film) => film.tmdbId),
    ).toEqual([303, 404]);
  });

  it("does not discard explicit feedback when it exceeds the history cap", () => {
    const pinned = [404, 505, 606].map((tmdbId) => ({
      uri: `tmdb:${tmdbId}`,
      tmdbId,
      rating: 0,
      watchDate: null,
    }));

    expect(
      selectRecentFilmsWithPinned({
        films,
        pinned,
        limit: 2,
        getIdentity: (film) => film,
      }).map((film) => film.tmdbId),
    ).toEqual([404, 505, 606]);
  });

  it("fans one details result back to duplicate film events", () => {
    const duplicate = { ...films[0], uri: "letterboxd://film/a-rewatch" };

    expect(
      normalizeFilmTuples({
        films: [films[0], duplicate],
        getIdentity: (film) => film,
        detailsById,
        extractFeatures: (details) => ({ marker: `features-${details.id}` }),
      }).map((tuple) => tuple.features),
    ).toEqual([
      { marker: "features-101" },
      { marker: "features-101" },
    ]);
  });
});
