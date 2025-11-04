import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import fetch from 'node-fetch';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');

export const enrich = onRequest({ secrets: [TMDB_API_KEY], region: 'us-central1' }, async (req, res) => {
  // Example: GET /?title=Heat&year=1995
  const title = String(req.query.title || '');
  const year = req.query.year ? Number(req.query.year) : undefined;
  if (!title) {
    res.status(400).json({ error: 'Missing title' });
    return;
  }
  const apiKey = TMDB_API_KEY.value();
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', title);
  if (year) url.searchParams.set('year', String(year));
  const r = await fetch(url.toString());
  const json = await r.json();
  res.json({ ok: true, results: json?.results ?? [] });
});
