
import { suggestByOverlap } from '../src/lib/enrich';

// Mock global fetch
global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = url.toString();
    const idMatch = u.match(/id=(\d+)/);
    const id = idMatch ? parseInt(idMatch[1]) : 0;

    return {
        ok: true,
        json: async () => ({
            ok: true,
            movie: {
                id,
                title: `Movie ${id}`,
                release_date: '2023-01-01',
                genres: [{ name: 'Action' }],
                vote_average: 7.5,
                vote_count: 100,
                keywords: { keywords: [] },
                credits: { crew: [], cast: [] },
                videos: { results: [] },
                images: { posters: [] },
                external_ids: {},
                production_companies: []
            }
        })
    } as Response;
};

async function runTest() {
    console.log('Starting algorithm verification...');

    const userId = 'test-user';
    const feedbackMap = new Map<number, 'negative' | 'positive'>();
    feedbackMap.set(101, 'negative'); // Should be excluded
    feedbackMap.set(102, 'positive'); // Should be boosted

    const candidates = [101, 102, 103];
    const mappings = new Map<string, number>();

    // Mock user library
    const films = [
        { uri: 'film1', title: 'Liked Movie', liked: true, rating: 5, year: 2020 }
    ];
    mappings.set('film1', 201);

    console.log('Candidates:', candidates);
    console.log('Feedback:', Object.fromEntries(feedbackMap));

    try {
        const results = await suggestByOverlap({
            userId,
            films,
            mappings,
            candidates,
            feedbackMap,
            maxCandidates: 10,
            concurrency: 1,
            desiredResults: 10
        });

        console.log('Results:', results.map(r => ({ id: r.tmdbId, score: r.score, title: r.title })));

        const hasNegative = results.some(r => r.tmdbId === 101);
        const hasPositive = results.some(r => r.tmdbId === 102);
        const hasNeutral = results.some(r => r.tmdbId === 103);

        if (hasNegative) {
            console.error('FAIL: Candidate 101 (negative) was NOT excluded.');
        } else {
            console.log('PASS: Candidate 101 (negative) was excluded.');
        }

        if (hasPositive) {
            console.log('PASS: Candidate 102 (positive) is present.');
        } else {
            console.error('FAIL: Candidate 102 (positive) is missing.');
        }

        if (hasNeutral) {
            console.log('PASS: Candidate 103 (neutral) is present.');
        } else {
            console.error('FAIL: Candidate 103 (neutral) is missing.');
        }

    } catch (e) {
        console.error('Error running test:', e);
    }
}

runTest();
