"use client";
import AuthGate from "@/components/AuthGate";
import UnmappedFilmModal, {
  type UnmappedFilm,
} from "@/components/UnmappedFilmModal";
import { useCallback, useMemo, useState, useEffect } from "react";
import JSZip from "jszip";
import { normalizeData } from "@/lib/normalize";
import { useImportData } from "@/lib/importStore";
import { supabase } from "@/lib/supabaseClient";
import { learnFromHistoricalData } from "@/lib/enrich";
import { seedPreferencesFromHistory } from "@/lib/quizLearning";
import { saveFilmsLocally } from "@/lib/db";
import {
  reconcileImportSnapshot,
  type ImportSnapshotMapping,
} from "@/lib/importSnapshot";
import {
  createImportOperationGuard,
  ImportIdentityChangedError,
  runGuardedImportWrite,
  type ImportOperationGuard,
} from "@/lib/importStorage";
import {
  parseImportCsv,
  classifyImportPath,
  assignImportGroup,
  assertRecognizedImportFiles,
  assertCompleteImportManifest,
  assertNonEmptyImportSnapshot,
  resolveImportFailure,
  selectImportUpload,
  type ParsedImportData,
} from "@/lib/importParse";
import {
  loadAllExistingMappings,
  mergeImportMappings,
  selectFilmsToEnrich,
  type EnrichmentOutcome,
  type ExistingMappingRow,
} from "@/lib/importMappings";
import { runRequiredPostImportWork } from "@/lib/importPostWork";
import type { FilmEvent } from "@/lib/normalize";

// Import step definitions
type ImportStep =
  | "idle"
  | "upload"
  | "parse"
  | "save"
  | "enrich"
  | "learn"
  | "complete";

const STEPS: { key: ImportStep; label: string; description: string }[] = [
  {
    key: "upload",
    label: "Upload",
    description: "Select your Letterboxd export",
  },
  { key: "parse", label: "Parse", description: "Reading your watch history" },
  { key: "save", label: "Save", description: "Storing your data securely" },
  { key: "enrich", label: "Enrich", description: "Fetching movie details" },
  { key: "learn", label: "Learn", description: "Building your taste profile" },
];

function StepIndicator({
  currentStep,
  completedSteps,
}: {
  currentStep: ImportStep;
  completedSteps: Set<ImportStep>;
}) {
  if (currentStep === "idle") return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps.has(step.key);
          const isCurrent = currentStep === step.key;
          const isPending = !isCompleted && !isCurrent;

          return (
            <div key={step.key} className="flex items-center flex-1">
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isCurrent
                        ? "bg-blue-600 text-white ring-4 ring-blue-200"
                        : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {isCompleted ? (
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={`mt-2 text-xs font-medium ${isCurrent ? "text-blue-600" : isCompleted ? "text-green-600" : "text-gray-500"}`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-2 rounded ${isCompleted ? "bg-green-500" : "bg-gray-200"}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Current step description */}
      {currentStep !== "complete" && (
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-600">
            {STEPS.find((s) => s.key === currentStep)?.description || ""}
          </p>
        </div>
      )}
    </div>
  );
}

type ParsedData = {
  watched?: Record<string, string>[];
  diary?: Record<string, string>[];
  ratings?: Record<string, string>[];
  watchlist?: Record<string, string>[];
  likesFilms?: Record<string, string>[];
  reviews?: Record<string, string>[];
  lists?: Record<string, string>[];
  tags?: Record<string, string>[];
};

async function captureImportOperation(): Promise<ImportOperationGuard> {
  const client = supabase;
  if (!client) throw new Error("Supabase not initialized");

  const { data, error } = await client.auth.getSession();
  if (error) throw error;

  const userId = data.session?.user?.id;
  if (!userId) throw new Error("Not signed in");

  return createImportOperationGuard(userId, async () => {
    const { data: currentSession, error: currentSessionError } =
      await client.auth.getSession();
    if (currentSessionError) {
      console.warn("[Import] Failed to verify auth identity", currentSessionError);
      return null;
    }
    return currentSession.session?.user?.id ?? null;
  });
}

export default function ImportPage() {
  const { films, setFilmsForIdentity } = useImportData();
  const [data, setData] = useState<ParsedData>({});
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [distinct, setDistinct] = useState<number | null>(null);
  const [autoMappingActive, setAutoMappingActive] = useState(false);
  const [mappingProgress, setMappingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [forceReenrich, setForceReenrich] = useState(false);
  const [newFilmsBreakdown, setNewFilmsBreakdown] = useState<{
    newWatched: number;
    newWatchlist: number;
    newRatings: number;
    newLikes: number;
    total: number;
    isReimport: boolean;
  } | null>(null);

  // Step tracking
  const [currentStep, setCurrentStep] = useState<ImportStep>("idle");
  const [completedSteps, setCompletedSteps] = useState<Set<ImportStep>>(
    new Set(),
  );

  // Unmapped films tracking
  const [unmappedFilms, setUnmappedFilms] = useState<UnmappedFilm[]>([]);
  const [showUnmappedModal, setShowUnmappedModal] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const completeStep = useCallback((step: ImportStep) => {
    setCompletedSteps((prev) => new Set([...prev, step]));
  }, []);

  const autoMapBatch = useCallback(
    async (
      filmList: FilmEvent[],
      operation: ImportOperationGuard,
    ): Promise<{ mappings: ImportSnapshotMapping[]; unmapped: UnmappedFilm[] }> => {
      try {
        await operation.assertCurrent();
        setAutoMappingActive(true);
        const uid = operation.userId;

        // Always fully load existing mappings. Force re-enrich controls search
        // only, never whether prior mappings are known. Any page fetch error
        // aborts the import rather than reconciling against a partial view.
        const existingMappings = await loadAllExistingMappings(
          async (from, to) => {
            const { data: pageData, error } = await supabase!
              .from("film_tmdb_map")
              .select("uri, tmdb_id")
              .eq("user_id", uid)
              .order("uri", { ascending: true })
              .range(from, to);
            return {
              data: (pageData as ExistingMappingRow[] | null) ?? null,
              error,
            };
          },
        );
        console.log(
          `[Import] Found ${existingMappings.size} existing mappings`,
        );

        // Select films to search: force controls search, not mapping load.
        const filmUris = filmList.map((f) => f.uri);
        const titleByUri = new Map(filmList.map((f) => [f.uri, f.title]));
        const toTryUris = new Set(
          selectFilmsToEnrich(
            filmUris,
            (uri) => Boolean(titleByUri.get(uri)),
            existingMappings,
            forceReenrich,
          ),
        );
        const toTry = filmList.filter((f) => toTryUris.has(f.uri));
        console.log(
          `[Import] Need to enrich ${toTry.length} of ${filmList.length} films (${existingMappings.size} already mapped, ${filmList.filter((f) => !f.title).length} have no title${forceReenrich ? ", FORCE RE-ENRICH" : ""}`,
        );

        // Categorize new films for user feedback
        const isReimport = existingMappings.size > 0;
        if (isReimport && !forceReenrich) {
          const newWatched = toTry.filter(
            (f) => (f.watchCount ?? 0) > 0 && !f.onWatchlist,
          ).length;
          const newWatchlist = toTry.filter((f) => f.onWatchlist).length;
          const newRatings = toTry.filter(
            (f) => f.rating != null && f.rating > 0,
          ).length;
          const newLikes = toTry.filter((f) => f.liked).length;
          setNewFilmsBreakdown({
            newWatched,
            newWatchlist,
            newRatings,
            newLikes,
            total: toTry.length,
            isReimport: true,
          });
          console.log("[Import] New films breakdown:", {
            newWatched,
            newWatchlist,
            newRatings,
            newLikes,
            total: toTry.length,
          });
        } else {
          setNewFilmsBreakdown({
            newWatched: filmList.filter(
              (f) => (f.watchCount ?? 0) > 0 && !f.onWatchlist,
            ).length,
            newWatchlist: filmList.filter((f) => f.onWatchlist).length,
            newRatings: filmList.filter((f) => f.rating != null && f.rating > 0)
              .length,
            newLikes: filmList.filter((f) => f.liked).length,
            total: toTry.length,
            isReimport: false,
          });
        }

        let enriched = 0;
        let skipped = 0; // No TMDB results found
        let failed = 0; // API errors
        let next = 0;
        const concurrency = 2; // Reduced to avoid rate limits
        let lastRequestTime = 0;
        const minDelay = 300; // 300ms between requests (max ~3 requests/sec)
        const skippedFilms: UnmappedFilm[] = []; // Track films that couldn't be mapped
        const outcomes: EnrichmentOutcome[] = [];

        // Store userId for modal
        setUserId(operation.userId);

        setMappingProgress({ current: 0, total: toTry.length });
        setStatus(
          `Enriching films with TMDB, OMDb, and Watchmode data… 0/${toTry.length}`,
        );

        const sleep = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));

        // Import the enrichment function
        const { enrichMovieForImport } = await import("@/lib/importEnrich");

        const worker = async () => {
          while (true) {
            const i = next++;
            if (i >= toTry.length) break;
            const f = toTry[i];

            // Rate limiting: ensure minimum delay between requests
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;
            if (timeSinceLastRequest < minDelay) {
              await sleep(minDelay - timeSinceLastRequest);
            }
            lastRequestTime = Date.now();

            // Retry logic with exponential backoff
            let retries = 3;
            let backoff = 1000; // Start with 1 second
            let success = false;

            while (retries > 0) {
              try {
                // Use comprehensive enrichment (TMDB + TuiMDB + OMDb + Watchmode)
                const enrichedMovie = await enrichMovieForImport(
                  f.title,
                  f.year ?? undefined,
                );

                if (enrichedMovie) {
                  // Movie was found and enriched - record a match outcome.
                  outcomes.push({ kind: "match", uri: f.uri, tmdbId: enrichedMovie.id });
                  enriched += 1;
                  success = true;
                  setMappingProgress({
                    current: enriched + skipped + failed,
                    total: toTry.length,
                  });
                  setStatus(
                    `Enriching films… ${enriched + skipped + failed}/${toTry.length} (${enriched} enriched, ${skipped} no match)`,
                  );
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("lettr:mappings-updated"),
                    );
                  }
                } else {
                  // No results found - confirmed no-match retains any existing
                  // mapping. Track for manual mapping.
                  outcomes.push({ kind: "no-match", uri: f.uri });
                  skipped += 1;
                  skippedFilms.push({
                    uri: f.uri,
                    title: f.title,
                    year: f.year ?? undefined,
                  });
                  success = true;
                  console.log(
                    `[Import] No TMDB results for: ${f.title} (${f.year || "no year"})`,
                  );
                  setMappingProgress({
                    current: enriched + skipped + failed,
                    total: toTry.length,
                  });
                  setStatus(
                    `Enriching films… ${enriched + skipped + failed}/${toTry.length} (${enriched} enriched, ${skipped} no match)`,
                  );
                }
                break; // Success (enriched or no results), exit retry loop
              } catch (e: any) {
                if (e instanceof ImportIdentityChangedError) throw e;
                retries--;
                if (retries > 0) {
                  console.warn(
                    `[Import] Retry ${3 - retries}/3 for ${f.title}`,
                    e?.message,
                  );
                  await sleep(backoff);
                  backoff *= 2; // Exponential backoff
                } else {
                  console.error(
                    `[Import] Failed to enrich ${f.title} after 3 retries`,
                    e,
                  );
                  failed += 1;
                  // Track failed films for manual mapping too
                  skippedFilms.push({
                    uri: f.uri,
                    title: f.title,
                    year: f.year ?? undefined,
                  });
                  setMappingProgress({
                    current: enriched + skipped + failed,
                    total: toTry.length,
                  });
                  setStatus(
                    `Enriching films… ${enriched + skipped + failed}/${toTry.length} (${enriched} enriched, ${failed} failed)`,
                  );
                }
              }
            }
          }
        };
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        await operation.assertCurrent();

        // Enrichment failures are fatal: a partial enrichment must not be
        // reconciled as a successful import.
        if (failed > 0) {
          throw new Error(
            `Failed to enrich ${failed} film${failed !== 1 ? "s" : ""} after retries`,
          );
        }

        // Store unmapped films for manual mapping
        if (skippedFilms.length > 0) {
          setUnmappedFilms(skippedFilms);
          console.log(
            `[Import] ${skippedFilms.length} films need manual mapping`,
          );
        }

        // Build the final mapping set: existing mappings restricted to retained
        // films, with match outcomes replacing and no-match outcomes retaining.
        const mappings = mergeImportMappings({
          filmUris,
          existing: existingMappings,
          outcomes,
        });

        setStatus(
          `✓ Enriched ${mappings.length} of ${filmList.length} films with multi-API data (${enriched} new, ${existingMappings.size} existing, ${skipped} no match)`,
        );
        setMappingProgress(null);
        setAutoMappingActive(false);
        return { mappings, unmapped: skippedFilms };
      } catch (e) {
        console.error("[Import] autoMapBatch error", e);
        setAutoMappingActive(false);
        setMappingProgress(null);
        // Enrichment/mapping failures are fatal; surface them so the import
        // cannot report success. Local input remains available for retry.
        throw e;
      }
    },
    [forceReenrich],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      console.log("[Import] handleFiles start", {
        fileCount: Array.from(files).length,
      });
      // Clear stale state from any prior attempt so a retry starts clean and
      // never surfaces leftover unmapped films, modals, breakdowns, or progress.
      setError(null);
      setData({});
      setDistinct(null);
      setUnmappedFilms([]);
      setShowUnmappedModal(false);
      setNewFilmsBreakdown(null);
      setMappingProgress(null);
      setCurrentStep("upload");
      setCompletedSteps(new Set());
      setStatus("Processing files…");

      let operation: ImportOperationGuard;
      try {
        operation = await captureImportOperation();
      } catch (e: any) {
        console.error("[Import] Could not start import", e);
        setError(e?.message ?? "Import failed");
        setStatus("");
        return;
      }

      const next: ParsedData = {};

      // Mark upload complete, start parse
      completeStep("upload");
      setCurrentStep("parse");

      try {
        const fileArr = Array.from(files);
        // If a ZIP is present, prefer it; otherwise parse CSVs directly
        const zipFile = fileArr.find((f) =>
          f.name.toLowerCase().endsWith(".zip"),
        );
        if (zipFile) {
          console.log("[Import] detected ZIP", {
            name: zipFile.name,
            size: zipFile.size,
          });
          const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
          const entries = Object.keys(zip.files);
          console.log("[Import] ZIP entries", entries.length);
          for (const entry of entries) {
            // Shared root-path classification: ignores deleted/orphaned entries,
            // treats every lists/ CSV as an aggregated list (before basename
            // matching), and recognizes required files only at the export root.
            const logical = classifyImportPath(entry);
            if (!logical) continue;
            const fileText = await zip.files[entry].async("string");
            const parsed = parseImportCsv(fileText);
            // Fails closed on a duplicate required file rather than overwriting.
            assignImportGroup(next as ParsedImportData, logical, parsed);
          }
        } else {
          // Handle individual CSVs; allow folder drag-and-drop
          console.log("[Import] processing individual CSV files", {
            fileCount: fileArr.length,
          });
          for (const f of fileArr) {
            // Prefer the relative path (folder drag-and-drop) so wrapper-folder
            // and lists/ structure survive classification; fall back to the bare
            // file name for a plain multi-file selection. Shares the ZIP loop's
            // root-path contract and duplicate-file guard.
            const logical = classifyImportPath(f.webkitRelativePath || f.name);
            if (!logical) continue;
            const text = await f.text();
            const parsed = parseImportCsv(text);
            assignImportGroup(next as ParsedImportData, logical, parsed);
          }
        }

        // Fail closed: no recognized files means nothing to reconcile.
        assertRecognizedImportFiles(next as ParsedImportData);

        // Fail closed: a full snapshot replace deletes absent categories, so it
        // may only run when all six source groups are present. A partial export
        // must never reach normalization/reconciliation.
        assertCompleteImportManifest(next as ParsedImportData);

        console.log("[Import] parsed raw data", {
          watched: next.watched?.length ?? 0,
          diary: next.diary?.length ?? 0,
          ratings: next.ratings?.length ?? 0,
          watchlist: next.watchlist?.length ?? 0,
          likesFilms: next.likesFilms?.length ?? 0,
          reviews: next.reviews?.length ?? 0,
          lists: next.lists?.length ?? 0,
          tags: next.tags?.length ?? 0,
        });
        setData(next);

        console.log("[Import] normalizeData start");
        const norm = normalizeData(next);
        console.log("[Import] normalizeData done", {
          filmCount: norm.films.length,
          distinctFilms: norm.distinctFilms,
        });

        // Fail closed: an empty normalized snapshot must not trigger a
        // destructive full-snapshot replace.
        assertNonEmptyImportSnapshot(norm);

        setDistinct(norm.distinctFilms);
        await runGuardedImportWrite(operation, () =>
          setFilmsForIdentity(operation.userId, norm.films),
        );

        // Parse complete, move to save
        completeStep("parse");
        setCurrentStep("save");

        // Persist locally (IndexedDB). This stays available so a later cloud
        // failure does not discard the parsed import.
        await runGuardedImportWrite(operation, () =>
          saveFilmsLocally(operation.userId, norm.films),
        );
        console.log("[Import] films saved locally");

        // Local save complete, move to enrich
        completeStep("save");
        setCurrentStep("enrich");

        // Auto-map (await to show progress). Collects the mapping set for the
        // atomic snapshot; enrichment failures are fatal and thrown.
        console.log("[Import] autoMapBatch start", {
          filmCount: norm.films.length,
        });
        const { mappings } = await autoMapBatch(norm.films, operation);
        console.log("[Import] autoMapBatch complete", {
          mappingCount: mappings.length,
        });

        // Enrich complete; reconcile the cloud snapshot atomically. This is the
        // hard gate for success: a failed reconciliation throws and the import
        // is not reported as complete.
        completeStep("enrich");
        setStatus("Saving to cloud…");
        console.log("[Import] reconcileImportSnapshot start");
        const reconciliation = await runGuardedImportWrite(operation, () =>
          reconcileImportSnapshot(operation.userId, {
            films: norm.films,
            watchEvents: norm.watchEvents,
            mappings,
          }),
        );
        console.log("[Import] reconcileImportSnapshot complete", reconciliation);

        // Cloud persistence succeeded; move to learn.
        setCurrentStep("learn");

        // Required post-import work: seed preferences then learn from history.
        // Both must succeed before the import is reported complete.
        console.log("[Import] Starting required post-import work");
        setStatus("Analyzing your taste preferences…");
        await operation.assertCurrent();

        // Use the in-memory snapshot mappings rather than re-reading the
        // cloud table, so learning reflects exactly what was reconciled.
        const uriToTmdbId = new Map(
          mappings.map((m) => [m.uri, m.tmdbId]),
        );
        console.log(
          `[Import] Using ${uriToTmdbId.size} TMDB mappings for learning`,
        );

        // Prepare films with TMDB IDs for seeding
        const filmsForSeeding = norm.films
          .filter((f) => uriToTmdbId.has(f.uri))
          .map((f) => ({
            tmdbId: uriToTmdbId.get(f.uri)!,
            rating: f.rating ?? undefined,
            liked: f.liked ?? undefined,
            rewatch: f.rewatch ?? undefined,
          }));

        setStatus("Learning your preferences…");
        await runRequiredPostImportWork({
          hasSupabase: Boolean(supabase),
          seedPreferences: async () => {
            const result = await runGuardedImportWrite(operation, () =>
              seedPreferencesFromHistory(
                operation.userId,
                filmsForSeeding,
                (current, total) => {
                  setStatus(`Learning preferences… ${current}/${total}`);
                },
              ),
            );
            // Fail closed: seeding must report success before learning runs.
            if (!result || result.success !== true) {
              throw new Error(
                "Preference seeding did not complete successfully",
              );
            }
            return result;
          },
          learnFromHistory: () =>
            runGuardedImportWrite(operation, () =>
              learnFromHistoricalData(operation.userId),
            ),
        });
        console.log("[Import] Required post-import work complete");

        // All done!
        completeStep("learn");
        setCurrentStep("complete");
        setStatus(
          "✓ Import complete! Your personalized recommendations are ready.",
        );
      } catch (e: any) {
        console.error("[Import] error in handleFiles workflow", e);
        const resolution = resolveImportFailure(e);
        setCurrentStep(resolution.step);
        setError(resolution.message);
        setStatus("");
      } finally {
        operation.cancel();
      }
      console.log("[Import] handleFiles end");
    },
    [setFilmsForIdentity, autoMapBatch, completeStep],
  );

  // ZIP-only upload gate. The UI advertises a single Letterboxd export ZIP; any
  // other selection (loose CSVs, folders, multiple ZIPs, non-ZIP) is rejected
  // with an actionable message instead of silently doing nothing.
  const beginImportFromSelection = useCallback(
    (files: File[]) => {
      const selection = selectImportUpload(files);
      if (selection.kind === "rejected") {
        console.warn("[Import] rejected upload selection", {
          message: selection.message,
          fileCount: files.length,
        });
        setError(selection.message);
        setStatus("");
        setCurrentStep("upload");
        setCompletedSteps(new Set());
        return;
      }
      void handleFiles([selection.file]);
    },
    [handleFiles],
  );

  const summary = useMemo(() => {
    const s: { label: string; count: number }[] = [];
    if (data.watched) s.push({ label: "watched", count: data.watched.length });
    if (data.diary) {
      s.push({ label: "diary", count: data.diary.length });
      // Calculate rewatches
      const rewatchCount = data.diary.filter(
        (entry) => (entry["Rewatch"] || "").toLowerCase() === "yes",
      ).length;
      if (rewatchCount > 0) {
        s.push({ label: "rewatches", count: rewatchCount });
      }
    }
    if (data.ratings) s.push({ label: "ratings", count: data.ratings.length });
    if (data.watchlist)
      s.push({ label: "watchlist", count: data.watchlist.length });
    if (data.likesFilms)
      s.push({ label: "likes/films", count: data.likesFilms.length });
    if (data.reviews) s.push({ label: "reviews", count: data.reviews.length });
    if (data.lists)
      s.push({ label: "lists (entries)", count: data.lists.length });
    if (data.tags) s.push({ label: "tags", count: data.tags.length });
    return s;
  }, [data]);

  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-2">Import Letterboxd data</h1>
      <p className="text-gray-600 text-sm mb-6">
        Upload your complete Letterboxd export ZIP. Parsing happens locally in
        your browser. The ZIP must contain the full export — watched.csv,
        diary.csv, ratings.csv, watchlist.csv, likes/films.csv, and reviews.csv
        — because a full import replaces your cloud data and requires all six.
      </p>

      {/* Step Progress Indicator */}
      <StepIndicator
        currentStep={currentStep}
        completedSteps={completedSteps}
      />

      {/* Error message - always visible regardless of step so failures are
          actionable even when upload controls are restored */}
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm font-medium text-red-800">{error}</p>
        </div>
      )}

      {/* Upload Area - shown when idle or in early stages */}
      {(currentStep === "idle" || currentStep === "upload") && (
        <div className="space-y-3">
          {/* Force Re-enrich Option */}
          <label className="flex items-center gap-2 text-sm text-gray-700 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100">
            <input
              type="checkbox"
              checked={forceReenrich}
              onChange={(e) => setForceReenrich(e.target.checked)}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <div>
              <span className="font-medium">Force re-enrich all films</span>
              <p className="text-xs text-gray-500 mt-0.5">
                Re-fetch TMDB data for all films, even if previously mapped. Use
                this if your stats/suggestions are missing data.
              </p>
            </div>
          </label>

          <input
            type="file"
            accept=".zip"
            className="block text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            onChange={(e) => {
              const input = e.target;
              if (!input.files) return;
              // Copy synchronously and clear the input so the same file can be
              // selected again for a retry; a live FileList would be emptied by
              // the reset and re-selecting an identical file would otherwise fire
              // no change event.
              const copy = Array.from(input.files);
              input.value = "";
              beginImportFromSelection(copy);
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("border-blue-400", "bg-blue-50");
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove("border-blue-400", "bg-blue-50");
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("border-blue-400", "bg-blue-50");
              // ZIP-only: collect the dropped files and let the shared gate
              // reject CSVs, folders, and non-ZIP drops with an actionable error
              // rather than silently no-op'ing.
              const files = e.dataTransfer.files
                ? Array.from(e.dataTransfer.files)
                : [];
              beginImportFromSelection(files);
            }}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-sm text-gray-500 bg-gray-50 transition-colors cursor-pointer hover:border-gray-400"
          >
            <svg
              className="mx-auto h-10 w-10 text-gray-400 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="font-medium text-gray-700">
              Drop your complete export ZIP here
            </p>
            <p className="text-xs text-gray-500 mt-1">
              a single Letterboxd export ZIP (CSV files and folders are not
              supported)
            </p>
          </div>
        </div>
      )}

      {/* Progress Area - shown during import */}
      {currentStep !== "idle" && currentStep !== "upload" && (
        <div className="space-y-4">
          {/* Reimport detection message */}
          {newFilmsBreakdown &&
            newFilmsBreakdown.isReimport &&
            currentStep === "enrich" && (
              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <p className="text-sm font-medium text-green-800">
                  🔄 Reimport detected — enriching {newFilmsBreakdown.total} new
                  film{newFilmsBreakdown.total !== 1 ? "s" : ""} only
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Previously imported films are already mapped. Use &quot;Force
                  re-enrich&quot; to update all.
                </p>
              </div>
            )}

          {/* Status message */}
          {status && (
            <div
              className={`p-4 rounded-lg ${currentStep === "complete" ? "bg-green-50 border border-green-200" : "bg-blue-50 border border-blue-200"}`}
            >
              <p
                className={`text-sm font-medium ${currentStep === "complete" ? "text-green-800" : "text-blue-800"}`}
              >
                {status}
              </p>
            </div>
          )}

          {/* Detailed progress for enrich step */}
          {currentStep === "enrich" && mappingProgress && (
            <div className="bg-white border rounded-lg p-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-700 font-medium">
                  Mapping films to TMDB
                </span>
                <span className="text-gray-600 font-mono">
                  {mappingProgress.current} / {mappingProgress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(mappingProgress.current / mappingProgress.total) * 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Fetching movie details, ratings, and streaming info from
                multiple sources…
              </p>

              {/* New films breakdown */}
              {newFilmsBreakdown && newFilmsBreakdown.isReimport && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-medium text-green-700 mb-2">
                    🆕 New since last import:
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {newFilmsBreakdown.newWatched > 0 && (
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newWatched} watched
                      </span>
                    )}
                    {newFilmsBreakdown.newWatchlist > 0 && (
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newWatchlist} watchlist
                      </span>
                    )}
                    {newFilmsBreakdown.newRatings > 0 && (
                      <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newRatings} rated
                      </span>
                    )}
                    {newFilmsBreakdown.newLikes > 0 && (
                      <span className="bg-pink-100 text-pink-800 px-2 py-1 rounded-full">
                        {newFilmsBreakdown.newLikes} liked
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Parsed Summary */}
      {summary.length > 0 && (
        <div className="mt-6 bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Parsed from your export
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summary.map((s) => (
              <div key={s.label} className="bg-gray-50 rounded p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {s.count.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 capitalize">{s.label}</p>
              </div>
            ))}
          </div>
          {distinct != null && (
            <p className="text-sm text-gray-600 mt-4 pt-3 border-t">
              <span className="font-medium">{distinct.toLocaleString()}</span>{" "}
              unique films detected
            </p>
          )}
        </div>
      )}

      {/* Complete state - show next steps */}
      {currentStep === "complete" && (
        <div className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6 text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            🎬 You&apos;re all set!
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Your taste profile has been built from your watch history. Ready to
            discover your next favorite film?
          </p>
          <div className="flex gap-3 justify-center">
            <a
              href="/suggest"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Get Suggestions →
            </a>
            <a
              href="/stats"
              className="inline-flex items-center px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border hover:bg-gray-50 transition-colors"
            >
              View Your Stats
            </a>
          </div>
        </div>
      )}

      {/* Unmapped Films Notification */}
      {unmappedFilms.length > 0 && currentStep === "complete" && (
        <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {unmappedFilms.length} film
                {unmappedFilms.length !== 1 ? "s" : ""} couldn&apos;t be matched
                automatically
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                These films need manual matching to appear in your stats and
                suggestions.
              </p>
              <button
                onClick={() => setShowUnmappedModal(true)}
                className="mt-3 inline-flex items-center px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded transition-colors"
              >
                Fix Unmapped Films
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unmapped Film Modal */}
      {userId && (
        <UnmappedFilmModal
          isOpen={showUnmappedModal}
          onClose={() => setShowUnmappedModal(false)}
          unmappedFilms={unmappedFilms}
          userId={userId}
          onFilmMapped={(uri, tmdbId) => {
            // Remove the mapped film from the unmapped list
            setUnmappedFilms((prev) => prev.filter((f) => f.uri !== uri));
            // Dispatch event to update other components
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("lettr:mappings-updated"));
            }
          }}
        />
      )}
    </AuthGate>
  );
}
