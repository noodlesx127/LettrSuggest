Uncaught ReferenceError: chrome is not defined
    <anonymous> <anonymous code>:11
    <anonymous> <anonymous code>:29
    <anonymous> <anonymous code>:31
<anonymous code>:11:5
Uncaught ReferenceError: chrome is not defined
    <anonymous> <anonymous code>:692
    <anonymous> <anonymous code>:770
    <anonymous> <anonymous code>:772
<anonymous code>:692:18
Layout was forced before the page was fully loaded. If stylesheets are not yet loaded this may cause a flash of unstyled content. index.js:1133:1
Download the React DevTools for a better development experience: https://reactjs.org/link/react-devtools react-dom.development.js:38560:17
Warning: Extra attributes from the server: data-darkreader-mode,data-darkreader-scheme
html
RootLayout (Server)
RedirectErrorBoundary@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/redirect-boundary.js:74:9
RedirectBoundary@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/redirect-boundary.js:82:24
NotFoundErrorBoundary@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/not-found-boundary.js:76:9
NotFoundBoundary@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/not-found-boundary.js:84:62
DevRootNotFoundBoundary@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/dev-root-not-found-boundary.js:33:24
ReactDevOverlay@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/react-dev-overlay/app/ReactDevOverlay.js:87:9
HotReload@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/react-dev-overlay/app/hot-reloader-client.js:321:37
Router@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/app-router.js:207:123
ErrorBoundaryHandler@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/error-boundary.js:113:9
ErrorBoundary@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/error-boundary.js:160:67
AppRouter@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/app-router.js:585:47
ServerRoot@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/app-index.js:112:27
Root@webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/app-index.js:117:24 app-index.js:33:22
[ImportStore] Loading films importStore.tsx:26:21
[ImportStore] Found localStorage data 
Object { count: 1170 }
importStore.tsx:35:33
[ImportStore] Loading films importStore.tsx:26:21
[ImportStore] Found localStorage data 
Object { count: 1170 }
importStore.tsx:35:33
[ImportStore] Fetching from Supabase 
Object { uid: "30cfd130-a342-4a7c-b8ad-6175db17e298" }
importStore.tsx:49:33
[ImportStore] Fetching from Supabase 
Object { uid: "30cfd130-a342-4a7c-b8ad-6175db17e298" }
importStore.tsx:49:33
[ImportStore] Loaded from Supabase 
Object { count: 1000 }
importStore.tsx:56:37
[ImportStore] Using localStorage (more complete) 
Object { localStorage: 1170, supabase: 1000 }
importStore.tsx:79:29
[Suggest] runSuggest start 
Object { uid: "30cfd130-a342-4a7c-b8ad-6175db17e298", hasSourceFilms: 1170, excludeGenres: "", yearMin: "", yearMax: "", mode: "quick", cacheKey: 1764725406811 }
page.tsx:399:21
[Suggest] fetching mappings for 1170 films page.tsx:430:21
[Mappings] Auth verified 
Object { uid: "30cfd130-a342-4a7c-b8ad-6175db17e298" }
enrich.ts:106:17
[Mappings] fetching all mappings for user 
Object { userId: "30cfd130-a342-4a7c-b8ad-6175db17e298", uriCount: 1170 }
enrich.ts:115:13
[Mappings] all mappings loaded 
Object { totalRows: 1000 }
enrich.ts:133:17
[Mappings] finished getFilmMappings 
Object { totalMappings: 1000, requestedUris: 1170 }
enrich.ts:152:13
[Suggest] mappings loaded 
Object { mappingCount: 1000, totalFilms: 1170 }
page.tsx:437:21
[Suggest] watchlist IDs 
Object { count: 165 }
page.tsx:460:21
[Suggest] Building taste profile for smart discovery page.tsx:464:21
[ImportStore] Loaded from Supabase 
Object { count: 1000 }
importStore.tsx:56:37
[ImportStore] Using localStorage (more complete) 
Object { localStorage: 1170, supabase: 1000 }
importStore.tsx:79:29
[Suggest] Found negative feedback 
Object { count: 46 }
page.tsx:475:25
=== BUILD TASTE PROFILE START === enrich.ts:646:13
[TasteProfile] Input params: 
Object { filmsCount: 1170, mappingsCount: 1000, topN: 10, negativeFeedbackCount: 46, tmdbDetailsCount: 0 }
enrich.ts:648:13
[TasteProfile] Film filtering: 
Object { totalFilms: 1170, filmsWithMappings: 1000, likedFilmsCount: 798, dislikedFilmsCount: 202, rewatchFilms: 57, likedByLikeFlag: 89 }
enrich.ts:703:13
[TasteProfile] TMDB IDs to fetch: 
Object { likedIdsCount: 100, dislikedIdsCount: 50, limit: 100 }
enrich.ts:714:13
Error: Promised response from onMessage listener went out of scope service-worker.min.js:35:31729
[AdaptiveLearning] Updating genre transitions adaptiveLearning.ts:184:13
[TasteProfile] Movie details fetched: 
Object { likedMoviesTotal: 100, likedMoviesWithData: 100, likedMoviesWithGenres: 100, likedMoviesWithKeywords: 100, likedMoviesWithCredits: 100, dislikedMoviesTotal: 50, dislikedMoviesWithData: 50, negativeFeedbackMovies: 46 }
enrich.ts:747:13
[TasteProfile] Sample movie data: 
Object { title: "Annihilation", genres: (2) […], keywordCount: 39, castCount: 19, crewCount: 174, directors: (1) […] }
enrich.ts:762:17
[TasteProfile] Enhanced profile built 
Object { topGenres: (3) […], topKeywords: (3) […], topDirectors: (3) […], topActors: (3) […], topStudios: (3) […], topDecades: (3) […], avoidGenres: (5) […], userStats: {…} }
enrich.ts:1021:13
=== BUILD TASTE PROFILE END === enrich.ts:1035:13
[AdaptiveLearning] Updating exploration stats 
Object { userId: "30cfd130-a342-4a7c-b8ad-6175db17e298", filmCount: 1170 }
adaptiveLearning.ts:64:13
[Suggest] Generating smart candidates page.tsx:501:21
[SmartCandidates] Generating with enhanced profile 
Object { highlyRatedCount: 141, topGenresCount: 10, topKeywordsCount: 10, topDirectorsCount: 10, topActorsCount: 10, topStudiosCount: 10 }
trending.ts:328:13
[TMDB] trending start 
Object { period: "day", limit: 100 }
trending.ts:130:17
[AdaptiveLearning] No recent exploratory films found to update stats adaptiveLearning.ts:136:21
[TMDB] trending ok 
Object { count: 20 }
trending.ts:146:17
[SmartCandidates] Running multi-source aggregation (primary similar source) trending.ts:352:21
[AdaptiveLearning] Transitions updated 
Object { count: 32 }
adaptiveLearning.ts:279:17
[SmartCandidates] Aggregated recommendations added: 20 trending.ts:379:21
[TMDB] discover start 
Object { genres: (1) […], genreMode: "OR", keywords: (1) […], people: [], peopleMode: "AND", yearMin: undefined, yearMax: undefined, sortBy: "vote_average.desc", minVotes: 100, limit: 150 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 60, filters: {…} }
trending.ts:304:21
[SmartCandidates] Genre+keyword discovery 
Object { count: 60, genreCount: 1, keywordCount: 1, sortBy: "vote_average.desc", temporal: {} }
trending.ts:449:21
[TMDB] discover start 
Object { genres: (3) […], genreMode: "OR", keywords: [], people: [], peopleMode: "AND", yearMin: 2020, yearMax: 2025, sortBy: "popularity.desc", minVotes: 20, limit: 150 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 60, filters: {…} }
trending.ts:304:21
[SmartCandidates] Popular fallback 
Object { count: 60 }
trending.ts:484:25
[TMDB] discover start 
Object { genres: [], genreMode: "AND", keywords: [], people: (3) […], peopleMode: "OR", yearMin: undefined, yearMax: undefined, sortBy: "vote_average.desc", minVotes: undefined, limit: 100 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 60, filters: {…} }
trending.ts:304:21
[SmartCandidates] Director discovery 
Object { count: 60, directors: (3) […] }
trending.ts:507:21
[TMDB] discover start 
Object { genres: [], genreMode: "AND", keywords: (2) […], people: [], peopleMode: "AND", yearMin: undefined, yearMax: undefined, sortBy: "popularity.desc", minVotes: 30, limit: 100 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 60, filters: {…} }
trending.ts:304:21
[SmartCandidates] Niche keyword discovery 
Object { count: 60, keywords: (2) […] }
trending.ts:546:21
[TMDB] discover start 
Object { genres: (1) […], genreMode: "AND", keywords: [], people: [], peopleMode: "AND", yearMin: undefined, yearMax: undefined, sortBy: "popularity.desc", minVotes: 100, limit: 100 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 60, filters: {…} }
trending.ts:304:21
[SmartCandidates] Single genre discovery 
Object { count: 60, genreId: 53 }
trending.ts:613:21
[SmartCandidates] Generated 
Object { trending: 20, similar: 20, discovered: 300, total: 340 }
trending.ts:621:13
[DecadeCandidates] Fetching for 2000s (2000-2009) trending.ts:635:13
[TMDB] discover start 
Object { genres: [], genreMode: "AND", keywords: [], people: [], peopleMode: "AND", yearMin: 2000, yearMax: 2009, sortBy: "popularity.desc", minVotes: 50, limit: 20 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 20, filters: {…} }
trending.ts:304:21
[SmartDiscovery] Fetching hidden gems trending.ts:649:13
[TMDB] discover start 
Object { genres: (3) […], genreMode: "OR", keywords: [], people: [], peopleMode: "AND", yearMin: undefined, yearMax: undefined, sortBy: "vote_average.desc", minVotes: 50, limit: 40 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 40, filters: {…} }
trending.ts:304:21
[TMDB] discover start 
Object { genres: [], genreMode: "AND", keywords: [], people: [], peopleMode: "AND", yearMin: 2000, yearMax: 2009, sortBy: "vote_average.desc", minVotes: 50, limit: 20 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 20, filters: {…} }
trending.ts:304:21
[Suggest][Phase5+] Using adaptive exploration 
Object { rate: 0.15, count: 22, message: "Using default rate (will adjust after rating exploratory picks)" }
page.tsx:526:21
[Exploration] Exploring adjacent genre 
Object { genreId: 10752, fromTopGenres: (3) […], availableAdjacent: 2 }
trending.ts:732:13
[TMDB] discover start 
Object { genres: (1) […], genreMode: "AND", keywords: [], people: [], peopleMode: "AND", yearMin: undefined, yearMax: undefined, sortBy: "vote_average.desc", minVotes: 500, limit: 30 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 30, filters: {…} }
trending.ts:304:21
[Exploration] Exploring acclaimed films in new genre 
Object { genreId: 10752, availableGenres: 9 }
trending.ts:784:13
[TMDB] discover start 
Object { genres: (1) […], genreMode: "AND", keywords: [], people: [], peopleMode: "AND", yearMin: undefined, yearMax: undefined, sortBy: "vote_average.desc", minVotes: 500, limit: 14 }
trending.ts:295:17
[TMDB] discover ok 
Object { count: 14, filters: {…} }
trending.ts:304:21
[Exploration] Generated exploratory picks 
Object { total: 22, adjacent: 15, acclaimed: 7, targetCount: 22 }
trending.ts:698:13
[Suggest] Smart candidates breakdown 
Object { trending: 20, similar: 20, discovered: 300, decade: 20, discovery: 20, exploratory: 22, totalRaw: 402 }
page.tsx:547:21
[Suggest] candidate pool 
Object { blockedCount: 0, mode: "quick", totalCandidates: 402, afterFilter: 329, watchedCount: 751 }
page.tsx:569:21
[Suggest] Loaded genre transitions 
Object { count: 3 }
page.tsx:582:21
[Suggest] calling suggestByOverlap 
Object { liteCount: 1170, candidatesCount: 329 }
page.tsx:608:21
[Suggest] User profile analysis 
Object { totalLiked: 143, likedAnimationCount: 0, likedFamilyCount: 1, likedChildrensCount: 2, avoidsAnimation: true, avoidsFamily: true, avoidsChildrens: true, topKeywords: (10) […], topGenreCombos: (5) […], topDirectors: (5) […], … }
enrich.ts:1423:13
[Suggest] Subgenre analysis complete 
Object { patternsDetected: 6, crossPatternsDetected: 49, exampleAvoidances: (3) […] }
enrich.ts:1467:13
[NegativePenalty] Penalized "Striking Rescue" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "As Tears Go By" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Animal World" by 6.00 - Contains Drama you typically avoid enrich.ts:1840:21
[CrossGenreBoost] Boosted "Sexy Beast" by 1.20 - Matches your taste in Crime+Drama+Thriller with themes: neo-noir (like Collateral, Lord of War) enrich.ts:1581:25
[NegativePenalty] Penalized "Sexy Beast" by 6.00 - Contains Thriller you typically avoid; Has themes (murder) you dislike enrich.ts:1840:21
[NegativePenalty] Penalized "Sentimental Value" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Heads of State" - User avoids action spy within Action enrich.ts:1555:21
[NegativePenalty] Penalized "My Favourite Cake" by 4.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Nobody" - User avoids thriller conspiracy within Thriller enrich.ts:1555:21
[NegativePenalty] Penalized "The Heir Apparent: Largo Winch" by 7.00 - Contains Drama you typically avoid; Has themes (murder) you dislike enrich.ts:1840:21
[NegativePenalty] Penalized "Train Dreams" by 3.00 - Contains Drama you typically avoid; Has themes (based on novel or book) you dislike enrich.ts:1840:21
[NegativePenalty] Penalized "Aftermath" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "The Gorge" by 4.00 - Contains Science Fiction you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Rustom" by 4.00 - Contains Thriller you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Symmetry" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Sniper: The Last Stand" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Mission «Sky»" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Mantis" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Simón" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Cash Out" - User avoids action heist within Action enrich.ts:1555:21
[CrossGenreBoost] Boosted "Burn Out" by 1.40 - Matches your taste in Action+Crime+Thriller with themes: based on novel or book (like Devs, Bullitt) enrich.ts:1581:25
[NegativePenalty] Penalized "Burn Out" by 5.00 - Contains Action you typically avoid; Has themes (based on novel or book) you dislike enrich.ts:1840:21
[SubgenreFilter] Filtered "The Woman in Cabin 10" - User avoids thriller crime within Thriller enrich.ts:1555:21
[CrossGenreBoost] Boosted "Gloria" by 1.20 - Matches your taste in Crime+Drama+Thriller with themes: new york city (like Collateral, Lord of War) enrich.ts:1581:25
[NegativePenalty] Penalized "Gloria" by 4.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Ninja Assassin" - User avoids action martial arts within Action enrich.ts:1555:21
[NegativePenalty] Penalized "Troll" by 2.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Saiyaara" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "How to Make a Killing" - User avoids comedy dark within Comedy enrich.ts:1555:21
[SubgenreFilter] Filtered "xXx" - User avoids drama sports within Drama enrich.ts:1555:21
[SubgenreFilter] Filtered "Counterattack" - User avoids action spy within Action enrich.ts:1555:21
[SubgenreFilter] Filtered "The Smashing Machine" - User avoids drama historical within Drama enrich.ts:1555:21
[NegativePenalty] Penalized "Memory" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "The Family Plan 2" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Captain America: Brave New World" - User avoids action superhero within Action enrich.ts:1555:21
[NegativePenalty] Penalized "Flight Risk" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "F1" - User avoids drama sports within Drama enrich.ts:1555:21
[NegativePenalty] Penalized "Radical" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[CrossGenreBoost] Boosted "Fast X" by 1.40 - Matches your taste in Action+Crime+Thriller with themes: bold (like Devs, Bullitt) enrich.ts:1581:25
[NegativePenalty] Penalized "Fast X" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Ikiru" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Silent Night" by 4.00 - Contains Action you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "Lumière & Company" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Angels & Demons" - User avoids thriller conspiracy within Thriller enrich.ts:1555:21
[NegativePenalty] Penalized "The Paradine Case" by 5.00 - Contains Drama you typically avoid; Directed by Alfred Hitchcock whose films you don't enjoy enrich.ts:1840:21
[CrossGenreBoost] Boosted "The Friends of Eddie Coyle" by 1.20 - Matches your taste in Crime+Drama+Thriller with themes: fbi (like Collateral, Lord of War) enrich.ts:1581:25
[NegativePenalty] Penalized "The Friends of Eddie Coyle" by 5.00 - Contains Drama you typically avoid; Has themes (based on novel or book) you dislike enrich.ts:1840:21
[SubgenreFilter] Filtered "Election" - User avoids thriller crime within Thriller enrich.ts:1555:21
[SubgenreFilter] Filtered "Election 2" - User avoids thriller crime within Thriller enrich.ts:1555:21
[CrossGenreBoost] Boosted "New World" by 1.20 - Matches your taste in Crime+Drama+Thriller with themes: neo-noir (like Collateral, Lord of War) enrich.ts:1581:25
[NegativePenalty] Penalized "New World" by 5.00 - Contains Thriller you typically avoid; Has themes (neo-noir) you dislike enrich.ts:1840:21
[NegativePenalty] Penalized "Drunken Angel" by 2.00 - Contains Drama you typically avoid enrich.ts:1840:21
[NegativePenalty] Penalized "The Petrified Forest" by 4.00 - Contains Drama you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "The Long Good Friday" - User avoids thriller crime within Thriller enrich.ts:1555:21
[SubgenreFilter] Filtered "Miracles: The Canton Godfather" - User avoids action martial arts within Action enrich.ts:1555:21
[NegativePenalty] Penalized "Innocent Blood" by 4.00 - Contains Comedy you typically avoid enrich.ts:1840:21
[SubgenreFilter] Filtered "Palo Alto" - User avoids drama sports within Drama enrich.ts:1555:21
[NegativePenalty] Penalized "Jamaica Inn" by 6.00 - Contains Thriller you typically avoid; Has themes (based on novel or book) you dislike; Directed by Alfred Hitchcock whose films you don't enjoy enrich.ts:1840:21
[SubgenreFilter] Filtered "Murder!" - User avoids thriller crime within Thriller enrich.ts:1555:21
[NegativePenalty] Penalized "Secret Agent" by 5.00 - Contains Thriller you typically avoid; Directed by Alfred Hitchcock whose films you don't enjoy enrich.ts:1840:21
[SubgenreFilter] Filtered "Haunted" - User avoids horror supernatural within Horror enrich.ts:1555:21
[NegativePenalty] Penalized "Somewhere" by 3.00 - Contains Drama you typically avoid; Has themes (los angeles, california) you dislike enrich.ts:1840:21
[SubgenreFilter] Filtered "Tower Heist" - User avoids action heist within Action enrich.ts:1555:21
[SubgenreFilter] Filtered "My Son, My Son, What Have Ye Done" - User avoids thriller crime within Thriller enrich.ts:1555:21
[DiversityFilter] Applied diversity filtering 
Object { original: 35, filtered: 18, skipped: 17, directorCounts: (1) […], genreCounts: (5) […] }
enrich.ts:1157:13
[Suggest] refreshing TMDB cache for suggested ids 18 page.tsx:641:29
[UnifiedAPI] fetch movie from TMDB 
Object { id: 17030 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 17030 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 17030, title: "The Petrified Forest" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 17030 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 14400 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 14400 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 14400, title: "The Heir Apparent: Largo Winch" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 14400 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 518764 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 518764 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 518764, title: "Animal World" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 518764 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 27381 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 27381 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 27381, title: "Innocent Blood" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 27381 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 31995 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 31995 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 31995, title: "Jamaica Inn" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 31995 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 31667 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 31667 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 31667, title: "The Paradine Case" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 31667 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 950396 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 950396 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 950396, title: "The Gorge" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 950396 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 48336 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 48336 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 48336, title: "Lumière & Company" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 48336 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 1241634 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 1241634 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 1241634, title: "Saiyaara" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 1241634 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 1246049 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 1246049 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 1246049, title: "Dracula" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 1246049 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 385687 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 385687 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 385687, title: "Fast X" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 385687 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 25680 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 25680 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 25680, title: "The Friends of Eddie Coyle" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 25680 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 39210 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 39210 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 39210, title: "Somewhere" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 39210 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 10889 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 10889 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 10889, title: "Gloria" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 10889 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 3782 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 3782 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 3782, title: "Ikiru" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 3782 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 11826 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 11826 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 11826, title: "Sexy Beast" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 11826 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 460059 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 460059 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 460059, title: "Burn Out" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 460059 }
enrich.ts:308:21
[UnifiedAPI] fetch movie from TMDB 
Object { id: 165213 }
enrich.ts:232:13
[UnifiedAPI] TMDB fetch movie ok 
Object { id: 165213 }
enrich.ts:252:17
[UnifiedAPI] searching TuiMDB for UID 
Object { tmdbId: 165213, title: "New World" }
enrich.ts:266:17
[UnifiedAPI] TuiMDB UID not found 
Object { tmdbId: 165213 }
enrich.ts:308:21
[Suggest] Tracking shown IDs 
Object { total: 18, newThisRound: 18, limited: false }
page.tsx:656:21
[Suggest] suggestions ready with full details 
Object { count: 18 }
page.tsx:732:21
[Suggest] runSuggest end page.tsx:747:21
[usePostersSWR] Fetching posters 
Object { idsCount: 18 }
usePostersSWR.ts:20:13
[Suggest] Seasonal picks result 
Object { configGenres: (1) […], configKeywords: (1) […], seasonalPicksCount: 0 }
page.tsx:160:17
[Suggest] Categorization complete 
Object { seasonalPicks: 0, perfectMatches: 0, recentWatchMatches: 12, studioMatches: 4, directorMatches: 2, actorMatches: 0, genreMatches: 0, documentaries: 0, hiddenGems: 0, cultClassics: 0, … }
page.tsx:227:17
[usePostersSWR] Chunk fetched 
Object { requested: 18, received: 18 }
usePostersSWR.ts:36:17
[usePostersSWR] Fetch complete 
Object { posterCount: 18 }
usePostersSWR.ts:49:13
[usePostersSWR] Fetching posters 
Object { idsCount: 18 }
usePostersSWR.ts:20:13
[usePostersSWR] Chunk fetched 
Object { requested: 18, received: 18 }
usePostersSWR.ts:36:17
[usePostersSWR] Fetch complete 
Object { posterCount: 18 }
usePostersSWR.ts:49:13
[usePostersSWR] Fetching posters 
Object { idsCount: 18 }
usePostersSWR.ts:20:13
[usePostersSWR] Chunk fetched 
Object { requested: 18, received: 18 }
usePostersSWR.ts:36:17
[usePostersSWR] Fetch complete 
Object { posterCount: 18 }
usePostersSWR.ts:49:13
