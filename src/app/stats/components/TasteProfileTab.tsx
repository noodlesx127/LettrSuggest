"use client";

import Image from "next/image";
import { useMemo } from "react";

import type { StatsTabProps, TMDBDetails } from "@/app/stats/types";
import { useStatsData } from "@/app/stats/hooks/useStatsData";
import { useTasteProfile } from "@/app/stats/hooks/useTasteProfile";
import type { Tag } from "@/app/stats/components/shared/TagCloud";
import type { Person } from "@/app/stats/components/shared/PersonGrid";
import { PersonGrid } from "@/app/stats/components/shared/PersonGrid";
import { SectionCard } from "@/app/stats/components/shared/SectionCard";
import { StatCard } from "@/app/stats/components/shared/StatCard";
import { TagCloud } from "@/app/stats/components/shared/TagCloud";
import { Body, Heading, Icon } from "@/components/ui";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185";

const toPlural = (value: number, label: string) =>
  `${value} ${value === 1 ? label : `${label}s`}`;

const getInitials = (name: string) => {
  const [first, second] = name.split(" ");
  if (!first) return "";
  return `${first[0] ?? ""}${second?.[0] ?? ""}`.toUpperCase();
};

type WeightedItem = { name: string; weight: number; count?: number };

const buildWeightedTags = (items: WeightedItem[], maxTags: number): Tag[] => {
  const sorted = [...items]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxTags);
  const maxWeight = sorted[0]?.weight ?? 0;
  return sorted.map((item) => ({
    label: item.name,
    weight: maxWeight > 0 ? item.weight / maxWeight : 0,
    count: item.count,
  }));
};

const getRuntimeBucket = (runtime: number) => {
  if (runtime <= 90) return "Short";
  if (runtime <= 120) return "Standard";
  if (runtime <= 150) return "Long";
  return "Epic";
};

export default function TasteProfileTab({
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

  const genreTags = useMemo(() => {
    if (!tasteProfile?.topGenres?.length) return [];
    return buildWeightedTags(tasteProfile.topGenres, 20);
  }, [tasteProfile]);

  const keywordTags = useMemo(() => {
    if (!tasteProfile?.topKeywords?.length) return [];
    return buildWeightedTags(tasteProfile.topKeywords, 30);
  }, [tasteProfile]);

  const subgenreTags = useMemo(() => {
    if (!tasteProfile?.topKeywords?.length || !tasteProfile?.preferredSubgenreKeywordIds?.length) return [];

    const subgenreIds = new Set(tasteProfile.preferredSubgenreKeywordIds);
    const subgenres = tasteProfile.topKeywords.filter(k => subgenreIds.has(k.id));

    return buildWeightedTags(subgenres, 20);
  }, [tasteProfile]);

  const directorPeople = useMemo<Person[]>(() => {
    if (!tasteProfile?.topDirectors?.length) return [];
    return [...tasteProfile.topDirectors]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)
      .map((director) => ({
        id: director.id,
        name: director.name,
        profilePath: director.profile ?? null,
        count: director.count,
        role: toPlural(director.count, "film"),
      }));
  }, [tasteProfile]);

  const actorPeople = useMemo<Person[]>(() => {
    if (!tasteProfile?.topActors?.length) return [];
    return [...tasteProfile.topActors]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)
      .map((actor) => ({
        id: actor.id,
        name: actor.name,
        profilePath: actor.profile ?? null,
        count: actor.count,
        role: toPlural(actor.count, "film"),
      }));
  }, [tasteProfile]);

  const studioCards = useMemo(() => {
    if (!tasteProfile?.topStudios?.length || tmdbDetails.size === 0) return [];

    const studioLogoMap = new Map<
      number,
      { name: string; logoPath?: string | null }
    >();

    for (const details of tmdbDetails.values()) {
      for (const company of details.production_companies ?? []) {
        if (!studioLogoMap.has(company.id)) {
          studioLogoMap.set(company.id, {
            name: company.name,
            logoPath: company.logo_path ?? null,
          });
        }
      }
    }

    return [...tasteProfile.topStudios]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 12)
      .map((studio) => ({
        ...studio,
        logoPath: studioLogoMap.get(studio.id)?.logoPath ?? null,
      }));
  }, [tasteProfile, tmdbDetails]);

  const decadePreferences = useMemo(() => {
    if (!tasteProfile?.topDecades?.length) return [];
    const sorted = [...tasteProfile.topDecades].sort(
      (a, b) => b.weight - a.weight,
    );
    const maxWeight = sorted[0]?.weight ?? 0;
    return sorted.map((entry) => ({
      label: `${entry.decade}s`,
      weight: entry.weight,
      percent: maxWeight > 0 ? (entry.weight / maxWeight) * 100 : 0,
    }));
  }, [tasteProfile]);

  const runtimeStats = useMemo(() => {
    if (tmdbDetails.size === 0 || filmMappings.size === 0) return null;

    const runtimes: number[] = [];
    for (const film of filteredFilms) {
      const tmdbId = filmMappings.get(film.uri);
      if (!tmdbId) continue;
      const details = tmdbDetails.get(tmdbId);
      if (!details) continue;
      const runtime = (details as TMDBDetails & { runtime?: number }).runtime;
      if (typeof runtime === "number" && runtime > 0) runtimes.push(runtime);
    }

    if (runtimes.length === 0) return null;

    const sorted = [...runtimes].sort((a, b) => a - b);
    const total = runtimes.reduce((sum, value) => sum + value, 0);
    const average = total / runtimes.length;
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const bucketCounts = sorted.reduce(
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
      },
    );

    return {
      totalFilms: runtimes.length,
      average,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      buckets: bucketCounts,
      totalHours: total / 60,
    };
  }, [filteredFilms, filmMappings, tmdbDetails]);

  const filterLabel =
    timeFilter === "all"
      ? "All time"
      : timeFilter === "year"
        ? "Past year"
        : "Past month";

  if (filteredFilms.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Taste Profile</Heading>
        <SectionCard title="No data yet">
          <Body className="text-gray-600">
            Import your Letterboxd data or adjust your time filter to see taste
            insights.
          </Body>
        </SectionCard>
      </div>
    );
  }

  if (isLoading || isTasteLoading) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Taste Profile</Heading>
        <Body className="text-gray-500">Loading taste profile...</Body>
      </div>
    );
  }

  if (!tasteProfile) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Taste Profile</Heading>
        <SectionCard title="No taste profile available">
          <Body className="text-gray-600">
            We couldn&apos;t build a taste profile yet. Please refresh once TMDB
            enrichment completes.
          </Body>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={2}>Taste Profile</Heading>
        <Body className="text-gray-500">
          Weighted preferences · {filterLabel}
        </Body>
        {(error || tasteError) && (
          <Body className="text-red-600">
            Some taste details couldn&apos;t load. Please refresh if this
            persists.
          </Body>
        )}
      </div>

      <SectionCard
        title="Genre Preferences"
        subtitle="Your strongest genre signals"
        icon={<Icon name="film" />}
      >
        {genreTags.length > 0 ? (
          <TagCloud tags={genreTags} maxTags={20} variant="gradient" />
        ) : (
          <Body className="text-gray-500">
            Genre insights will appear once TMDB enrichment finishes.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Top Subgenres"
        subtitle="Your niche favorite topics"
        icon={<Icon name="bookmark" />}
      >
        {subgenreTags.length > 0 ? (
          <TagCloud tags={subgenreTags} maxTags={20} variant="solid" />
        ) : (
          <Body className="text-gray-500">
            Niche subgenre insights will appear as you rate more movies.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Favorite Directors"
        subtitle="Weighted by ratings and repeat watches"
        icon={<Icon name="user" />}
      >
        {directorPeople.length > 0 ? (
          <PersonGrid
            people={directorPeople}
            variant="detailed"
            maxPeople={12}
          />
        ) : (
          <Body className="text-gray-500">No director preferences yet.</Body>
        )}
      </SectionCard>

      <SectionCard
        title="Favorite Actors"
        subtitle="Faces that show up in your favorites"
        icon={<Icon name="user-circle" />}
      >
        {actorPeople.length > 0 ? (
          <PersonGrid people={actorPeople} variant="detailed" maxPeople={12} />
        ) : (
          <Body className="text-gray-500">No actor preferences yet.</Body>
        )}
      </SectionCard>

      <SectionCard
        title="Themes & Keywords"
        subtitle="Narrative elements that resonate most"
        icon={<Icon name="star" />}
      >
        {keywordTags.length > 0 ? (
          <TagCloud tags={keywordTags} maxTags={30} variant="gradient" />
        ) : (
          <Body className="text-gray-500">No keyword signals yet.</Body>
        )}
      </SectionCard>

      <SectionCard
        title="Production Companies"
        subtitle="Studios behind your most-loved films"
        icon={<Icon name="film" />}
      >
        {studioCards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {studioCards.map((studio) => (
              <div
                key={studio.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3"
              >
                {studio.logoPath ? (
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-50">
                    <Image
                      src={`${TMDB_IMAGE_BASE}${studio.logoPath}`}
                      alt={studio.name}
                      fill
                      sizes="40px"
                      className="object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">
                    {getInitials(studio.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {studio.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {studio.count} films · {studio.weight.toFixed(1)} weight
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Body className="text-gray-500">
            Studio preferences will appear once TMDB data is available.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Decade Preferences"
        subtitle="Eras you watch most often"
        icon={<Icon name="calendar" />}
      >
        {decadePreferences.length > 0 ? (
          <div className="space-y-3">
            {decadePreferences.slice(0, 8).map((decade) => (
              <div key={decade.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">
                    {decade.label}
                  </span>
                  <span className="text-gray-500">
                    {decade.weight.toFixed(1)} weight
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${decade.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Body className="text-gray-500">No decade insights yet.</Body>
        )}
      </SectionCard>

      <SectionCard
        title="Runtime Preferences"
        subtitle="Average length of the films you watch"
        icon={<Icon name="clock" />}
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
                title="Median Runtime"
                value={`${Math.round(runtimeStats.median)} min`}
                icon="clock"
                variant="subtle"
              />
              <StatCard
                title="Shortest Film"
                value={`${runtimeStats.min} min`}
                icon="arrow-down"
                variant="subtle"
              />
              <StatCard
                title="Longest Film"
                value={`${runtimeStats.max} min`}
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
                  change={
                    runtimeStats.totalFilms > 0
                      ? {
                        value: Math.round(
                          (count / runtimeStats.totalFilms) * 100,
                        ),
                        trend: "neutral",
                        label: "%",
                      }
                      : undefined
                  }
                />
              ))}
            </div>

            <Body className="text-sm text-gray-500">
              {toPlural(runtimeStats.totalFilms, "film")} with runtime data · ~
              {runtimeStats.totalHours.toFixed(1)} total hours
            </Body>
          </div>
        ) : (
          <Body className="text-gray-500">
            Runtime insights will appear once TMDB data is available.
          </Body>
        )}
      </SectionCard>
    </div>
  );
}
