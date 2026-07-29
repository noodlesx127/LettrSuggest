import Dexie, { type Table } from 'dexie';
import type { FilmEvent } from '@/lib/normalize';

export interface FilmRow extends FilmEvent {
  userId: string;
}

export const FILMS_SCHEMA_V4 =
  '[userId+uri], userId, uri, title, year, rating, rewatch, lastDate, liked, onWatchlist, watchCount, watchlistAddedAt';

export function createUserFilmRows(userId: string, films: FilmEvent[]): FilmRow[] {
  return films.map((film) => ({ ...film, userId }));
}

export async function discardLegacyFilmRows(table: {
  clear: () => PromiseLike<unknown>;
}): Promise<void> {
  await table.clear();
}

class LettrDB extends Dexie {
  films!: Table<FilmRow, [string, string]>; // compound key: userId + uri

  constructor() {
    super('lettrsuggest');
    this.version(1).stores({
      films: '&uri, title, year, rating, rewatch, lastDate, liked, onWatchlist'
    });
    // Add watchCount index in version 2
    this.version(2).stores({
      films: '&uri, title, year, rating, rewatch, lastDate, liked, onWatchlist, watchCount'
    });
    // Add watchlistAddedAt for intent recency in version 3
    this.version(3).stores({
      films: '&uri, title, year, rating, rewatch, lastDate, liked, onWatchlist, watchCount, watchlistAddedAt'
    });
    // Scope persisted rows by user. Existing global rows are intentionally
    // discarded during the schema upgrade rather than assigned to any user.
    this.version(4)
      .stores({
        films: FILMS_SCHEMA_V4
      })
      .upgrade((tx) => discardLegacyFilmRows(tx.table('films')));
  }
}

export const db = new LettrDB();

function assertUserId(userId: string): void {
  if (!userId.trim()) throw new Error('A user ID is required for local film persistence');
}

export async function saveFilmsLocally(userId: string, films: FilmEvent[]) {
  assertUserId(userId);
  // Use the compound key so one user's URI cannot overwrite another user's row.
  await db.films.bulkPut(createUserFilmRows(userId, films));
}

export async function loadAllFilms(userId: string): Promise<FilmEvent[]> {
  assertUserId(userId);
  const rows = await db.films.where('userId').equals(userId).toArray();
  return rows.map(({ userId: _userId, ...film }) => film);
}

export async function clearFilmsLocally(userId: string): Promise<void> {
  assertUserId(userId);
  await db.films.where('userId').equals(userId).delete();
}
