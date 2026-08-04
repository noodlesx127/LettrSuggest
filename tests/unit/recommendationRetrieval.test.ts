import { afterEach, describe, expect, it, vi } from "vitest";

import {
  retrieveServerCandidates,
  type ServerCandidateProviderRequest,
  type ServerCandidateTasteProfile,
  type ServerCandidateUserContext,
} from "@/lib/recommendationRetrieval";

const SECRET_ERROR_MESSAGE =
  "upstream secret token=C:\\private\\tmdb-export.json should-not-leak";

function emptyUserContext(): ServerCandidateUserContext {
  return {
    films: [],
    mappings: new Map(),
    blockedIds: new Set(),
  };
}

const tasteProfile: ServerCandidateTasteProfile = { topGenres: [] };

function fetchFailureLogs(calls: readonly (readonly unknown[])[]) {
  return calls.filter((args) =>
    args.some(
      (arg) =>
        typeof arg === "string" && arg.includes("recommendations fetch"),
    ),
  );
}

describe("recommendation retrieval failure logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a fixed bounded code plus numeric tmdbId when the primary seed request fails", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const requestedPaths: string[] = [];
    const providerRows = async (request: ServerCandidateProviderRequest) => {
      requestedPaths.push(request.path);
      if (request.path === "/movie/101/recommendations") {
        throw new Error(SECRET_ERROR_MESSAGE);
      }
      if (request.path === "/movie/101/similar") {
        return [{ tmdbId: 555, source: "tmdb" }];
      }
      return [];
    };

    const result = await retrieveServerCandidates(
      "retrieval-log-user",
      emptyUserContext(),
      tasteProfile,
      [101],
      { requestSeed: "retrieval-log-seed", providerRows },
    );

    // The /similar fallback remains effective after a primary failure.
    expect(result.candidateIds).toContain(555);
    expect(requestedPaths).toContain("/movie/101/recommendations");
    expect(requestedPaths).toContain("/movie/101/similar");

    const failureLogs = fetchFailureLogs(errorSpy.mock.calls);
    expect(failureLogs.length).toBeGreaterThan(0);
    // Bounded descriptor: fixed code plus the numeric seed ID only.
    expect(
      failureLogs.some((args) =>
        args.some(
          (arg) =>
            typeof arg === "object" &&
            arg !== null &&
            (arg as Record<string, unknown>).code ===
              "RETRIEVAL_PRIMARY_ERROR" &&
            (arg as Record<string, unknown>).tmdbId === 101,
        ),
      ),
    ).toBe(true);

    // Never the raw error object, its name, or its message.
    const leaksErrorObject = errorSpy.mock.calls.some((args) =>
      args.some(
        (arg) =>
          arg instanceof Error ||
          (typeof arg === "object" &&
            arg !== null &&
            Object.values(arg as Record<string, unknown>).some(
              (value) => value instanceof Error,
            )),
      ),
    );
    expect(leaksErrorObject).toBe(false);
    const allErrorOutput = JSON.stringify(errorSpy.mock.calls);
    expect(allErrorOutput).not.toContain(SECRET_ERROR_MESSAGE);
    expect(allErrorOutput).not.toContain("should-not-leak");
  });

  it("keeps the /similar fallback unused and logs nothing when the primary request succeeds", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const requestedPaths: string[] = [];
    const providerRows = async (request: ServerCandidateProviderRequest) => {
      requestedPaths.push(request.path);
      if (request.path === "/movie/202/recommendations") {
        return [{ tmdbId: 777, source: "tmdb" }];
      }
      return [];
    };

    const result = await retrieveServerCandidates(
      "retrieval-log-user",
      emptyUserContext(),
      tasteProfile,
      [202],
      { requestSeed: "retrieval-success-seed", providerRows },
    );

    expect(result.candidateIds).toContain(777);
    expect(requestedPaths).toContain("/movie/202/recommendations");
    expect(requestedPaths).not.toContain("/movie/202/similar");
    expect(fetchFailureLogs(errorSpy.mock.calls)).toEqual([]);
  });
});
