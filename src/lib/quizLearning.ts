/**
 * Quiz Learning System
 * Generates quiz questions and processes answers to strengthen preference learning
 */

import { supabase } from './supabaseClient';

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
 */
async function getCandidateMovies(userId: string, answered: Set<string>): Promise<MovieRatingQuestion[]> {
    if (!supabase) return [];

    try {
        // Get popular movies from TMDB cache that user hasn't watched
        const { data: watchedData } = await supabase
            .from('film_tmdb_map')
            .select('tmdb_id')
            .eq('user_id', userId);

        const watchedIds = new Set((watchedData || []).map(r => r.tmdb_id));

        // Get some movies from TMDB trending/popular
        const { data: trendingData } = await supabase
            .from('tmdb_trending')
            .select('tmdb_id')
            .eq('period', 'week')
            .limit(100);

        const candidateIds = (trendingData || [])
            .map(r => r.tmdb_id)
            .filter(id => !watchedIds.has(id) && !answered.has(`movie:${id}`));

        if (candidateIds.length === 0) return [];

        // Fetch movie details
        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', candidateIds.slice(0, 20));

        return (movieData || []).map(row => {
            const movie = row.data as Record<string, unknown>;
            return {
                type: 'movie_rating' as const,
                tmdbId: row.tmdb_id,
                title: (movie.title as string) || 'Unknown',
                year: movie.release_date ? String(movie.release_date).slice(0, 4) : undefined,
                posterPath: movie.poster_path as string | null,
                overview: movie.overview as string | undefined,
                genres: ((movie.genres as Array<{ name: string }>) || []).map(g => g.name),
            };
        });
    } catch (e) {
        console.error('[QuizLearning] Failed to get candidate movies', e);
        return [];
    }
}

/**
 * Generate a batch of quiz questions for a session
 */
export async function generateQuizQuestions(
    userId: string,
    count: number = 10
): Promise<QuizQuestion[]> {
    const answered = await getAnsweredQuestions(userId);
    const questions: QuizQuestion[] = [];

    // Get unanswered genres
    const unansweredGenres = QUIZ_GENRES.filter(g => !answered.has(`genre:${g.id}`));

    // Get unanswered keywords
    const unansweredKeywords = QUIZ_KEYWORDS.filter(k => !answered.has(`keyword:${k.id}`));

    // Get candidate movies
    const candidateMovies = await getCandidateMovies(userId, answered);

    // Shuffle all pools
    const shuffledGenres = [...unansweredGenres].sort(() => Math.random() - 0.5);
    const shuffledKeywords = [...unansweredKeywords].sort(() => Math.random() - 0.5);
    const shuffledMovies = [...candidateMovies].sort(() => Math.random() - 0.5);

    // Build question list with mixed types
    let genreIdx = 0, keywordIdx = 0, movieIdx = 0;

    // Distribute roughly evenly: 3-4 of each type for 10 questions
    const typeRotation: QuizQuestionType[] = [
        'genre_rating', 'theme_preference', 'movie_rating',
        'genre_rating', 'theme_preference', 'movie_rating',
        'genre_rating', 'theme_preference', 'movie_rating',
        'genre_rating',
    ];

    for (let i = 0; i < count && i < typeRotation.length; i++) {
        const type = typeRotation[i];

        if (type === 'genre_rating' && genreIdx < shuffledGenres.length) {
            const genre = shuffledGenres[genreIdx++];
            questions.push({ type: 'genre_rating', genreId: genre.id, genreName: genre.name });
        } else if (type === 'theme_preference' && keywordIdx < shuffledKeywords.length) {
            const keyword = shuffledKeywords[keywordIdx++];
            questions.push({ type: 'theme_preference', keywordId: keyword.id, keywordName: keyword.name });
        } else if (type === 'movie_rating' && movieIdx < shuffledMovies.length) {
            questions.push(shuffledMovies[movieIdx++]);
        } else {
            // Fallback: try other types
            if (genreIdx < shuffledGenres.length) {
                const genre = shuffledGenres[genreIdx++];
                questions.push({ type: 'genre_rating', genreId: genre.id, genreName: genre.name });
            } else if (keywordIdx < shuffledKeywords.length) {
                const keyword = shuffledKeywords[keywordIdx++];
                questions.push({ type: 'theme_preference', keywordId: keyword.id, keywordName: keyword.name });
            } else if (movieIdx < shuffledMovies.length) {
                questions.push(shuffledMovies[movieIdx++]);
            }
        }
    }

    console.log('[QuizLearning] Generated questions', {
        count: questions.length,
        types: questions.map(q => q.type)
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
 * Update movie preference based on thumbs up/down
 * This also updates feature preferences for the movie's genres, actors, keywords
 */
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
        const { data: existing } = await supabase
            .from('user_feature_feedback')
            .select('positive_count, negative_count')
            .eq('user_id', userId)
            .eq('feature_type', 'genre')
            .eq('feature_id', genre.id)
            .maybeSingle();

        const positiveCount = (existing?.positive_count || 0) + (isPositive ? 1 : 0);
        const negativeCount = (existing?.negative_count || 0) + (isPositive ? 0 : 1);
        const total = positiveCount + negativeCount;
        const inferredPreference = (positiveCount + 1) / (total + 2);

        await supabase
            .from('user_feature_feedback')
            .upsert({
                user_id: userId,
                feature_type: 'genre',
                feature_id: genre.id,
                feature_name: genre.name,
                positive_count: positiveCount,
                negative_count: negativeCount,
                inferred_preference: inferredPreference,
                last_updated: new Date().toISOString(),
            }, { onConflict: 'user_id,feature_type,feature_id' });
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
