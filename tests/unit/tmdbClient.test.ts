import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTmdb } from "@/app/api/v1/_lib/tmdb";
import { ApiError } from "@/app/api/v1/_lib/responseEnvelope";

describe("fetchTmdb", () => {
  const previousApiKey = process.env.TMDB_API_KEY;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TMDB_API_KEY = "test-tmdb-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();

    if (previousApiKey === undefined) {
      delete process.env.TMDB_API_KEY;
    } else {
      process.env.TMDB_API_KEY = previousApiKey;
    }
  });

  it("aborts a request after exactly 5,000ms", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;

      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchTmdb("/movie/101");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/movie/101"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(requestSignal?.aborted).toBe(false);

    const rejection = request.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("classifies a controller timeout as a 504 ApiError", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchTmdb("/movie/101");
    const rejection = request.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        signal: expect.objectContaining({ aborted: false }),
      }),
    );

    await vi.advanceTimersByTimeAsync(1);
    const error = await rejection;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 504,
      code: "UPSTREAM_ERROR",
    });
    expect((error as ApiError).message).toBe("TMDB request timed out");
  });
});
