"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import {
  Button,
  Heading,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useImportData } from "@/lib/importStore";
import { supabase } from "@/lib/supabaseClient";
import type { FilmEvent } from "@/lib/normalize";
import StatsOverview from "@/app/stats/components/StatsOverview";
import TasteProfileTab from "@/app/stats/components/TasteProfileTab";
import WatchHistoryTab from "@/app/stats/components/WatchHistoryTab";
import AlgorithmInsightsTab from "@/app/stats/components/AlgorithmInsightsTab";
import WatchlistAnalysisTab from "@/app/stats/components/WatchlistAnalysisTab";
import AvoidanceProfileTab from "@/app/stats/components/AvoidanceProfileTab";

type TimeFilter = "all" | "year" | "month";

type TabId =
  | "overview"
  | "taste"
  | "history"
  | "algorithm"
  | "watchlist"
  | "filters";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "taste", label: "Taste Profile" },
  { id: "history", label: "Watch History" },
  { id: "algorithm", label: "Algorithm Insights" },
  { id: "watchlist", label: "Watchlist Analysis" },
  { id: "filters", label: "Avoidance Profile" },
];

export default function StatsPage() {
  const { films } = useImportData();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    async function getUid() {
      if (!supabase) return;

      const { data } = await supabase.auth.getSession();
      setUid(data?.session?.user?.id ?? null);

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setUid(session?.user?.id ?? null);
      });

      return () => subscription.unsubscribe();
    }

    getUid();
  }, []);

  const filteredFilms = useMemo(() => {
    if (!films) {
      console.log("[Stats] No films in context");
      return [] as readonly FilmEvent[];
    }

    const watched = (films as FilmEvent[]).filter(
      (film) =>
        (film.watchCount ?? 0) > 0 || film.rating != null || !!film.lastDate,
    );

    console.log("[Stats] Filtering films:", {
      total: films.length,
      watched: watched.length,
    });

    if (timeFilter === "all") return watched;

    const now = new Date();
    const cutoff =
      timeFilter === "year"
        ? new Date(now.getFullYear(), 0, 1)
        : new Date(now.getFullYear(), now.getMonth(), 1);

    return watched.filter((film) => {
      if (!film.lastDate) return false;
      const filmDate = new Date(film.lastDate);
      return filmDate >= cutoff;
    });
  }, [films, timeFilter]);

  return (
    <AuthGate>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-4">
          <Heading level={1}>Your Stats</Heading>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={timeFilter === "all" ? "primary" : "ghost"}
                size="sm"
                onClick={() => setTimeFilter("all")}
              >
                All Time
              </Button>
              <Button
                variant={timeFilter === "year" ? "primary" : "ghost"}
                size="sm"
                onClick={() => setTimeFilter("year")}
              >
                Past Year
              </Button>
              <Button
                variant={timeFilter === "month" ? "primary" : "ghost"}
                size="sm"
                onClick={() => setTimeFilter("month")}
              >
                Past Month
              </Button>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {filteredFilms.length} films
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            {uid && (
              <StatsOverview
                timeFilter={timeFilter}
                filteredFilms={filteredFilms}
                uid={uid}
              />
            )}
          </TabsContent>
          <TabsContent value="taste">
            {uid && (
              <TasteProfileTab
                timeFilter={timeFilter}
                filteredFilms={filteredFilms}
                uid={uid}
              />
            )}
          </TabsContent>
          <TabsContent value="history">
            {uid && (
              <WatchHistoryTab
                timeFilter={timeFilter}
                filteredFilms={filteredFilms}
                uid={uid}
              />
            )}
          </TabsContent>
          <TabsContent value="algorithm">
            {uid && (
              <AlgorithmInsightsTab
                timeFilter={timeFilter}
                filteredFilms={filteredFilms}
                uid={uid}
              />
            )}
          </TabsContent>
          <TabsContent value="watchlist">
            {uid && (
              <WatchlistAnalysisTab
                timeFilter={timeFilter}
                filteredFilms={filteredFilms}
                uid={uid}
              />
            )}
          </TabsContent>
          <TabsContent value="filters">
            {uid && (
              <AvoidanceProfileTab
                timeFilter={timeFilter}
                filteredFilms={filteredFilms}
                uid={uid}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AuthGate>
  );
}
