import Dexie, { type Table } from 'dexie';
import type { FilmEvent } from '@/lib/normalize';

export interface FilmRow extends FilmEvent {
  userId: string;
}

export const FILMS_SCHEMA =
  '[userId+uri], userId, uri, title, year, rating, rewatch, lastDate, liked, onWatchlist, watchCount, watchlistAddedAt';

const DATABASE_NAME = 'lettrsuggest-v2';
const LEGACY_DATABASE_NAME = 'lettrsuggest';

export function createUserFilmRows(userId: string, films: FilmEvent[]): FilmRow[] {
  return films.map((film) => ({ ...film, userId }));
}

class LettrDB extends Dexie {
  films!: Table<FilmRow, [string, string]>; // compound key: userId + uri

  constructor() {
    super(DATABASE_NAME);
    this.version(1).stores({ films: FILMS_SCHEMA });
  }
}

export const db = new LettrDB();

if (typeof indexedDB !== 'undefined') {
  // The old database cannot change primary keys in place and contains only a
  // replaceable cache. Cleanup must not delay opening the replacement cache.
  void Dexie.delete(LEGACY_DATABASE_NAME).catch((error) => {
    console.warn('[Import] Could not remove legacy local database:', error);
  });
}

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
