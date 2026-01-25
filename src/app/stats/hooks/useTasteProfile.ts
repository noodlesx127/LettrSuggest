import { useEffect, useState } from "react";

import { buildTasteProfile } from "@/lib/enrich";

import type { FilmEvent } from "@/lib/normalize";
import type { TMDBDetails, TasteProfileData } from "@/app/stats/types";

export function useTasteProfile(
  filteredFilms: readonly FilmEvent[],
  tmdbDetails: Map<number, TMDBDetails>,
  uid?: string,
  filmMappings?: Map<string, number>,
  watchlistFilms: readonly FilmEvent[] = [],
) {
  const [tasteProfile, setTasteProfile] = useState<TasteProfileData | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!uid || filteredFilms.length === 0 || tmdbDetails.size === 0) {
      setTasteProfile(null);
      setIsLoading(false);
      setError(null);
      return () => {
        isActive = false;
      };
    }

    const mappings = filmMappings ?? new Map<string, number>();

    const runProfile = async () => {
      setIsLoading(true);
      setError(null);
      try {
        console.log("[Stats Hook useTasteProfile] Building taste profile", {
          filmCount: filteredFilms.length,
          mappingCount: mappings.size,
          tmdbDetailsCount: tmdbDetails.size,
          watchlistCount: watchlistFilms.length,
        });

        const profile = await buildTasteProfile({
          films: [...filteredFilms],
          mappings,
          tmdbDetails,
          watchlistFilms: [...watchlistFilms].map((film) => ({
            uri: film.uri,
            watchlistAddedAt: film.watchlistAddedAt,
          })),
          userId: uid,
        });

        if (!isActive) return;
        setTasteProfile(profile);
      } catch (err) {
        const errorValue =
          err instanceof Error ? err : new Error("Unknown error occurred");
        console.error(
          "[Stats Hook useTasteProfile] Error building taste profile",
          errorValue,
        );
        if (isActive) setError(errorValue);
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    void runProfile();

    return () => {
      isActive = false;
    };
  }, [filteredFilms, filmMappings, tmdbDetails, uid, watchlistFilms]);

  return {
    tasteProfile,
    isLoading,
    error,
  };
}
