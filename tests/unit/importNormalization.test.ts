import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: supabaseMock }));

import {
  normalizeData,
  normalizeWatchEvents,
  serializeFilmEventsForCloud,
} from "@/lib/normalize";
import { serializeWatchEvents, upsertDiaryEvents } from "@/lib/diary";

type ImportRow = Record<string, string>;

const filmUri = "https://letterboxd.com/film/example-film/";
const secondFilmUri = "https://letterboxd.com/film/second-film/";
const thirdFilmUri = "https://letterboxd.com/film/third-film/";

function row(
  uri: string,
  values: Partial<Record<string, string>> = {},
): ImportRow {
  return {
    "Letterboxd URI": uri,
    Name: "Example Film",
    Year: "2020",
    Rating: "",
    Rewatch: "No",
    ...values,
  };
}

describe("import normalization", () => {
  it("normalizes blank years to null while retaining valid numeric years", () => {
    const { films } = normalizeData({
      watched: [
        row(filmUri, { Year: "   " }),
        row(secondFilmUri, { Name: "Second Film", Year: " 1999 " }),
      ],
    });

    expect(films).toEqual([
      expect.objectContaining({ uri: filmUri, year: null }),
      expect.objectContaining({ uri: secondFilmUri, year: 1999 }),
    ]);
  });

  it("round-trips watchlist_added_at through film event cloud serialization", () => {
    const watchlistAddedAt = "2026-07-01T12:34:56.000Z";
    const { films } = normalizeData({
      watchlist: [
        row(filmUri, {
          Name: "Example Film",
          Year: "2020",
          Date: watchlistAddedAt,
        }),
      ],
    });

    expect(films[0]).toMatchObject({
      uri: filmUri,
      watchlistAddedAt,
      onWatchlist: true,
    });
    expect(serializeFilmEventsForCloud("user-1", films)).toEqual([
      {
        user_id: "user-1",
        uri: filmUri,
        title: "Example Film",
        year: 2020,
        rating: null,
        rewatch: false,
        last_date: null,
        watch_count: 0,
        liked: false,
        on_watchlist: true,
        watchlist_added_at: watchlistAddedAt,
      },
    ]);
  });

  it("deduplicates diary and review events by the persisted identity", () => {
    const diaryEvent = row(filmUri, {
      Name: "Example Film",
      "Watched Date": "2024-01-02",
      Rating: "5",
    });
    const reviewDuplicate = row(filmUri, {
      Name: "Example Film",
      "Watched Date": "2024-01-02",
      Rating: "4.5",
    });
    const nullDateDiary = row(secondFilmUri, {
      Name: "Second Film",
      "Watched Date": "   ",
      Rating: "",
    });
    const nullDateReview = row(secondFilmUri, {
      Name: "Second Film",
      Date: "   ",
      Rating: "3.5",
    });
    const diaryOnlyRating = row(thirdFilmUri, {
      Name: "Third Film",
      "Watched Date": "2024-03-01",
      Rating: "3.25",
    });
    const reviewWithoutRating = row(thirdFilmUri, {
      Name: "Third Film",
      "Watched Date": "2024-03-01",
      Rating: "",
    });
    const secondWatchReview = row(secondFilmUri, {
      Name: "Second Film",
      "Watched Date": "2024-05-01",
      Rewatch: "Yes",
      Rating: "",
    });

    const normalized = normalizeData({
      diary: [diaryEvent, nullDateDiary, diaryOnlyRating],
      reviews: [
        reviewDuplicate,
        nullDateReview,
        secondWatchReview,
        reviewWithoutRating,
      ],
    });
    const reordered = normalizeData({
      diary: [diaryOnlyRating, nullDateDiary, diaryEvent],
      reviews: [
        reviewWithoutRating,
        secondWatchReview,
        nullDateReview,
        reviewDuplicate,
      ],
    });

    expect(normalized.watchEvents).toEqual(reordered.watchEvents);
    expect(normalized.watchEvents).toEqual([
      {
        uri: filmUri,
        watchedDate: "2024-01-02",
        rating: 4.5,
        rewatch: false,
      },
      {
        uri: secondFilmUri,
        watchedDate: null,
        rating: 3.5,
        rewatch: false,
      },
      {
        uri: secondFilmUri,
        watchedDate: "2024-05-01",
        rating: null,
        rewatch: true,
      },
      {
        uri: thirdFilmUri,
        watchedDate: "2024-03-01",
        rating: 3.25,
        rewatch: false,
      },
    ]);

    expect(serializeWatchEvents("user-1", normalized.watchEvents)).toEqual([
      {
        user_id: "user-1",
        uri: filmUri,
        watched_date: "2024-01-02",
        rating: 4.5,
        rewatch: false,
      },
      {
        user_id: "user-1",
        uri: secondFilmUri,
        watched_date: null,
        rating: 3.5,
        rewatch: false,
      },
      {
        user_id: "user-1",
        uri: secondFilmUri,
        watched_date: "2024-05-01",
        rating: null,
        rewatch: true,
      },
      {
        user_id: "user-1",
        uri: thirdFilmUri,
        watched_date: "2024-03-01",
        rating: 3.25,
        rewatch: false,
      },
    ]);

    expect(normalized.films).toEqual([
      expect.objectContaining({
        uri: filmUri,
        watchCount: 1,
        rewatch: false,
        lastDate: "2024-01-02",
        rating: 4.5,
      }),
      expect.objectContaining({
        uri: secondFilmUri,
        watchCount: 2,
        rewatch: true,
        lastDate: "2024-05-01",
        rating: 3.5,
      }),
      expect.objectContaining({
        uri: thirdFilmUri,
        watchCount: 1,
        rewatch: false,
        lastDate: "2024-03-01",
        rating: 3.25,
      }),
    ]);
  });

  it("keeps film rating precedence separate from sorted event ratings", () => {
    const normalized = normalizeData({
      diary: [
        row(filmUri, { "Watched Date": "2024-02-01", Rating: "2" }),
        row(filmUri, { "Watched Date": "2024-01-01", Rating: "4" }),
      ],
      ratings: [row(filmUri, { Rating: "5" })],
    });

    expect(normalized.watchEvents.map((event) => event.rating)).toEqual([4, 2]);
    expect(normalized.films[0]).toMatchObject({ rating: 5, watchCount: 2 });

    const withoutRatingsCsv = normalizeData({
      diary: [
        row(filmUri, { "Watched Date": "2024-02-01", Rating: "2" }),
        row(filmUri, { "Watched Date": "2024-01-01", Rating: "4" }),
      ],
    });
    expect(withoutRatingsCsv.films[0]).toMatchObject({ rating: 4 });
  });

  it("sorts watch events by locale-independent code-unit order", () => {
    const uppercaseUri = "https://letterboxd.com/film/Z-film/";
    const lowercaseUri = "https://letterboxd.com/film/a-film/";

    expect(
      normalizeWatchEvents({
        diary: [
          row(lowercaseUri, { "Watched Date": "2024-01-01" }),
          row(uppercaseUri, { "Watched Date": "2024-01-01" }),
        ],
      }).map((event) => event.uri),
    ).toEqual([uppercaseUri, lowercaseUri]);
  });

  it("normalizes malformed watchlist timestamps to null without changing valid text", () => {
    const validTimestamp = "2026-07-01T12:34:56+02:00";
    const { films } = normalizeData({
      watchlist: [
        row(filmUri, { Date: validTimestamp }),
        row(secondFilmUri, { Date: "not-a-timestamp" }),
      ],
    });

    expect(films).toEqual([
      expect.objectContaining({
        uri: filmUri,
        watchlistAddedAt: validTimestamp,
      }),
      expect.objectContaining({
        uri: secondFilmUri,
        watchlistAddedAt: null,
      }),
    ]);
    expect(serializeFilmEventsForCloud("user-1", films)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: secondFilmUri,
          watchlist_added_at: null,
        }),
      ]),
    );
  });

  it("updates an existing persisted watch event with the normalized merged rating", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    supabaseMock.from.mockReturnValue({ upsert });
    const mergedRow = {
      user_id: "user-1",
      uri: filmUri,
      watched_date: "2024-01-02",
      rating: 4.5,
      rewatch: false,
    };

    await upsertDiaryEvents([mergedRow]);

    expect(supabaseMock.from).toHaveBeenCalledWith("film_diary_events_raw");
    const [persistedRows, options] = upsert.mock.calls[0] as [
      typeof mergedRow[],
      { ignoreDuplicates?: boolean; onConflict: string },
    ];
    expect(persistedRows).toEqual([mergedRow]);
    expect(options.onConflict).toBe(
      "user_id,uri,watched_date,rewatch",
    );
    expect(options.ignoreDuplicates ?? false).toBe(false);
  });

  it("rejects invalid ISO calendar dates while accepting date-only ISO values", () => {
    const dateOnlyFilmUri = "https://letterboxd.com/film/date-only-film/";
    const invalidFebruaryUri =
      "https://letterboxd.com/film/invalid-february-film/";
    const invalidAprilUri = "https://letterboxd.com/film/invalid-april-film/";
    const { films } = normalizeData({
      watchlist: [
        row(dateOnlyFilmUri, { Date: "2026-07-01" }),
        row(invalidFebruaryUri, { Date: "2026-02-30T12:00:00Z" }),
        row(invalidAprilUri, { Date: "2026-04-31T00:00:00+02:00" }),
      ],
    });
    const filmsByUri = new Map(films.map((film) => [film.uri, film]));

    expect(filmsByUri.get(dateOnlyFilmUri)).toMatchObject({
      watchlistAddedAt: "2026-07-01",
    });
    expect(filmsByUri.get(invalidFebruaryUri)).toMatchObject({
      watchlistAddedAt: null,
    });
    expect(filmsByUri.get(invalidAprilUri)).toMatchObject({
      watchlistAddedAt: null,
    });
  });

  it("keeps the watchlist column migration forward-only and PostgREST-aware", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../../supabase/migrations/20260729100000_add_watchlist_added_at_to_film_events.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /alter table public\.film_events[\s\S]*add column if not exists watchlist_added_at\s+timestamptz/i,
    );
    expect(migration).toMatch(/comment on column public\.film_events\.watchlist_added_at/i);
    expect(migration).toMatch(/notify pgrst, ['"]reload schema['"]/i);
  });
});
