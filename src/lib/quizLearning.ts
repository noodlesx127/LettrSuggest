/**
 * Quiz Learning System
 * Generates quiz questions and processes answers to strengthen preference learning
 */

import { supabase } from './supabaseClient';
import { detectSubgenres, stringHash } from './subgenreDetection';

// Types
export type QuizQuestionType = 'genre_rating' | 'theme_preference' | 'movie_rating';

export interface GenreRatingQuestion {
    type: 'genre_rating';
    genreId: number;
    genreName: string;
}

export interface ThemePreferenceQuestion {
    type: 'theme_preference';
    keywordId: number;
    keywordName: string;
}

export interface MovieRatingQuestion {
    type: 'movie_rating';
    tmdbId: number;
    title: string;
    year?: string;
    posterPath?: string | null;
    overview?: string;
    genres?: string[];
    trailerKey?: string | null;
}

export type QuizQuestion = GenreRatingQuestion | ThemePreferenceQuestion | MovieRatingQuestion;

export interface GenreRatingAnswer {
    rating: 1 | 2 | 3 | 4 | 5; // 1=Never, 2=Rarely, 3=Sometimes, 4=Often, 5=Love it
}

export interface ThemePreferenceAnswer {
    preference: 'yes' | 'maybe' | 'no';
}

export interface MovieRatingAnswer {
    thumbsUp: boolean;
}

export type QuizAnswer = GenreRatingAnswer | ThemePreferenceAnswer | MovieRatingAnswer;

// Genre list for quiz questions (TMDB genre IDs)
const QUIZ_GENRES = [
    { id: 28, name: 'Action' },
    { id: 12, name: 'Adventure' },
    { id: 16, name: 'Animation' },
    { id: 35, name: 'Comedy' },
    { id: 80, name: 'Crime' },
    { id: 99, name: 'Documentary' },
    { id: 18, name: 'Drama' },
    { id: 10751, name: 'Family' },
    { id: 14, name: 'Fantasy' },
    { id: 36, name: 'History' },
    { id: 27, name: 'Horror' },
    { id: 10402, name: 'Music' },
    { id: 9648, name: 'Mystery' },
    { id: 10749, name: 'Romance' },
    { id: 878, name: 'Science Fiction' },
    { id: 53, name: 'Thriller' },
    { id: 10752, name: 'War' },
    { id: 37, name: 'Western' },
];

// Common keywords/themes for quiz questions
const QUIZ_KEYWORDS = [
    { id: 9715, name: 'superhero' },
    { id: 4344, name: 'musical' },
    { id: 10349, name: 'survival' },
    { id: 6149, name: 'dystopia' },
    { id: 310, name: 'artificial intelligence' },
    { id: 9882, name: 'space' },
    { id: 12332, name: 'zombie' },
    { id: 3691, name: 'forbidden love' },
    { id: 9663, name: 'time travel' },
    { id: 849, name: 'vampire' },
    { id: 162846, name: 'serial killer' },
    { id: 10224, name: 'heist' },
    { id: 11322, name: 'female protagonist' },
    { id: 818, name: 'based on novel' },
    { id: 10683, name: 'coming of age' },
    { id: 1568, name: 'underdog' },
    { id: 4565, name: 'anti-hero' },
    { id: 1430, name: 'conspiracy' },
    { id: 11332, name: 'martial arts' },
    { id: 1454, name: 'world war ii' },
    // Additional themes for more variety
    { id: 4379, name: 'remake' },
    { id: 9748, name: 'revenge' },
    { id: 207317, name: 'christmas' },
    { id: 10714, name: 'road trip' },
    { id: 3799, name: 'spy' },
    { id: 1328, name: 'haunted house' },
    { id: 158718, name: 'found footage' },
    { id: 9672, name: 'based on true story' },
    { id: 9986, name: 'solo mission' },
    { id: 1562, name: 'disaster' },
    { id: 6054, name: 'father son relationship' },
    { id: 10235, name: 'ensemble cast' },
    { id: 3929, name: 'independent film' },
    { id: 1299, name: 'monster' },
    { id: 157430, name: 'dark comedy' },
];

/**
 * Get questions already answered by user to avoid repeats
 */
async function getAnsweredQuestions(userId: string): Promise<Set<string>> {
    if (!supabase) return new Set();

    const { data, error } = await supabase
        .from('user_quiz_responses')
        .select('question_type, question_data')
        .eq('user_id', userId);

    if (error) {
        console.error('[QuizLearning] Failed to fetch answered questions', error);
        return new Set();
    }

    const answered = new Set<string>();
    for (const row of data || []) {
        const type = row.question_type;
        const data = row.question_data as Record<string, unknown>;

        if (type === 'genre_rating' && data.genreId) {
            answered.add(`genre:${data.genreId}`);
        } else if (type === 'theme_preference' && data.keywordId) {
            answered.add(`keyword:${data.keywordId}`);
        } else if (type === 'movie_rating' && data.tmdbId) {
            answered.add(`movie:${data.tmdbId}`);
        }
    }

    return answered;
}

/**
 * Get candidate movies for movie rating questions from user's TMDB cache
 * FILTERS:
 * - Not watched
 * - Not already answered
 * - Not blocked (thumbs down)
 * - Genres are not "avoided" (strong negative feedback)
 * 
 * VARIETY:
 * - Shuffles trending list to avoid "only recent movies" bias
 */
async function getCandidateMovies(userId: string, answered: Set<string>): Promise<MovieRatingQuestion[]> {
    if (!supabase) return [];

    try {
        // 1. Get watched movies (paginated - PostgREST defaults to 1000 max per request)
        const pageSize = 1000;
        let from = 0;
        const allWatchedIds: number[] = [];

        while (true) {
            const { data: pageData, error: pageError } = await supabase
                .from('film_tmdb_map')
                .select('tmdb_id')
                .eq('user_id', userId)
                .range(from, from + pageSize - 1);

            if (pageError) {
                console.warn('[QuizLearning] Error fetching watched movies page', { from, error: pageError });
                break;
            }

            const rows = pageData ?? [];
            allWatchedIds.push(...rows.map(r => r.tmdb_id));

            // If we got fewer than pageSize, we've fetched all rows
            if (rows.length < pageSize) break;
            from += pageSize;
        }

        const watchedIds = new Set(allWatchedIds);

        // 2. Get blocked suggestions (thumbs down)
        const { data: blockedData } = await supabase
            .from('blocked_suggestions')
            .select('tmdb_id')
            .eq('user_id', userId);
        const blockedIds = new Set((blockedData || []).map(r => r.tmdb_id));

        // 3. Get avoided genres (negative feedback)
        // Consider avoided if negative > positive + 2, or preference < 0.3
        const { data: genreFeedback } = await supabase
            .from('user_feature_feedback')
            .select('feature_id, positive_count, negative_count, inferred_preference')
            .eq('user_id', userId)
            .eq('feature_type', 'genre');

        const avoidedGenreIds = new Set<number>();
        for (const f of genreFeedback || []) {
            if (f.inferred_preference < 0.35 || f.negative_count > (f.positive_count + 1)) {
                avoidedGenreIds.add(f.feature_id);
            }
        }

        // 4. Source A: Get trending/popular movies (week + month for more variety)
        const [{ data: weeklyTrending }, { data: monthlyTrending }] = await Promise.all([
            supabase.from('tmdb_trending').select('tmdb_id').eq('period', 'week').limit(200),
            supabase.from('tmdb_trending').select('tmdb_id').eq('period', 'month').limit(200),
        ]);

        // 5. Source B: Get RANDOM library movies from multiple offsets (Classic/Deep Cuts)
        // Sample from 3 different random positions to increase variety
        const { count } = await supabase
            .from('tmdb_movies')
            .select('*', { count: 'exact', head: true });

        const totalMovies = count || 5000;
        const batchSize = 150;
        const numBatches = 3;
        const libraryPromises = [];

        for (let i = 0; i < numBatches; i++) {
            const randomOffset = Math.floor(Math.random() * Math.max(0, totalMovies - batchSize));
            libraryPromises.push(
                supabase.from('tmdb_movies').select('tmdb_id').range(randomOffset, randomOffset + batchSize - 1)
            );
        }

        const libraryResults = await Promise.all(libraryPromises);
        const libraryIds = libraryResults.flatMap(r => (r.data || []).map(row => row.tmdb_id));

        // Combine all sources (~400 trending + ~450 library = ~850 candidates)
        const allCandidates = [
            ...(weeklyTrending || []).map(r => r.tmdb_id),
            ...(monthlyTrending || []).map(r => r.tmdb_id),
            ...libraryIds
        ];

        // 6. Filter IDs by watched/blocked/answered
        const seenCandidates = new Set<number>();
        let candidateIds = allCandidates.filter(id => {
            if (seenCandidates.has(id)) return false;
            seenCandidates.add(id);
            return true;
        })
            .filter(id =>
                !watchedIds.has(id) &&
                !blockedIds.has(id) &&
                !answered.has(`movie:${id}`)
            );

        if (candidateIds.length === 0) return [];

        // 6. SHUFFLE to reduce recency/popularity bias
        // This ensures typically "lower ranked" trending movies get a chance
        candidateIds = candidateIds.sort(() => Math.random() - 0.5);

        // 7. Fetch details for a chunk (e.g. top 30 after shuffle)
        // We fetch a bit more than we need because some might be filtered by genre
        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', candidateIds.slice(0, 30)); // Take 30 random candidates

        const questions: MovieRatingQuestion[] = [];

        for (const row of movieData || []) {
            const movie = row.data as Record<string, unknown>;
            const genres = (movie.genres as Array<{ id: number; name: string }>) || [];

            // 8. Filter by AVOIDED GENRES
            // If movie has ANY avoided genre, skip it
            const hasAvoidedGenre = genres.some(g => avoidedGenreIds.has(g.id));
            if (hasAvoidedGenre) continue;

            // Extract trailer
            const videos = (movie.videos as { results?: Array<{ site: string; type: string; key: string; official?: boolean }> })?.results || [];
            const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer' && v.official)
                || videos.find(v => v.site === 'YouTube' && v.type === 'Trailer');

            questions.push({
                type: 'movie_rating' as const,
                tmdbId: row.tmdb_id,
                title: (movie.title as string) || 'Unknown',
                year: movie.release_date ? String(movie.release_date).slice(0, 4) : undefined,
                posterPath: movie.poster_path as string | null,
                overview: movie.overview as string || undefined,
                genres: genres.map(g => g.name),
                trailerKey: trailer?.key || null,
            });
        }

        return questions;
    } catch (e) {
        console.error('[QuizLearning] Failed to get candidate movies', e);
        return [];
    }
}

/**
 * Get existing feature feedback to identify gaps and ambiguities
 */
async function getFeatureFeedback(userId: string): Promise<Map<string, { positive: number; negative: number; total: number; preference: number }>> {
    if (!supabase) return new Map();

    const { data, error } = await supabase
        .from('user_feature_feedback')
        .select('feature_type, feature_id, positive_count, negative_count, inferred_preference')
        .eq('user_id', userId);

    if (error) {
        console.error('[QuizLearning] Failed to fetch feature feedback', error);
        return new Map();
    }

    const feedback = new Map<string, { positive: number; negative: number; total: number; preference: number }>();
    for (const row of data || []) {
        const key = `${row.feature_type}:${row.feature_id}`;
        feedback.set(key, {
            positive: row.positive_count,
            negative: row.negative_count,
            total: row.positive_count + row.negative_count,
            preference: row.inferred_preference,
        });
    }
    return feedback;
}

/**
 * Score a feature for quiz priority
 * Lower score = higher priority (ask first)
 * Priority order: 1) No data 2) Low data 3) Ambiguous 4) Strong preference
 */
function scoreFeaturePriority(feedback: Map<string, { positive: number; negative: number; total: number; preference: number }>, type: string, id: number): number {
    const key = `${type}:${id}`;
    const data = feedback.get(key);

    if (!data) {
        // No data - highest priority (score 0)
        return 0;
    }

    if (data.total < 3) {
        // Low data - high priority (score 1-10 based on count)
        return data.total * 3;
    }

    // Ambiguous preferences (near 0.5) are higher priority than strong ones
    const ambiguity = 1 - Math.abs(data.preference - 0.5) * 2; // 0 = strong, 1 = ambiguous
    return 10 + (1 - ambiguity) * 40; // Score 10-50 based on clarity
}

/**
 * Generate a batch of quiz questions for a session
 * SMART PRIORITIZATION:
 * 1. First, ask about features with NO existing data (cold start)
 * 2. Then, ask about features with LOW sample counts (<3)
 * 3. Then, ask about AMBIGUOUS preferences (near 0.5)
 * 4. Random fallback for well-understood preferences
 */
export async function generateQuizQuestions(
    userId: string,
    count: number = 10
): Promise<QuizQuestion[]> {
    const answered = await getAnsweredQuestions(userId);
    const feedback = await getFeatureFeedback(userId);
    const questions: QuizQuestion[] = [];

    // Get unanswered genres with priority scores
    const unansweredGenres = QUIZ_GENRES
        .filter(g => !answered.has(`genre:${g.id}`))
        .map(g => ({ ...g, priority: scoreFeaturePriority(feedback, 'genre', g.id) }))
        .sort((a, b) => a.priority - b.priority); // Lower = higher priority

    // Get unanswered keywords with priority scores
    const unansweredKeywords = QUIZ_KEYWORDS
        .filter(k => !answered.has(`keyword:${k.id}`))
        .map(k => ({ ...k, priority: scoreFeaturePriority(feedback, 'keyword', k.id) }))
        .sort((a, b) => a.priority - b.priority);

    // Get candidate movies (these are already filtered for unwatched)
    const candidateMovies = await getCandidateMovies(userId, answered);
    // Shuffle movies since we can't easily score them
    const shuffledMovies = [...candidateMovies].sort(() => Math.random() - 0.5);

    // Log prioritization info
    const hasData = feedback.size > 0;
    const topGenrePriority = unansweredGenres[0]?.priority ?? 999;
    const topKeywordPriority = unansweredKeywords[0]?.priority ?? 999;

    console.log('[QuizLearning] Prioritization', {
        hasExistingData: hasData,
        feedbackCount: feedback.size,
        topGenre: unansweredGenres[0]?.name,
        topGenrePriority,
        topKeyword: unansweredKeywords[0]?.name,
        topKeywordPriority,
    });

    // Build question list - prioritize by combined score
    let genreIdx = 0, keywordIdx = 0, movieIdx = 0;

    // For 10 questions: ~4 genres, ~3 keywords, ~3 movies
    const typeRotation: QuizQuestionType[] = [
        'genre_rating', 'theme_preference', 'movie_rating',
        'genre_rating', 'theme_preference', 'movie_rating',
        'genre_rating', 'theme_preference', 'movie_rating',
        'genre_rating',
    ];

    for (let i = 0; i < count && i < typeRotation.length; i++) {
        const type = typeRotation[i];

        if (type === 'genre_rating' && genreIdx < unansweredGenres.length) {
            const genre = unansweredGenres[genreIdx++];
            questions.push({ type: 'genre_rating', genreId: genre.id, genreName: genre.name });
        } else if (type === 'theme_preference' && keywordIdx < unansweredKeywords.length) {
            const keyword = unansweredKeywords[keywordIdx++];
            questions.push({ type: 'theme_preference', keywordId: keyword.id, keywordName: keyword.name });
        } else if (type === 'movie_rating' && movieIdx < shuffledMovies.length) {
            questions.push(shuffledMovies[movieIdx++]);
        } else {
            // Fallback: try other types
            if (genreIdx < unansweredGenres.length) {
                const genre = unansweredGenres[genreIdx++];
                questions.push({ type: 'genre_rating', genreId: genre.id, genreName: genre.name });
            } else if (keywordIdx < unansweredKeywords.length) {
                const keyword = unansweredKeywords[keywordIdx++];
                questions.push({ type: 'theme_preference', keywordId: keyword.id, keywordName: keyword.name });
            } else if (movieIdx < shuffledMovies.length) {
                questions.push(shuffledMovies[movieIdx++]);
            }
        }
    }

    console.log('[QuizLearning] Generated questions', {
        count: questions.length,
        types: questions.map(q => q.type),
        strategy: hasData ? 'smart-prioritized' : 'cold-start',
    });

    return questions;
}

/**
 * Record a quiz answer and update feature preferences
 */
export async function recordQuizAnswer(
    userId: string,
    question: QuizQuestion,
    answer: QuizAnswer
): Promise<void> {
    if (!supabase) return;

    // Store the quiz response
    const { error: insertError } = await supabase
        .from('user_quiz_responses')
        .insert({
            user_id: userId,
            question_type: question.type,
            question_data: question,
            answer: answer,
        });

    if (insertError) {
        console.error('[QuizLearning] Failed to insert quiz response', insertError);
        return;
    }

    // Update feature preferences based on answer type
    if (question.type === 'genre_rating') {
        await updateGenrePreference(userId, question, answer as GenreRatingAnswer);
    } else if (question.type === 'theme_preference') {
        await updateKeywordPreference(userId, question, answer as ThemePreferenceAnswer);
    } else if (question.type === 'movie_rating') {
        await updateMoviePreference(userId, question, answer as MovieRatingAnswer);
    }

    console.log('[QuizLearning] Recorded answer', {
        userId: userId.slice(0, 8),
        type: question.type,
        answer
    });
}

/**
 * Update genre preference based on quiz rating
 */
async function updateGenrePreference(
    userId: string,
    question: GenreRatingQuestion,
    answer: GenreRatingAnswer
): Promise<void> {
    if (!supabase) return;

    // Map rating to positive/negative counts
    // 1=Never: +0 pos, +3 neg | 2=Rarely: +0 pos, +2 neg | 3=Sometimes: +1 pos, +1 neg
    // 4=Often: +2 pos, +0 neg | 5=Love: +3 pos, +0 neg
    const ratingMap: Record<number, { pos: number; neg: number }> = {
        1: { pos: 0, neg: 3 },
        2: { pos: 0, neg: 2 },
        3: { pos: 1, neg: 1 },
        4: { pos: 2, neg: 0 },
        5: { pos: 3, neg: 0 },
    };

    const delta = ratingMap[answer.rating] || { pos: 1, neg: 1 };

    // Fetch existing preference
    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'genre')
        .eq('feature_id', question.genreId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2); // Laplace smoothing

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'genre',
            feature_id: question.genreId,
            feature_name: question.genreName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Update keyword preference based on quiz answer
 */
async function updateKeywordPreference(
    userId: string,
    question: ThemePreferenceQuestion,
    answer: ThemePreferenceAnswer
): Promise<void> {
    if (!supabase) return;

    // Map preference to positive/negative counts
    // yes: +2 pos, +0 neg | maybe: +1 pos, +1 neg | no: +0 pos, +2 neg
    const prefMap: Record<string, { pos: number; neg: number }> = {
        yes: { pos: 2, neg: 0 },
        maybe: { pos: 1, neg: 1 },
        no: { pos: 0, neg: 2 },
    };

    const delta = prefMap[answer.preference] || { pos: 1, neg: 1 };

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', 'keyword')
        .eq('feature_id', question.keywordId)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + delta.pos;
    const negativeCount = (existing?.negative_count || 0) + delta.neg;
    const total = positiveCount + negativeCount;
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: 'keyword',
            feature_id: question.keywordId,
            feature_name: question.keywordName,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}

/**
 * Helper to update a single feature preference
 */
async function updateSingleFeaturePreference(
    userId: string,
    type: string,
    id: number,
    name: string,
    isPositive: boolean
) {
    if (!supabase) return;

    const { data: existing } = await supabase
        .from('user_feature_feedback')
        .select('positive_count, negative_count')
        .eq('user_id', userId)
        .eq('feature_type', type)
        .eq('feature_id', id)
        .maybeSingle();

    const positiveCount = (existing?.positive_count || 0) + (isPositive ? 1 : 0);
    const negativeCount = (existing?.negative_count || 0) + (isPositive ? 0 : 1);
    const total = positiveCount + negativeCount;
    // Bayesian avg with Laplace smoothing
    const inferredPreference = (positiveCount + 1) / (total + 2);

    await supabase
        .from('user_feature_feedback')
        .upsert({
            user_id: userId,
            feature_type: type,
            feature_id: id,
            feature_name: name,
            positive_count: positiveCount,
            negative_count: negativeCount,
            inferred_preference: inferredPreference,
            last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id,feature_type,feature_id' });
}
async function updateMoviePreference(
    userId: string,
    question: MovieRatingQuestion,
    answer: MovieRatingAnswer
): Promise<void> {
    if (!supabase) return;

    // Fetch movie details to get features
    const { data: movieData } = await supabase
        .from('tmdb_movies')
        .select('data')
        .eq('tmdb_id', question.tmdbId)
        .maybeSingle();

    if (!movieData?.data) return;

    const movie = movieData.data as Record<string, unknown>;
    const isPositive = answer.thumbsUp;

    // Update genre preferences
    const genres = (movie.genres as Array<{ id: number; name: string }>) || [];
    for (const genre of genres.slice(0, 3)) {
        await updateSingleFeaturePreference(userId, 'genre', genre.id, genre.name, isPositive);
    }

    // Update keyword preferences
    const keywords = (movie.keywords as { keywords?: Array<{ id: number; name: string }> })?.keywords || [];
    const keywordNames = keywords.map(k => k.name);
    const keywordIds = keywords.map(k => k.id);
    for (const kw of keywords.slice(0, 5)) {
        await updateSingleFeaturePreference(userId, 'keyword', kw.id, kw.name, isPositive);
    }

    // Update subgenre preferences
    const title = (movie.title as string) || '';
    const overview = (movie.overview as string) || '';
    const allText = `${title} ${overview}`.toLowerCase();

    for (const genre of genres) {
        const subs = detectSubgenres(genre.name, allText, keywordNames, keywordIds);
        for (const subKey of subs) {
            const id = stringHash(subKey);
            await updateSingleFeaturePreference(userId, 'subgenre', id, subKey, isPositive);
        }
    }

    // Update actor preferences
    const credits = movie.credits as { cast?: Array<{ id: number; name: string; order: number }>; crew?: Array<{ id: number; name: string; job: string }> } | undefined;
    const cast = (credits?.cast || []).slice(0, 3);
    for (const actor of cast) {
        await updateSingleFeaturePreference(userId, 'actor', actor.id, actor.name, isPositive);
    }

    // Update director preferences
    const directors = (credits?.crew || []).filter(c => c.job === 'Director').slice(0, 2);
    for (const director of directors) {
        await updateSingleFeaturePreference(userId, 'director', director.id, director.name, isPositive);
    }

    // Add to blocked suggestions if thumbs down
    if (!isPositive) {
        await supabase
            .from('blocked_suggestions')
            .upsert({
                user_id: userId,
                tmdb_id: question.tmdbId,
                blocked_at: new Date().toISOString(),
            }, { onConflict: 'user_id,tmdb_id' });
    }
}

/**
 * Get quiz stats for a user
 */
export async function getQuizStats(userId: string): Promise<{
    totalAnswered: number;
    byType: Record<QuizQuestionType, number>;
    lastQuizDate: string | null;
}> {
    if (!supabase) {
        return { totalAnswered: 0, byType: { genre_rating: 0, theme_preference: 0, movie_rating: 0 }, lastQuizDate: null };
    }

    const { data, error } = await supabase
        .from('user_quiz_responses')
        .select('question_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[QuizLearning] Failed to get quiz stats', error);
        return { totalAnswered: 0, byType: { genre_rating: 0, theme_preference: 0, movie_rating: 0 }, lastQuizDate: null };
    }

    const byType: Record<QuizQuestionType, number> = {
        genre_rating: 0,
        theme_preference: 0,
        movie_rating: 0,
    };

    for (const row of data || []) {
        const type = row.question_type as QuizQuestionType;
        if (byType[type] !== undefined) {
            byType[type]++;
        }
    }

    return {
        totalAnswered: data?.length || 0,
        byType,
        lastQuizDate: data?.[0]?.created_at || null,
    };
}

/**
 * Seed user preferences from import history
 * This should run ONCE after import to pre-populate user_feature_feedback
 * based on the user's watch history (ratings, likes, rewatches)
 * 
 * Weight calculation:
 * - Highly rated (4.5-5 stars) or liked + rewatch: +3 positive
 * - Good rating (3.5-4 stars) or liked: +2 positive
 * - Average (3 stars): +1 positive
 * - Low rating (1-2 stars): +2 negative
 * - Very low rating (0.5-1 stars): +3 negative
 */
export async function seedPreferencesFromHistory(
    userId: string,
    films: Array<{
        tmdbId: number;
        rating?: number;
        liked?: boolean;
        rewatch?: boolean;
    }>,
    onProgress?: (current: number, total: number) => void
): Promise<{
    success: boolean;
    genresSeeded: number;
    keywordsSeeded: number;
    actorsSeeded: number;
    directorsSeeded: number;
    subgenresSeeded: number;
}> {
    if (!supabase) {
        return { success: false, genresSeeded: 0, keywordsSeeded: 0, actorsSeeded: 0, directorsSeeded: 0, subgenresSeeded: 0 };
    }

    console.log('[SeedPreferences] Starting preference seeding', { userId: userId.slice(0, 8), filmCount: films.length });

    // Aggregate feature weights
    const genreWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const keywordWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const actorWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const directorWeights = new Map<number, { name: string; positive: number; negative: number }>();
    const subgenreWeights = new Map<number, { name: string; positive: number; negative: number }>();

    // Helper to generate a stable numeric ID from a string key (for subgenres)
    // We define it here to avoid polluting module scope if only used here
    // const stringHash = (str: string): number => { ... } // REMOVED local definition

    // Get weight delta based on rating/like/rewatch
    const getWeightDelta = (film: typeof films[0]): { pos: number; neg: number } => {
        const rating = film.rating ?? 0;
        const hasRating = rating > 0;

        // Liked + rewatch = strong positive
        if (film.liked && film.rewatch) return { pos: 3, neg: 0 };

        // Very high rating (4.5-5)
        if (hasRating && rating >= 4.5) return { pos: 3, neg: 0 };

        // Good rating (3.5-4.5) or liked
        if ((hasRating && rating >= 3.5) || film.liked) return { pos: 2, neg: 0 };

        // Average (3)
        if (hasRating && rating >= 3) return { pos: 1, neg: 0 };

        // Low rating (1.5-2.5)
        if (hasRating && rating >= 1.5) return { pos: 0, neg: 2 };

        // Very low rating (0.5-1)
        if (hasRating && rating >= 0.5) return { pos: 0, neg: 3 };

        // No rating, no like - neutral, skip
        return { pos: 0, neg: 0 };
    };

    // Process each film
    let processed = 0;
    for (const film of films) {
        const delta = getWeightDelta(film);
        if (delta.pos === 0 && delta.neg === 0) {
            processed++;
            continue; // Skip films with no signal
        }

        // Fetch movie features from cache
        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('data')
            .eq('tmdb_id', film.tmdbId)
            .maybeSingle();

        if (!movieData?.data) {
            processed++;
            continue;
        }

        const movie = movieData.data as Record<string, unknown>;

        // Extract genres
        const genres = (movie.genres as Array<{ id: number; name: string }>) || [];
        for (const genre of genres.slice(0, 3)) {
            const existing = genreWeights.get(genre.id) || { name: genre.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            genreWeights.set(genre.id, existing);
        }

        // Extract keywords
        const keywords = (movie.keywords as { keywords?: Array<{ id: number; name: string }> })?.keywords || [];
        const keywordNames = keywords.map(k => k.name);
        const keywordIds = keywords.map(k => k.id);

        for (const kw of keywords.slice(0, 5)) {
            const existing = keywordWeights.get(kw.id) || { name: kw.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            keywordWeights.set(kw.id, existing);
        }

        // Extract and process SUBGENRES
        const title = (movie.title as string) || '';
        const overview = (movie.overview as string) || '';
        const allText = `${title} ${overview}`.toLowerCase();

        for (const genre of genres) {
            const subs = detectSubgenres(genre.name, allText, keywordNames, keywordIds);
            subs.forEach(subKey => {
                // Use hash for ID, but store Key as name
                const id = stringHash(subKey);
                const existing = subgenreWeights.get(id) || { name: subKey, positive: 0, negative: 0 };
                existing.positive += delta.pos;
                existing.negative += delta.neg;
                subgenreWeights.set(id, existing);
            });
        }

        // Extract cast (top 3 actors)
        const credits = movie.credits as { cast?: Array<{ id: number; name: string; order: number }>; crew?: Array<{ id: number; name: string; job: string }> } | undefined;
        const cast = (credits?.cast || []).slice(0, 3);
        for (const actor of cast) {
            const existing = actorWeights.get(actor.id) || { name: actor.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            actorWeights.set(actor.id, existing);
        }

        // Extract directors
        const directors = (credits?.crew || []).filter(c => c.job === 'Director').slice(0, 2);
        for (const director of directors) {
            const existing = directorWeights.get(director.id) || { name: director.name, positive: 0, negative: 0 };
            existing.positive += delta.pos;
            existing.negative += delta.neg;
            directorWeights.set(director.id, existing);
        }

        processed++;
        if (onProgress && processed % 50 === 0) {
            onProgress(processed, films.length);
        }
    }

    console.log('[SeedPreferences] Aggregated weights', {
        genres: genreWeights.size,
        keywords: keywordWeights.size,
        actors: actorWeights.size,
        directors: directorWeights.size,
        subgenres: subgenreWeights.size,
    });

    // Upsert to user_feature_feedback
    const upsertFeatures = async (
        type: string,
        weights: Map<number, { name: string; positive: number; negative: number }>
    ): Promise<number> => {
        let count = 0;
        const updates = [];
        for (const [id, data] of weights.entries()) {
            // Only seed if there's significant signal (2+ interactions)
            if (data.positive + data.negative < 2) continue;

            const total = data.positive + data.negative;
            const inferredPreference = (data.positive + 1) / (total + 2); // Laplace smoothing

            updates.push({
                user_id: userId,
                feature_type: type,
                feature_id: id,
                feature_name: data.name,
                positive_count: data.positive,
                negative_count: data.negative,
                inferred_preference: inferredPreference,
                last_updated: new Date().toISOString(),
            });

            if (updates.length >= 50) {
                if (supabase) {
                    await supabase.from('user_feature_feedback').upsert(updates, { onConflict: 'user_id,feature_type,feature_id' });
                }
                count += updates.length;
                updates.length = 0;
            }
        }

        if (updates.length > 0 && supabase) {
            await supabase.from('user_feature_feedback').upsert(updates, { onConflict: 'user_id,feature_type,feature_id' });
            count += updates.length;
        }
        return count;
    };

    const genresSeeded = await upsertFeatures('genre', genreWeights);
    const keywordsSeeded = await upsertFeatures('keyword', keywordWeights);
    const actorsSeeded = await upsertFeatures('actor', actorWeights);
    const directorsSeeded = await upsertFeatures('director', directorWeights);
    const subgenresSeeded = await upsertFeatures('subgenre', subgenreWeights);

    console.log('[SeedPreferences] Seeding complete', {
        userId: userId.slice(0, 8),
        genresSeeded,
        keywordsSeeded,
        actorsSeeded,
        directorsSeeded,
        subgenresSeeded
    });

    return { success: true, genresSeeded, keywordsSeeded, actorsSeeded, directorsSeeded, subgenresSeeded };
}
