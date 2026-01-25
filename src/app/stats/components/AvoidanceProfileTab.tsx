"use client";

import { useMemo } from "react";

import type { StatsTabProps, TMDBDetails } from "@/app/stats/types";
import { useStatsData } from "@/app/stats/hooks/useStatsData";
import { useTasteProfile } from "@/app/stats/hooks/useTasteProfile";
import type { Person } from "@/app/stats/components/shared/PersonGrid";
import type { Tag } from "@/app/stats/components/shared/TagCloud";
import { PersonGrid } from "@/app/stats/components/shared/PersonGrid";
import { SectionCard } from "@/app/stats/components/shared/SectionCard";
import { StatCard } from "@/app/stats/components/shared/StatCard";
import { TagCloud } from "@/app/stats/components/shared/TagCloud";
import { Body, Heading } from "@/components/ui";
import type { FilmEvent } from "@/lib/normalize";

type WeightedItem = { id: number; name: string; weight: number };
type MixedItem = { id: number; name: string; liked: number; disliked: number };

type RuntimeStats = {
  totalFilms: number;
  average: number;
  median: number;
  min: number;
  max: number;
  p20: number;
  p80: number;
  tooShort: number;
  tooLong: number;
  buckets: Record<"Short" | "Standard" | "Long" | "Epic", number>;
};

type AvoidanceMetrics = {
  likedFilmsCount: number;
  dislikedFilmsCount: number;
  avoidedGenres: WeightedItem[];
  avoidedKeywords: WeightedItem[];
  avoidedDirectors: WeightedItem[];
  avoidedActors: Person[];
  mixedGenres: MixedItem[];
  mixedKeywords: MixedItem[];
  mixedDirectors: MixedItem[];
  avoidedGenreTags: Tag[];
  avoidedKeywordTags: Tag[];
  lowExposureGenres: Tag[];
  lowExposureLanguages: Tag[];
  lowExposureCountries: Tag[];
  lowExposureDecades: Tag[];
  runtimeStats: RuntimeStats | null;
  hasAvoidanceSignal: boolean;
};

type TMDBExtended = TMDBDetails & {
  runtime?: number;
  spoken_languages?: Array<{ name?: string | null }>;
  production_countries?: Array<{ name?: string | null }>;
};

const getRuntimeBucket = (runtime: number) => {
  if (runtime <= 90) return "Short" as const;
  if (runtime <= 120) return "Standard" as const;
  if (runtime <= 150) return "Long" as const;
  return "Epic" as const;
};

const buildWeightedTags = (items: WeightedItem[], maxTags: number): Tag[] => {
  if (items.length === 0) return [];
  const sorted = [...items]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxTags);
  const maxWeight = sorted[0]?.weight ?? 0;
  return sorted.map((item) => ({
    label: item.name,
    weight: maxWeight > 0 ? item.weight / maxWeight : 0,
  }));
};

const buildInverseTags = (
  counts: Map<string, number>,
  maxTags: number,
): Tag[] => {
  if (counts.size === 0) return [];
  const sorted = [...counts.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, maxTags);
  const maxCount = Math.max(...counts.values());
  return sorted.map(([label, count]) => ({
    label,
    count,
    weight: maxCount > 0 ? 1 - count / maxCount : 0,
  }));
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * p)),
  );
  return sorted[index] ?? 0;
};

const isLikedFilm = (film: FilmEvent) =>
  Boolean(film.liked) || (film.rating != null && film.rating >= 3);

const isDislikedFilm = (film: FilmEvent) =>
  film.rating != null && film.rating <= 1.5 && !film.liked;

export default function AvoidanceProfileTab({
  timeFilter,
  filteredFilms,
  uid,
}: StatsTabProps) {
  const { tmdbDetails, filmMappings, isLoading, error } = useStatsData(
    uid,
    filteredFilms,
  );

  const watchlistFilms = useMemo(
    () => filteredFilms.filter((film) => film.onWatchlist),
    [filteredFilms],
  );

  const {
    tasteProfile,
    isLoading: isTasteLoading,
    error: tasteError,
  } = useTasteProfile(
    filteredFilms,
    tmdbDetails,
    uid,
    filmMappings,
    watchlistFilms,
  );

  const avoidanceMetrics = useMemo<AvoidanceMetrics>(() => {
    const likedFilmsCount = filteredFilms.filter(isLikedFilm).length;
    const dislikedFilmsCount = filteredFilms.filter(isDislikedFilm).length;

    const avoidedGenres = tasteProfile?.avoidGenres ?? [];
    const avoidedKeywords = tasteProfile?.avoidKeywords ?? [];
    const avoidedDirectors = tasteProfile?.avoidDirectors ?? [];
    const mixedGenres = tasteProfile?.mixedGenres ?? [];
    const mixedKeywords = tasteProfile?.mixedKeywords ?? [];
    const mixedDirectors = tasteProfile?.mixedDirectors ?? [];

    const avoidedGenreTags = buildWeightedTags(avoidedGenres, 12);
    const avoidedKeywordTags = buildWeightedTags(avoidedKeywords, 12);

    const genreCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();
    const decadeCounts = new Map<string, number>();

    const actorStats = new Map<
      number,
      {
        name: string;
        liked: number;
        disliked: number;
        profilePath?: string | null;
      }
    >();

    const recordPerson = (
      person: { id: number; name: string; profile_path?: string | null },
      liked: boolean,
      disliked: boolean,
    ) => {
      const current = actorStats.get(person.id) ?? {
        name: person.name,
        liked: 0,
        disliked: 0,
        profilePath: person.profile_path ?? null,
      };
      if (liked) current.liked += 1;
      if (disliked) current.disliked += 1;
      if (!current.profilePath && person.profile_path) {
        current.profilePath = person.profile_path;
      }
      actorStats.set(person.id, current);
    };

    const runtimes: number[] = [];

    filteredFilms.forEach((film) => {
      const tmdbId = filmMappings.get(film.uri);
      if (!tmdbId) return;
      const details = tmdbDetails.get(tmdbId) as TMDBExtended | undefined;
      if (!details) return;

      const liked = isLikedFilm(film);
      const disliked = isDislikedFilm(film);

      details.genres?.forEach((genre) => {
        genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
      });

      details.spoken_languages?.forEach((language) => {
        const label = language.name?.trim();
        if (!label) return;
        languageCounts.set(label, (languageCounts.get(label) ?? 0) + 1);
      });

      details.production_countries?.forEach((country) => {
        const label = country.name?.trim();
        if (!label) return;
        countryCounts.set(label, (countryCounts.get(label) ?? 0) + 1);
      });

      if (film.year) {
        const decade = `${Math.floor(film.year / 10) * 10}s`;
        decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
      }

      const runtime = details.runtime;
      if (typeof runtime === "number" && runtime > 0) runtimes.push(runtime);

      details.credits?.cast?.slice(0, 6).forEach((person) => {
        recordPerson(person, liked, disliked);
      });
    });

    const avoidedActors = [...actorStats.entries()]
      .map(([id, stats]) => ({
        id,
        name: stats.name,
        profilePath: stats.profilePath ?? null,
        liked: stats.liked,
        disliked: stats.disliked,
      }))
      .filter((actor) => {
        const total = actor.liked + actor.disliked;
        if (actor.disliked < 3 || total === 0) return false;
        return actor.disliked / total >= 0.6;
      })
      .sort((a, b) => b.disliked - a.disliked)
      .slice(0, 10)
      .map<Person>((actor) => ({
        id: actor.id,
        name: actor.name,
        profilePath: actor.profilePath ?? null,
        count: actor.disliked,
        role: `${actor.disliked} dislikes`,
      }));

    const runtimeStats = (() => {
      if (runtimes.length === 0) return null;
      const sorted = [...runtimes].sort((a, b) => a - b);
      const total = runtimes.reduce((sum, value) => sum + value, 0);
      const average = total / runtimes.length;
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
      const p20 = percentile(sorted, 0.2);
      const p80 = percentile(sorted, 0.8);
      const tooShort = sorted.filter((value) => value < p20).length;
      const tooLong = sorted.filter((value) => value > p80).length;
      const buckets = sorted.reduce(
        (acc, runtime) => {
          const bucket = getRuntimeBucket(runtime);
          acc[bucket] += 1;
          return acc;
        },
        {
          Short: 0,
          Standard: 0,
          Long: 0,
          Epic: 0,
        } as RuntimeStats["buckets"],
      );
      return {
        totalFilms: runtimes.length,
        average,
        median,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p20,
        p80,
        tooShort,
        tooLong,
        buckets,
      } satisfies RuntimeStats;
    })();

    const hasAvoidanceSignal =
      avoidedGenres.length > 0 ||
      avoidedKeywords.length > 0 ||
      avoidedDirectors.length > 0 ||
      avoidedActors.length > 0;

    return {
      likedFilmsCount,
      dislikedFilmsCount,
      avoidedGenres,
      avoidedKeywords,
      avoidedDirectors,
      avoidedActors,
      mixedGenres,
      mixedKeywords,
      mixedDirectors,
      avoidedGenreTags,
      avoidedKeywordTags,
      lowExposureGenres: buildInverseTags(genreCounts, 10),
      lowExposureLanguages: buildInverseTags(languageCounts, 8),
      lowExposureCountries: buildInverseTags(countryCounts, 8),
      lowExposureDecades: buildInverseTags(decadeCounts, 8),
      runtimeStats,
      hasAvoidanceSignal,
    };
  }, [filteredFilms, filmMappings, tasteProfile, tmdbDetails]);

  const filterLabel =
    timeFilter === "all"
      ? "All time"
      : timeFilter === "year"
        ? "Past year"
        : "Past month";

  const avoidedPeopleCount =
    avoidanceMetrics.avoidedDirectors.length +
    avoidanceMetrics.avoidedActors.length;
  const exclusionCount =
    avoidanceMetrics.avoidedGenres.length +
    avoidanceMetrics.avoidedKeywords.length +
    avoidanceMetrics.avoidedDirectors.length +
    avoidanceMetrics.avoidedActors.length;

  if (filteredFilms.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Avoidance Profile</Heading>
        <SectionCard title="No data yet">
          <Body className="text-gray-600">
            Import your Letterboxd data or adjust your time filter to reveal
            avoidance signals.
          </Body>
        </SectionCard>
      </div>
    );
  }

  if (isLoading || isTasteLoading) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Avoidance Profile</Heading>
        <Body className="text-gray-500">Loading avoidance profile...</Body>
      </div>
    );
  }

  const runtimeStats = avoidanceMetrics.runtimeStats;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={2}>Avoidance Profile</Heading>
        <Body className="text-gray-500">
          Filters & low-affinity signals · {filterLabel}
        </Body>
        {(error || tasteError) && (
          <Body className="text-red-600">
            Some avoidance details couldn&apos;t load. Please refresh if this
            persists.
          </Body>
        )}
      </div>

      <Body className="text-gray-600 dark:text-gray-400">
        This view highlights patterns you consistently skip or rate poorly.
        Avoidance signals only activate when you dislike 60%+ of films with a
        shared attribute.
      </Body>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Avoided Genres"
          value={avoidanceMetrics.avoidedGenres.length}
          icon="x"
          variant="highlight"
        />
        <StatCard
          title="Avoided People"
          value={avoidedPeopleCount}
          icon="user"
        />
        <StatCard
          title="Runtime Comfort"
          value={
            runtimeStats
              ? `${Math.round(runtimeStats.p20)}-${Math.round(
                  runtimeStats.p80,
                )} min`
              : "—"
          }
          icon="clock"
          variant="subtle"
        />
        <StatCard
          title="Total Exclusions"
          value={exclusionCount}
          icon="filter"
          variant="subtle"
        />
      </div>

      {!avoidanceMetrics.hasAvoidanceSignal && (
        <SectionCard title="No strong avoidance signals yet">
          <Body className="text-gray-600">
            Your ratings don&apos;t show consistent negative patterns in this
            time range. Keep rating films to help the model learn what to
            filter.
          </Body>
        </SectionCard>
      )}

      <SectionCard
        title="Avoided Genres"
        subtitle="Genres with sustained low ratings"
      >
        {avoidanceMetrics.avoidedGenreTags.length > 0 ? (
          <TagCloud
            tags={avoidanceMetrics.avoidedGenreTags}
            maxTags={12}
            variant="solid"
          />
        ) : (
          <Body className="text-gray-500">No genres are strongly avoided.</Body>
        )}
        {avoidanceMetrics.lowExposureGenres.length > 0 && (
          <div className="mt-4 space-y-2">
            <Body className="text-sm font-semibold text-gray-900">
              Low-exposure genres
            </Body>
            <TagCloud
              tags={avoidanceMetrics.lowExposureGenres}
              maxTags={10}
              variant="solid"
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Avoided Themes"
        subtitle="Keywords frequently associated with dislikes"
      >
        {avoidanceMetrics.avoidedKeywordTags.length > 0 ? (
          <TagCloud
            tags={avoidanceMetrics.avoidedKeywordTags}
            maxTags={12}
            variant="solid"
          />
        ) : (
          <Body className="text-gray-500">No themes are strongly avoided.</Body>
        )}
      </SectionCard>

      <SectionCard
        title="Avoided People"
        subtitle="Directors and actors tied to negative reactions"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Avoided directors
            </Body>
            {avoidanceMetrics.avoidedDirectors.length > 0 ? (
              <PersonGrid
                people={avoidanceMetrics.avoidedDirectors.map((director) => ({
                  id: director.id,
                  name: director.name,
                  profilePath: null,
                  count: Math.round(director.weight),
                  role: "Strong avoid signal",
                }))}
                variant="compact"
                maxPeople={8}
              />
            ) : (
              <Body className="text-gray-500">No directors are avoided.</Body>
            )}
          </div>
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Avoided actors
            </Body>
            {avoidanceMetrics.avoidedActors.length > 0 ? (
              <PersonGrid
                people={avoidanceMetrics.avoidedActors}
                variant="compact"
                maxPeople={8}
              />
            ) : (
              <Body className="text-gray-500">
                No actor avoidance patterns detected.
              </Body>
            )}
          </div>
        </div>
      </SectionCard>

      {(avoidanceMetrics.mixedGenres.length > 0 ||
        avoidanceMetrics.mixedDirectors.length > 0 ||
        avoidanceMetrics.mixedKeywords.length > 0) && (
        <SectionCard
          title="Mixed Signals"
          subtitle="Disliked sometimes, but not enough to avoid"
        >
          <div className="space-y-4">
            {avoidanceMetrics.mixedGenres.length > 0 && (
              <div className="space-y-2">
                <Body className="text-sm font-semibold text-gray-900">
                  Genres with mixed reactions
                </Body>
                <div className="flex flex-wrap gap-2">
                  {avoidanceMetrics.mixedGenres.map((genre) => (
                    <span
                      key={genre.id}
                      className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-700"
                    >
                      {genre.name} ({genre.liked}👍/{genre.disliked}👎)
                    </span>
                  ))}
                </div>
              </div>
            )}
            {avoidanceMetrics.mixedDirectors.length > 0 && (
              <div className="space-y-2">
                <Body className="text-sm font-semibold text-gray-900">
                  Directors with mixed reactions
                </Body>
                <div className="flex flex-wrap gap-2">
                  {avoidanceMetrics.mixedDirectors.map((director) => (
                    <span
                      key={director.id}
                      className="rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-700"
                    >
                      {director.name} ({director.liked}👍/{director.disliked}👎)
                    </span>
                  ))}
                </div>
              </div>
            )}
            {avoidanceMetrics.mixedKeywords.length > 0 && (
              <div className="space-y-2">
                <Body className="text-sm font-semibold text-gray-900">
                  Themes with mixed reactions
                </Body>
                <div className="flex flex-wrap gap-2">
                  {avoidanceMetrics.mixedKeywords
                    .slice(0, 10)
                    .map((keyword) => (
                      <span
                        key={keyword.id}
                        className="rounded-full bg-violet-100 px-3 py-1 text-xs text-violet-700"
                      >
                        {keyword.name} ({keyword.liked}👍/{keyword.disliked}👎)
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Runtime Preferences"
        subtitle="Where you spend the least time"
      >
        {runtimeStats ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="Average Runtime"
                value={`${Math.round(runtimeStats.average)} min`}
                icon="clock"
              />
              <StatCard
                title="Comfort Range"
                value={`${Math.round(runtimeStats.p20)}-${Math.round(
                  runtimeStats.p80,
                )} min`}
                icon="target"
                variant="subtle"
              />
              <StatCard
                title="Too Short"
                value={runtimeStats.tooShort}
                icon="arrow-down"
                variant="subtle"
              />
              <StatCard
                title="Too Long"
                value={runtimeStats.tooLong}
                icon="arrow-up"
                variant="subtle"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(runtimeStats.buckets).map(([label, count]) => (
                <StatCard
                  key={label}
                  title={label}
                  value={count}
                  icon="film"
                  change={{
                    value: Math.round((count / runtimeStats.totalFilms) * 100),
                    trend: "neutral",
                    label: "%",
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <Body className="text-gray-500">
            Runtime insights will appear once TMDB data is available.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Other Filters"
        subtitle="Languages, regions, and decades with low exposure"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-2">
            <Body className="text-sm font-semibold text-gray-900">
              Languages
            </Body>
            {avoidanceMetrics.lowExposureLanguages.length > 0 ? (
              <TagCloud
                tags={avoidanceMetrics.lowExposureLanguages}
                maxTags={8}
                variant="solid"
              />
            ) : (
              <Body className="text-gray-500">No language patterns yet.</Body>
            )}
          </div>
          <div className="space-y-2">
            <Body className="text-sm font-semibold text-gray-900">Regions</Body>
            {avoidanceMetrics.lowExposureCountries.length > 0 ? (
              <TagCloud
                tags={avoidanceMetrics.lowExposureCountries}
                maxTags={8}
                variant="solid"
              />
            ) : (
              <Body className="text-gray-500">No region patterns yet.</Body>
            )}
          </div>
          <div className="space-y-2">
            <Body className="text-sm font-semibold text-gray-900">Decades</Body>
            {avoidanceMetrics.lowExposureDecades.length > 0 ? (
              <TagCloud
                tags={avoidanceMetrics.lowExposureDecades}
                maxTags={8}
                variant="solid"
              />
            ) : (
              <Body className="text-gray-500">No decade patterns yet.</Body>
            )}
          </div>
        </div>

        <Body className="text-xs text-gray-500 mt-4">
          Low exposure doesn&apos;t mean dislike — it highlights areas with
          sparse viewing history that can influence filtering.
        </Body>
      </SectionCard>

      <SectionCard title="Avoidance Summary">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <Body className="text-sm font-semibold text-gray-900">
              Dislike threshold
            </Body>
            <Body className="text-xs text-gray-500 mt-2">
              Avoidance activates when you dislike 60%+ of films with an
              attribute and have at least 2-3 examples.
            </Body>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <Body className="text-sm font-semibold text-gray-900">
              Rated sample
            </Body>
            <Body className="text-xs text-gray-500 mt-2">
              {avoidanceMetrics.likedFilmsCount} liked vs{" "}
              {avoidanceMetrics.dislikedFilmsCount} disliked films inform the
              avoidance model.
            </Body>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <Body className="text-sm font-semibold text-gray-900">
              What this affects
            </Body>
            <Body className="text-xs text-gray-500 mt-2">
              Avoided attributes reduce suggestion scores unless overridden by
              your watchlist.
            </Body>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
