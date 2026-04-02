import * as fs from 'fs';
import * as path from 'path';

// Parse .env.local manually (strip \r for Windows)
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.replace(/\r/g, '').split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const results: Array<{ api: string; status: string; detail: string }> = [];

function log(api: string, ok: boolean, detail: string) {
    const icon = ok ? 'PASS' : 'FAIL';
    results.push({ api, status: icon, detail });
    console.log(`${ok ? '✅' : '❌'} [${api.padEnd(10)}] ${detail}`);
}

// ── TMDB ──────────────────────────────────────────
async function testTMDB() {
    const key = process.env.TMDB_API_KEY;
    if (!key) return log('TMDB', false, 'TMDB_API_KEY not set');
    try {
        // Search endpoint
        const searchRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${key}&query=Inception`);
        if (!searchRes.ok) throw new Error(`Search HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        const count = searchData.results?.length ?? 0;

        // Movie detail endpoint (Inception = 27205)
        const detailRes = await fetch(`https://api.themoviedb.org/3/movie/27205?api_key=${key}&append_to_response=credits,keywords,similar,recommendations`);
        if (!detailRes.ok) throw new Error(`Detail HTTP ${detailRes.status}`);
        const detail = await detailRes.json();
        const simCount = detail.similar?.results?.length ?? 0;
        const recCount = detail.recommendations?.results?.length ?? 0;

        log('TMDB', true, `Search: ${count} results | Similar: ${simCount} | Recs: ${recCount}`);
    } catch (e: any) {
        log('TMDB', false, e.message);
    }
}

// ── TuiMDB ────────────────────────────────────────
async function testTuiMDB() {
    const key = process.env.TUIMDB_API_KEY;
    if (!key) return log('TuiMDB', false, 'TUIMDB_API_KEY not set');
    try {
        const res = await fetch(`https://tuimdb.com/api/movies/search/?queryString=The+Dark+Knight&language=en`, {
            headers: { 'apiKey': key, 'Accept': 'application/json' }
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${text.slice(0, 100)}`);
        }
        const data = await res.json();
        const count = data.results?.length ?? 0;
        log('TuiMDB', true, `Search: ${count} results for 'The Dark Knight'`);
    } catch (e: any) {
        log('TuiMDB', false, e.message);
    }
}

// ── TasteDive ─────────────────────────────────────
async function testTasteDive() {
    const key = process.env.TASTEDIVE_API_KEY;
    if (!key) return log('TasteDive', false, 'TASTEDIVE_API_KEY not set');
    try {
        const res = await fetch(`https://tastedive.com/api/similar?q=Inception&type=movie&k=${key}&limit=5`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const similar = data.Similar || data.similar;
        const results = similar?.Results || similar?.results || [];
        const names = results.slice(0, 3).map((r: any) => r.Name || r.name).join(', ');
        log('TasteDive', true, `Found ${results.length} similar | Sample: ${names}`);
    } catch (e: any) {
        log('TasteDive', false, e.message);
    }
}

// ── Watchmode ─────────────────────────────────────
async function testWatchmode() {
    const key = process.env.WATCHMODE_API_KEY;
    if (!key) return log('Watchmode', false, 'WATCHMODE_API_KEY not set');
    try {
        // Search endpoint
        const searchRes = await fetch(`https://api.watchmode.com/v1/search/?apiKey=${key}&search_field=name&search_value=Inception`);
        if (!searchRes.ok) throw new Error(`Search HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        const searchCount = searchData.title_results?.length ?? 0;

        // Trending endpoint
        const trendRes = await fetch(`https://api.watchmode.com/v1/list-titles/?apiKey=${key}&limit=5&types=movie`);
        if (!trendRes.ok) throw new Error(`Trending HTTP ${trendRes.status}`);
        const trendData = await trendRes.json();
        const trendCount = trendData.titles?.length ?? 0;

        log('Watchmode', true, `Search: ${searchCount} results | Trending: ${trendCount} titles`);
    } catch (e: any) {
        log('Watchmode', false, e.message);
    }
}

// ── Run all ───────────────────────────────────────
async function runTests() {
    console.log('=== LettrSuggest API Verification ===\n');
    await testTMDB();
    await testTuiMDB();
    await testTasteDive();
    await testWatchmode();

    console.log('\n=== Summary ===');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`${passed} passed, ${failed} failed out of ${results.length} APIs`);

    if (failed > 0) {
        console.log('\nFailed APIs:');
        results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  - ${r.api}: ${r.detail}`));
    }
}

runTests();
