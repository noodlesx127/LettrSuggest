'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    generateQuizQuestions,
    recordQuizAnswer,
    getQuizStats,
    type QuizQuestion,
    type GenreRatingQuestion,
    type ThemePreferenceQuestion,
    type MovieRatingQuestion,
    type SubgenrePreferenceQuestion,
    type ActorPreferenceQuestion,
    type DirectorPreferenceQuestion,
    type EraPreferenceQuestion,
    type GenreRatingAnswer,
    type ThemePreferenceAnswer,
    type MovieRatingAnswer,
    type SubgenrePreferenceAnswer,
    type PersonPreferenceAnswer,
    type EraPreferenceAnswer,
} from '@/lib/quizLearning';


interface UserQuizProps {
    userId: string;
    isOpen: boolean;
    onClose: () => void;
}

const QUESTIONS_PER_SESSION = 10;

export default function UserQuiz({ userId, isOpen, onClose }: UserQuizProps) {
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [stats, setStats] = useState<{ totalAnswered: number } | null>(null);

    // Load questions when modal opens
    useEffect(() => {
        if (isOpen && userId) {
            setLoading(true);
            setCompleted(false);
            setCurrentIndex(0);

            Promise.all([
                generateQuizQuestions(userId, QUESTIONS_PER_SESSION),
                getQuizStats(userId),
            ]).then(([q, s]) => {
                setQuestions(q);
                setStats(s);
                setLoading(false);
            }).catch((e) => {
                console.error('[UserQuiz] Failed to load questions', e);
                setLoading(false);
            });
        }
    }, [isOpen, userId]);

    const currentQuestion = questions[currentIndex];
    const progress = questions.length > 0 ? ((currentIndex) / questions.length) * 100 : 0;

    const handleAnswer = useCallback(async (answer: GenreRatingAnswer | ThemePreferenceAnswer | MovieRatingAnswer | SubgenrePreferenceAnswer | PersonPreferenceAnswer | EraPreferenceAnswer) => {
        if (!currentQuestion || submitting) return;

        setSubmitting(true);
        try {
            await recordQuizAnswer(userId, currentQuestion, answer);

            if (currentIndex + 1 >= questions.length) {
                setCompleted(true);
                // Refresh stats
                const newStats = await getQuizStats(userId);
                setStats(newStats);
            } else {
                setCurrentIndex(prev => prev + 1);
            }
        } catch (e) {
            console.error('[UserQuiz] Failed to record answer', e);
        } finally {
            setSubmitting(false);
        }
    }, [currentQuestion, currentIndex, questions.length, userId, submitting]);

    const handleSkip = useCallback(() => {
        if (currentIndex + 1 >= questions.length) {
            setCompleted(true);
        } else {
            setCurrentIndex(prev => prev + 1);
        }
    }, [currentIndex, questions.length]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full overflow-hidden transition-all ${currentQuestion?.type === 'movie_rating' ? 'max-w-2xl' : 'max-w-lg'}`}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">🎯</span>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Taste Quiz</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Help us learn your preferences
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
                        aria-label="Close quiz"
                    >
                        ✕
                    </button>
                </div>

                {/* Progress bar */}
                {!loading && !completed && questions.length > 0 && (
                    <div className="px-6 pt-4">
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
                            <span>Question {currentIndex + 1} of {questions.length}</span>
                            <span>{Math.round(progress)}% complete</span>
                        </div>
                        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="p-6 min-h-[300px] flex flex-col">
                    {loading ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4">
                            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-sm text-gray-500 dark:text-gray-400">Loading questions...</p>
                        </div>
                    ) : completed ? (
                        <CompletedView stats={stats} onClose={onClose} />
                    ) : questions.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                            <span className="text-4xl">🎉</span>
                            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">All caught up!</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                You&apos;ve answered all available quiz questions. Check back later for more!
                            </p>
                            <button
                                onClick={onClose}
                                className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    ) : currentQuestion?.type === 'genre_rating' ? (
                        <GenreRatingView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : currentQuestion?.type === 'theme_preference' ? (
                        <ThemePreferenceView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : currentQuestion?.type === 'movie_rating' ? (
                        <MovieRatingView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : currentQuestion?.type === 'subgenre_preference' ? (
                        <SubgenrePreferenceView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : currentQuestion?.type === 'actor_preference' ? (
                        <ActorPreferenceView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : currentQuestion?.type === 'director_preference' ? (
                        <DirectorPreferenceView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : currentQuestion?.type === 'era_preference' ? (
                        <EraPreferenceView
                            question={currentQuestion}
                            onAnswer={handleAnswer}
                            onSkip={handleSkip}
                            submitting={submitting}
                        />
                    ) : null}
                </div>

                {/* Footer with stats */}
                {stats && !loading && (
                    <div className="px-6 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                            📊 You&apos;ve answered {stats.totalAnswered} quiz question{stats.totalAnswered !== 1 ? 's' : ''} total
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

// Completed view
function CompletedView({ stats, onClose }: { stats: { totalAnswered: number } | null; onClose: () => void }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <span className="text-5xl">✨</span>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">Quiz Complete!</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm">
                Thanks for helping us understand your taste better. Your suggestions will now be more personalized!
            </p>
            {stats && (
                <div className="mt-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                        🎯 Total questions answered: <strong>{stats.totalAnswered}</strong>
                    </p>
                </div>
            )}
            <button
                onClick={onClose}
                className="mt-4 px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg"
            >
                Done
            </button>
        </div>
    );
}

// Genre Rating Question View
function GenreRatingView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: GenreRatingQuestion;
    onAnswer: (answer: GenreRatingAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const ratings = [
        { value: 1 as const, label: 'Never', emoji: '😴', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' },
        { value: 2 as const, label: 'Rarely', emoji: '😕', color: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/60' },
        { value: 3 as const, label: 'Sometimes', emoji: '😐', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60' },
        { value: 4 as const, label: 'Often', emoji: '😊', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60' },
        { value: 5 as const, label: 'Love it!', emoji: '😍', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60' },
    ];

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Genre Preference</p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    How much do you enjoy <span className="text-blue-600 dark:text-blue-400">{question.genreName}</span> movies?
                </h3>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-3">
                {ratings.map(({ value, label, emoji, color }) => (
                    <button
                        key={value}
                        onClick={() => onAnswer({ rating: value })}
                        disabled={submitting}
                        className={`w-full px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${color} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="text-2xl">{emoji}</span>
                        <span className="flex-1 text-left">{label}</span>
                    </button>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}

// Theme Preference Question View
function ThemePreferenceView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: ThemePreferenceQuestion;
    onAnswer: (answer: ThemePreferenceAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const options = [
        { value: 'yes' as const, label: 'Yes, I love it!', emoji: '👍', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60' },
        { value: 'maybe' as const, label: 'Sometimes', emoji: '🤔', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60' },
        { value: 'no' as const, label: 'Not really', emoji: '👎', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' },
    ];

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Theme Preference</p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Are you interested in movies about{' '}
                    <span className="text-purple-600 dark:text-purple-400">{question.keywordName}</span>?
                </h3>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
                {options.map(({ value, label, emoji, color }) => (
                    <button
                        key={value}
                        onClick={() => onAnswer({ preference: value })}
                        disabled={submitting}
                        className={`w-full px-6 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-3 text-lg ${color} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="text-2xl">{emoji}</span>
                        <span>{label}</span>
                    </button>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}

// Movie Rating Question View - Enhanced with trailer
function MovieRatingView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: MovieRatingQuestion;
    onAnswer: (answer: MovieRatingAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const [showTrailer, setShowTrailer] = useState(false);

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Movie Interest</p>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Would you want to watch this movie?
                </h3>
            </div>

            {/* Movie card - enhanced layout */}
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl mb-4 overflow-hidden">
                {/* Trailer or Poster Header */}
                {showTrailer && question.trailerKey ? (
                    <div className="relative aspect-video w-full bg-black">
                        <iframe
                            className="w-full h-full"
                            src={`https://www.youtube.com/embed/${question.trailerKey}?autoplay=1`}
                            title={`${question.title} Trailer`}
                            allowFullScreen
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                        <button
                            onClick={() => setShowTrailer(false)}
                            className="absolute top-2 right-2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center text-white hover:bg-black/90 transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                ) : question.posterPath ? (
                    <div className="relative">
                        <div className="flex">
                            {/* Large Poster */}
                            <div className="w-1/3 flex-shrink-0">
                                <img
                                    src={`https://image.tmdb.org/t/p/w342${question.posterPath}`}
                                    alt={question.title}
                                    className="w-full h-auto"
                                />
                            </div>
                            {/* Info */}
                            <div className="flex-1 p-4 flex flex-col">
                                <h4 className="font-bold text-gray-900 dark:text-gray-100 text-xl leading-tight">
                                    {question.title}
                                </h4>
                                {question.year && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{question.year}</p>
                                )}
                                {question.genres && question.genres.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {question.genres.slice(0, 4).map((genre, i) => (
                                            <span
                                                key={i}
                                                className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full"
                                            >
                                                {genre}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {question.overview && (
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 line-clamp-5">
                                        {question.overview}
                                    </p>
                                )}
                                {question.trailerKey && (
                                    <button
                                        onClick={() => setShowTrailer(true)}
                                        className="mt-auto pt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5"
                                    >
                                        <span>▶</span>
                                        <span>Watch Trailer</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-4">
                        <h4 className="font-bold text-gray-900 dark:text-gray-100 text-xl">
                            {question.title}
                        </h4>
                        {question.year && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{question.year}</p>
                        )}
                        {question.overview && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
                                {question.overview}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Thumbs up/down buttons */}
            <div className="flex gap-4 mt-auto">
                <button
                    onClick={() => onAnswer({ thumbsUp: false })}
                    disabled={submitting}
                    className={`flex-1 px-6 py-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <span className="text-3xl">👎</span>
                    <span>Not interested</span>
                </button>
                <button
                    onClick={() => onAnswer({ thumbsUp: true })}
                    disabled={submitting}
                    className={`flex-1 px-6 py-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-2 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60 ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <span className="text-3xl">👍</span>
                    <span>I&apos;d watch this</span>
                </button>
            </div>

            <div className="mt-4 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}

// Subgenre Preference Question View
function SubgenrePreferenceView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: SubgenrePreferenceQuestion;
    onAnswer: (answer: SubgenrePreferenceAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const options = [
        { value: 'love' as const, label: 'Love it!', emoji: '😍', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60' },
        { value: 'like' as const, label: 'I enjoy these', emoji: '👍', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60' },
        { value: 'neutral' as const, label: 'Depends on the movie', emoji: '🤔', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60' },
        { value: 'dislike' as const, label: 'Not for me', emoji: '👎', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' },
    ];

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    {question.parentGenreName} Sub-genre
                </p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    How do you feel about{' '}
                    <span className="text-purple-600 dark:text-purple-400">{question.subgenreName}</span>?
                </h3>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-3">
                {options.map(({ value, label, emoji, color }) => (
                    <button
                        key={value}
                        onClick={() => onAnswer({ preference: value })}
                        disabled={submitting}
                        className={`w-full px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${color} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="text-2xl">{emoji}</span>
                        <span className="flex-1 text-left">{label}</span>
                    </button>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}

// Actor Preference Question View
function ActorPreferenceView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: ActorPreferenceQuestion;
    onAnswer: (answer: PersonPreferenceAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const options = [
        { value: 'fan' as const, label: 'I&apos;m a fan!', emoji: '⭐', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60' },
        { value: 'neutral' as const, label: 'Neutral', emoji: '😐', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60' },
        { value: 'avoid' as const, label: 'I avoid their movies', emoji: '🚫', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' },
    ];

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Actor Preference</p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    What do you think of{' '}
                    <span className="text-blue-600 dark:text-blue-400">{question.actorName}</span>?
                </h3>
                {question.knownFor && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        Known for: {question.knownFor}
                    </p>
                )}
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
                {options.map(({ value, label, emoji, color }) => (
                    <button
                        key={value}
                        onClick={() => onAnswer({ preference: value })}
                        disabled={submitting}
                        className={`w-full px-6 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-3 text-lg ${color} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="text-2xl">{emoji}</span>
                        <span>{label}</span>
                    </button>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}

// Director Preference Question View
function DirectorPreferenceView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: DirectorPreferenceQuestion;
    onAnswer: (answer: PersonPreferenceAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const options = [
        { value: 'fan' as const, label: 'Love their work!', emoji: '🎬', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60' },
        { value: 'neutral' as const, label: 'Haven&apos;t noticed', emoji: '😐', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60' },
        { value: 'avoid' as const, label: 'Not my style', emoji: '🚫', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' },
    ];

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Director Preference</p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    How do you feel about{' '}
                    <span className="text-orange-600 dark:text-orange-400">{question.directorName}</span>?
                </h3>
                {question.knownFor && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        Known for: {question.knownFor}
                    </p>
                )}
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
                {options.map(({ value, label, emoji, color }) => (
                    <button
                        key={value}
                        onClick={() => onAnswer({ preference: value })}
                        disabled={submitting}
                        className={`w-full px-6 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-3 text-lg ${color} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="text-2xl">{emoji}</span>
                        <span>{label}</span>
                    </button>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}

// Era Preference Question View
function EraPreferenceView({
    question,
    onAnswer,
    onSkip,
    submitting,
}: {
    question: EraPreferenceQuestion;
    onAnswer: (answer: EraPreferenceAnswer) => void;
    onSkip: () => void;
    submitting: boolean;
}) {
    const options = [
        { value: 'love' as const, label: 'Love this era!', emoji: '❤️', color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60' },
        { value: 'like' as const, label: 'Enjoy it', emoji: '👍', color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60' },
        { value: 'neutral' as const, label: 'No preference', emoji: '😐', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/60' },
        { value: 'dislike' as const, label: 'Not my era', emoji: '👎', color: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60' },
    ];

    return (
        <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Decade Preference</p>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    How do you feel about{' '}
                    <span className="text-pink-600 dark:text-pink-400">{question.eraName}</span> movies?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 italic">
                    {question.eraDescription}
                </p>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-3">
                {options.map(({ value, label, emoji, color }) => (
                    <button
                        key={value}
                        onClick={() => onAnswer({ preference: value })}
                        disabled={submitting}
                        className={`w-full px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${color} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="text-2xl">{emoji}</span>
                        <span className="flex-1 text-left">{label}</span>
                    </button>
                ))}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSkip}
                    disabled={submitting}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                >
                    Skip this question
                </button>
            </div>
        </div>
    );
}
