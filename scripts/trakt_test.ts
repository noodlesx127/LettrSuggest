import * as fs from 'fs';
import * as path from 'path';

// Parse .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.replace(/\r/g, '').split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) { process.env[m[1].trim()] = m[2].trim(); }
  });
}

async function main() {
  const key = process.env.TRAKT_CLIENT_ID;
  if (!key) { console.log('TRAKT_CLIENT_ID not set'); return; }

  const headers: Record<string, string> = {
    'trakt-api-key': key,
    'trakt-api-version': '2',
    'Content-Type': 'application/json'
  };

  // Test 1: Raw TMDB ID 27205 (Inception) — this is what the route currently does
  console.log('=== Test 1: /movies/27205/related (raw TMDB ID) ===');
  try {
    const r1 = await fetch('https://api.trakt.tv/movies/27205/related?limit=3', { headers });
    console.log('HTTP status:', r1.status, r1.statusText);
    if (r1.ok) {
      const d1 = await r1.json();
      console.log('Results count:', d1.length);
      console.log('First 3:', d1.slice(0, 3).map((m: any) => `${m.title} (tmdb:${m.ids?.tmdb})`));
    } else {
      console.log('Error:', (await r1.text()).slice(0, 300));
    }
  } catch (e: any) { console.log('Exception:', e.message); }

  // Test 2: Trakt slug — the correct approach
  console.log('\n=== Test 2: /movies/inception-2010/related (Trakt slug) ===');
  try {
    const r2 = await fetch('https://api.trakt.tv/movies/inception-2010/related?limit=3', { headers });
    console.log('HTTP status:', r2.status, r2.statusText);
    if (r2.ok) {
      const d2 = await r2.json();
      console.log('Results count:', d2.length);
      console.log('First 3:', d2.slice(0, 3).map((m: any) => `${m.title} (tmdb:${m.ids?.tmdb})`));
    }
  } catch (e: any) { console.log('Exception:', e.message); }

  // Test 3: Lookup via /search/tmdb/{tmdb_id}
  console.log('\n=== Test 3: /search/tmdb/27205 (lookup TMDB->Trakt) ===');
  try {
    const r3 = await fetch('https://api.trakt.tv/search/tmdb/27205?type=movie', { headers });
    console.log('HTTP status:', r3.status, r3.statusText);
    if (r3.ok) {
      const d3 = await r3.json();
      const movie = d3[0]?.movie;
      console.log('Title:', movie?.title, 'Slug:', movie?.ids?.slug, 'Trakt ID:', movie?.ids?.trakt);
    }
  } catch (e: any) { console.log('Exception:', e.message); }
}

main();
