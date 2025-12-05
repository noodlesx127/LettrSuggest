import Dexie, { type Table } from 'dexie';
import type { FilmEvent } from '@/lib/normalize';

export interface FilmRow extends FilmEvent {}

class LettrDB extends Dexie {
  films!: Table<FilmRow, string>; // key: uri

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
  }
}

export const db = new LettrDB();

export async function saveFilmsLocally(films: FilmEvent[]) {
  // Use bulkPut to upsert by primary key (uri)
  await db.films.bulkPut(films);
}

export async function loadAllFilms(): Promise<FilmEvent[]> {
  return db.films.toArray();
}
