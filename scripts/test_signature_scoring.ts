/**
 * Test script for signature film scoring
 *
 * Run with: npx tsx scripts/test_signature_scoring.ts
 */

import {
  scoreSignatureFilm,
  getWeightedSeedIds,
  type FilmForSeeding,
} from "../src/lib/trending";

// Mock user profile
const mockProfile = {
  topGenres: [
    { id: 27, name: "Horror" },
    { id: 53, name: "Thriller" },
    { id: 878, name: "Science Fiction" },
    { id: 18, name: "Drama" },
  ],
  topDecades: [{ decade: 2010 }, { decade: 2000 }, { decade: 1990 }],
};

// Mock films with varying characteristics
const mockFilms: FilmForSeeding[] = [
  {
    uri: "film1",
    tmdbId: 1,
    title: "Hidden Horror Gem",
    rating: 4.5,
    liked: true,
    popularity: 8.5, // Very niche
    releaseDate: "2015-06-15",
    genreIds: [27, 53], // Horror + Thriller (multi-genre match)
  },
  {
    uri: "film2",
    tmdbId: 2,
    title: "Mainstream Blockbuster",
    rating: 4.5,
    liked: true,
    popularity: 500, // Very popular
    releaseDate: "2018-05-04",
    genreIds: [28], // Action (not in user's top genres)
  },
  {
    uri: "film3",
    tmdbId: 3,
    title: "Cult Classic Sci-Fi",
    rating: 4.0,
    liked: true,
    popularity: 35, // Under-the-radar
    releaseDate: "2010-09-10",
    genreIds: [878, 53], // Sci-Fi + Thriller (multi-genre match, preferred decade)
  },
  {
    uri: "film4",
    tmdbId: 4,
    title: "Obscure Drama",
    rating: 4.5,
    popularity: 2.5, // Hidden gem
    releaseDate: "2005-03-20",
    genreIds: [18], // Drama (single genre match, preferred decade)
  },
  {
    uri: "film5",
    tmdbId: 5,
    title: "Recent Horror",
    rating: 4.0,
    popularity: 15, // Under-the-radar
    releaseDate: "2022-10-31",
    genreIds: [27], // Horror (single genre match)
  },
];

console.log("=== Testing Signature Film Scoring ===\n");

// Test individual scoring
console.log("Individual Film Scores:\n");
mockFilms.forEach((film) => {
  const score = scoreSignatureFilm(film, mockProfile);
  console.log(`${film.title}:`);
  console.log(`  Score: ${score.signatureScore.toFixed(2)}`);
  console.log(`  Reasons: ${score.reasons.join(", ")}`);
  console.log(
    `  Popularity: ${film.popularity}, Rating: ${film.rating}, Genres: ${film.genreIds?.join(", ")}\n`,
  );
});

// Test seed selection with signature scoring
console.log("\n=== Testing Seed Selection ===\n");

console.log("Standard weighted seeds (top 3):");
const standardSeeds = getWeightedSeedIds(mockFilms, 3, false);
console.log(
  standardSeeds.map((id) => mockFilms.find((f) => f.tmdbId === id)?.title),
);

console.log("\nSignature-based seeds (top 3):");
const signatureSeeds = getWeightedSeedIds(mockFilms, 3, false, {
  topGenres: mockProfile.topGenres,
  topDecades: mockProfile.topDecades,
  useSignatureScoring: true,
});
console.log(
  signatureSeeds.map((id) => mockFilms.find((f) => f.tmdbId === id)?.title),
);

console.log("\n=== Expected Behavior ===");
console.log("Signature scoring should prioritize:");
console.log(
  "1. 'Hidden Horror Gem' - 5-star, liked, very niche, multi-genre match",
);
console.log(
  "2. 'Obscure Drama' - 5-star, hidden gem, genre match, preferred decade",
);
console.log(
  "3. 'Cult Classic Sci-Fi' - 4-star, liked, niche, multi-genre match, preferred decade",
);
console.log(
  "\nMainstream Blockbuster should score lower despite 5-star rating due to high popularity and genre mismatch.",
);
