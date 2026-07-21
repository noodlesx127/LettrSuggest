type GenerateRequestSeedInput = {
  userId: string;
  seedTmdbIds: readonly number[];
  limit: number;
  excludeTmdbIds: readonly number[];
  genreIds?: readonly number[];
};

function canonicalizeIds(ids: readonly number[] | undefined): number[] {
  return Array.from(new Set(ids ?? [])).sort((left, right) => left - right);
}

export function deriveGenerateRequestSeed(
  input: GenerateRequestSeedInput,
): string {
  const canonicalInputs = JSON.stringify({
    userId: input.userId,
    seed_tmdb_ids: canonicalizeIds(input.seedTmdbIds),
    limit: input.limit,
    exclude_tmdb_ids: canonicalizeIds(input.excludeTmdbIds),
    genre_ids: (() => {
      const genreIds = canonicalizeIds(input.genreIds);
      return genreIds.length > 0 ? genreIds : null;
    })(),
  });
  let hash = 2166136261;

  for (let index = 0; index < canonicalInputs.length; index += 1) {
    hash ^= canonicalInputs.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

export function filterGeneratedCandidateIds(params: {
  candidateIds: readonly number[];
  seedTmdbIds: readonly number[];
  excludeTmdbIds: readonly number[];
  blockedIds: ReadonlySet<number>;
}): number[] {
  const excludedIds = new Set<number>([
    ...params.seedTmdbIds,
    ...params.excludeTmdbIds,
    ...params.blockedIds,
  ]);

  return params.candidateIds.filter((id) => !excludedIds.has(id));
}
