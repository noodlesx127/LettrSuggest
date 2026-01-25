import { useEffect, useMemo, useState } from "react";

import { getBulkTmdbDetails, getFilmMappings } from "@/lib/enrich";

import type { FilmEvent } from "@/lib/normalize";
import type { MappingCoverage, TMDBDetails } from "@/app/stats/types";

export function useStatsData(uid: string, filteredFilms: readonly FilmEvent[]) {
  const [tmdbDetails, setTmdbDetails] = useState<Map<number, TMDBDetails>>(
    new Map(),
  );
  const [filmMappings, setFilmMappings] = useState<Map<string, number>>(
    new Map(),
  );
  const [mappingCoverage, setMappingCoverage] =
    useState<MappingCoverage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const uniqueUris = useMemo(() => {
    return Array.from(new Set(filteredFilms.map((film) => film.uri)));
  }, [filteredFilms]);

  useEffect(() => {
    let isActive = true;

    if (!uid || uniqueUris.length === 0) {
      console.log("[Stats Hook useStatsData] Skipping TMDB load", {
        uid,
        filmCount: uniqueUris.length,
      });
      setTmdbDetails(new Map());
      setFilmMappings(new Map());
      setMappingCoverage(null);
      setIsLoading(false);
      setError(null);
      return () => {
        isActive = false;
      };
    }

    const timeoutId = setTimeout(() => {
      if (!isActive) return;
      console.error("[Stats Hook useStatsData] Load timeout after 60 seconds");
      setError(
        new Error(
          "Loading took too long. Please try again or reduce your time filter.",
        ),
      );
      setIsLoading(false);
    }, 60000);

    const loadTmdbDetails = async () => {
      console.log("[Stats Hook useStatsData] Starting TMDB load", {
        uid,
        filmCount: uniqueUris.length,
      });
      setIsLoading(true);
      setError(null);

      try {
        const mappings = await getFilmMappings(uid, uniqueUris);
        if (!isActive) return;

        setFilmMappings(mappings);
        setMappingCoverage({ mapped: mappings.size, total: uniqueUris.length });

        const tmdbIds = Array.from(new Set(mappings.values()));
        if (tmdbIds.length === 0) {
          console.log("[Stats Hook useStatsData] No TMDB IDs to fetch");
          setTmdbDetails(new Map());
          return;
        }

        const details = await getBulkTmdbDetails(tmdbIds);
        if (!isActive) return;

        console.log("[Stats Hook useStatsData] TMDB details loaded", {
          requested: tmdbIds.length,
          loaded: details.size,
        });
        setTmdbDetails(details as Map<number, TMDBDetails>);
      } catch (err) {
        const errorValue =
          err instanceof Error ? err : new Error("Unknown error occurred");
        console.error("[Stats Hook useStatsData] Error loading TMDB details", {
          error: errorValue,
        });
        if (isActive) setError(errorValue);
      } finally {
        clearTimeout(timeoutId);
        if (isActive) setIsLoading(false);
      }
    };

    void loadTmdbDetails();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
    };
  }, [uid, uniqueUris]);

  return {
    tmdbDetails,
    filmMappings,
    mappingCoverage,
    isLoading,
    error,
  };
}
