'use server';

import { aggregateRecommendations, type AggregatedRecommendation } from '@/lib/recommendationAggregator';

/**
 * Server Action to fetch aggregated recommendations
 * This runs on the server to securely access API keys for TasteDive, Watchmode, etc.
 */
export async function getAggregatedRecommendations(params: {
    seedMovies: Array<{ tmdbId: number; title: string; imdbId?: string }>;
    limit?: number;
}): Promise<AggregatedRecommendation[]> {
    try {
        console.log('[RecommendationsAction] Fetching aggregated recommendations', { seedCount: params.seedMovies.length });
        return await aggregateRecommendations(params);
    } catch (error) {
        console.error('[RecommendationsAction] Failed to fetch recommendations:', error);
        return [];
    }
}
