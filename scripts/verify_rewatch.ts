import * as fs from 'fs';
import * as path from 'path';

// Parse CSV manually (simple version for testing)
function parseCSV(content: string): any[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj: any = {};
    headers.forEach((h, i) => {
      obj[h] = values[i]?.trim() ?? '';
    });
    return obj;
  });
}

// Minimal inline normalization to test rewatch logic
interface FilmEvent {
  uri: string;
  title: string;
  year?: number;
  rating?: number;
  rewatch?: boolean;
  watchCount?: number;
  lastDate?: string;
  liked?: boolean;
}

const dataDir = path.join(process.cwd(), 'letterboxd-userdata');

function readCSV(filename: string): any[] {
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return parseCSV(content);
}

// Test the fix
const diary = readCSV('diary.csv');
const watched = readCSV('watched.csv');

const byURI = new Map<string, FilmEvent>();
const diaryCount = new Map<string, number>();

// Process watched first
for (const r of watched) {
  const uri = r['Letterboxd URI'];
  if (!uri) continue;
  byURI.set(uri, { uri, title: r['Name'], year: parseInt(r['Year']) || undefined });
}

// Process diary with the FIXED logic
for (const r of diary) {
  const uri = r['Letterboxd URI'];
  if (!uri) continue;
  const rewatch = (r['Rewatch'] ?? '').toLowerCase() === 'yes';
  const rating = parseFloat(r['Rating']) || undefined;
  const d = r['Date'];
  
  diaryCount.set(uri, (diaryCount.get(uri) ?? 0) + 1);
  
  const prev: FilmEvent = byURI.get(uri) ?? { uri, title: r['Name'] };
  
  // FIXED: Use === true for strict comparison, set to boolean not undefined
  const isRewatch = prev.rewatch === true || rewatch;
  
  byURI.set(uri, {
    ...prev,
    rewatch: isRewatch, // Now always a boolean
    rating: rating ?? prev.rating,
    lastDate: d ?? prev.lastDate,
  });
}

// Finalize with FIXED logic
for (const [uri, f] of byURI.entries()) {
  let wc = diaryCount.get(uri) ?? 0;
  if (wc === 0) {
    if (byURI.has(uri) || (f.rating != null)) wc = 1;
  }
  
  // FIXED: Use === true and set to boolean
  const isRewatch = f.rewatch === true || wc > 1;
  
  byURI.set(uri, { ...f, watchCount: wc, rewatch: isRewatch });
}

// Analyze results
const films = [...byURI.values()];
const rewatchedTrue = films.filter(f => f.rewatch === true);
const rewatchedFalse = films.filter(f => f.rewatch === false);
const rewatchedUndefined = films.filter(f => f.rewatch === undefined);

console.log('=== REWATCH FIX VERIFICATION ===');
console.log(`Total films: ${films.length}`);
console.log(`rewatch === true: ${rewatchedTrue.length}`);
console.log(`rewatch === false: ${rewatchedFalse.length}`);
console.log(`rewatch === undefined: ${rewatchedUndefined.length}`);

// Check against original diary data
const diaryRewatches = diary.filter((r: any) => (r['Rewatch'] ?? '').toLowerCase() === 'yes').length;
console.log(`\nDiary entries marked as Rewatch=Yes: ${diaryRewatches}`);
console.log(`Unique films that are rewatches: ${rewatchedTrue.length}`);

// Calculate the rewatch rate as the stats page would
const totalRewatchEntries = films.reduce((sum, f) => {
  const wc = f.watchCount ?? 0;
  if (f.rewatch) {
    return sum + Math.max(1, wc - 1);
  } else if (wc > 1) {
    return sum + (wc - 1);
  }
  return sum;
}, 0);

const totalWatches = films.reduce((sum, f) => sum + (f.watchCount ?? 0), 0);
const rewatchRate = totalWatches > 0 ? ((totalRewatchEntries / totalWatches) * 100).toFixed(1) : '0.0';

console.log(`\n=== EXPECTED STATS PAGE OUTPUT ===`);
console.log(`Total watches: ${totalWatches}`);
console.log(`Total rewatch entries: ${totalRewatchEntries}`);
console.log(`Rewatch Rate: ${rewatchRate}%`);

// Show some example rewatched films
console.log('\n=== SAMPLE REWATCHED FILMS ===');
rewatchedTrue.slice(0, 5).forEach(f => {
  console.log(`  ${f.title} (${f.year}) - watchCount: ${f.watchCount}, rewatch: ${f.rewatch}`);
});
