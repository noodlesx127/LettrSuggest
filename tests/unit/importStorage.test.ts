import { describe, expect, it, vi } from "vitest";

import {
  createImportOperationGuard,
  createImportStateController,
  createImportStateLoader,
  getImportStorageKey,
  ImportIdentityChangedError,
  loadImportState,
  loadLocalFilms,
  runForImportIdentity,
  runGuardedImportWrite,
  saveLocalFilms,
  type ImportStorageLike,
} from "@/lib/importStorage";
import type { FilmEvent } from "@/lib/normalize";

function createMemoryStorage(): ImportStorageLike & { keys: string[] } {
  const values = new Map<string, string>();

  return {
    keys: [],
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
      this.keys.splice(0, this.keys.length, ...values.keys());
    },
    removeItem(key) {
      values.delete(key);
      this.keys.splice(0, this.keys.length, ...values.keys());
    },
  };
}

const anonymousFilm: FilmEvent = {
  uri: "letterboxd://film/anonymous",
  title: "Anonymous Film",
  year: 2020,
};

const userAFilm: FilmEvent = {
  uri: "letterboxd://film/user-a",
  title: "User A Film",
  year: 2021,
};

const userBFilm: FilmEvent = {
  uri: "letterboxd://film/user-b",
  title: "User B Film",
  year: 2022,
};

describe("import storage namespaces", () => {
  it("uses an explicit anonymous namespace and user-specific keys", () => {
    const storage = createMemoryStorage();

    saveLocalFilms(null, [anonymousFilm], storage);
    saveLocalFilms("user-a", [userAFilm], storage);
    saveLocalFilms("user-b", [userBFilm], storage);

    expect(getImportStorageKey(null)).toBe("lettr-import-v1:anonymous");
    expect(getImportStorageKey("user-a")).toBe("lettr-import-v1:user:user-a");
    expect(getImportStorageKey("user-b")).toBe("lettr-import-v1:user:user-b");
    expect(storage.keys).toEqual([
      "lettr-import-v1:anonymous",
      "lettr-import-v1:user:user-a",
      "lettr-import-v1:user:user-b",
    ]);
    expect(storage.getItem("lettr-import-v1")).toBeNull();
    expect(loadLocalFilms("user-a", storage)).toEqual([userAFilm]);
    expect(loadLocalFilms("user-b", storage)).toEqual([userBFilm]);
  });

  it("never reads the legacy global key for an authenticated user", () => {
    const storage = createMemoryStorage();
    storage.setItem("lettr-import-v1", JSON.stringify([anonymousFilm]));

    expect(loadLocalFilms("user-a", storage)).toBeNull();
  });

  it("treats a successful empty cloud snapshot as authoritative", async () => {
    const storage = createMemoryStorage();
    saveLocalFilms("user-a", [userAFilm, userBFilm], storage);
    const loadCloud = vi.fn(async () => [] as FilmEvent[]);

    const films = await loadImportState("user-a", loadCloud, storage);

    expect(loadCloud).toHaveBeenCalledWith("user-a");
    expect(films).toEqual([]);
    expect(loadLocalFilms("user-a", storage)).toEqual([]);
  });

  it("uses only the authenticated namespace when cloud loading fails", async () => {
    const storage = createMemoryStorage();
    saveLocalFilms(null, [anonymousFilm], storage);
    saveLocalFilms("user-a", [userAFilm], storage);
    const loadCloud = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    const films = await loadImportState("user-a", loadCloud, storage);

    expect(films).toEqual([userAFilm]);
    expect(films).not.toEqual([anonymousFilm]);
  });

  it("does not use authenticated local state without a cloud load attempt", async () => {
    const storage = createMemoryStorage();
    saveLocalFilms("user-a", [userAFilm], storage);

    await expect(
      loadImportState("user-a", undefined, storage),
    ).resolves.toBeNull();
  });

  it("keeps anonymous, user A, user B, and logout state isolated", async () => {
    const storage = createMemoryStorage();
    saveLocalFilms(null, [anonymousFilm], storage);
    saveLocalFilms("user-a", [userAFilm], storage);
    saveLocalFilms("user-b", [userBFilm], storage);
    const loadCloud = vi.fn(async () => {
      throw new Error("offline");
    });

    expect(await loadImportState(null, undefined, storage)).toEqual([
      anonymousFilm,
    ]);
    expect(await loadImportState("user-a", loadCloud, storage)).toEqual([
      userAFilm,
    ]);
    expect(await loadImportState("user-b", loadCloud, storage)).toEqual([
      userBFilm,
    ]);
    expect(await loadImportState(null, undefined, storage)).toEqual([
      anonymousFilm,
    ]);
  });

  it("does not apply a stale async load after an identity transition", async () => {
    let resolveA!: (films: FilmEvent[]) => void;
    let resolveB!: (films: FilmEvent[]) => void;
    const loadCloud = vi.fn(
      (userId: string) =>
        new Promise<FilmEvent[]>((resolve) => {
          if (userId === "user-a") resolveA = resolve;
          else resolveB = resolve;
        }),
    );
    const loader = createImportStateLoader({ loadCloud });

    const userALoad = loader.load("user-a");
    const userBLoad = loader.load("user-b");
    resolveB([userBFilm]);
    resolveA([userAFilm]);

    await expect(userBLoad).resolves.toEqual({
      status: "applied",
      films: [userBFilm],
    });
    await expect(userALoad).resolves.toEqual({ status: "stale" });
  });

  it("does not let a stale cloud response overwrite a newer local cache", async () => {
    const storage = createMemoryStorage();
    let resolveOlder!: (films: FilmEvent[]) => void;
    let resolveNewer!: (films: FilmEvent[]) => void;
    const loadCloud = vi
      .fn<() => Promise<FilmEvent[]>>()
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveOlder = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveNewer = resolve)),
      );
    const loader = createImportStateLoader({ loadCloud, storage });

    const olderLoad = loader.load("user-a");
    const newerLoad = loader.load("user-a");
    resolveNewer([userBFilm]);
    await newerLoad;
    resolveOlder([userAFilm]);
    await olderLoad;

    expect(loadLocalFilms("user-a", storage)).toEqual([userBFilm]);
  });

  it("reloads from the current identity after a provider remount", async () => {
    const storage = createMemoryStorage();
    const firstLoadCloud = vi.fn(async () => [userAFilm]);
    const secondLoadCloud = vi.fn(async () => [] as FilmEvent[]);

    const firstLoader = createImportStateLoader({
      loadCloud: firstLoadCloud,
      storage,
    });
    await expect(firstLoader.load("user-a")).resolves.toEqual({
      status: "applied",
      films: [userAFilm],
    });

    const remountedLoader = createImportStateLoader({
      loadCloud: secondLoadCloud,
      storage,
    });
    await expect(remountedLoader.load("user-a")).resolves.toEqual({
      status: "applied",
      films: [],
    });
    expect(secondLoadCloud).toHaveBeenCalledWith("user-a");
  });

  it("clears immediately and reloads for every auth identity transition", async () => {
    const storage = createMemoryStorage();
    saveLocalFilms(null, [anonymousFilm], storage);
    const resolvers = new Map<string, (films: FilmEvent[]) => void>();
    const loadCloud = vi.fn(
      (userId: string) =>
        new Promise<FilmEvent[]>((resolve) => {
          resolvers.set(userId, resolve);
        }),
    );
    const updates: Array<{
      identity: string | null;
      films: FilmEvent[] | null;
      loading: boolean;
    }> = [];
    const controller = createImportStateController({
      loadCloud,
      storage,
      onStateChange: (update) => updates.push(update),
    });

    const anonymousLoad = controller.transition(null);
    expect(updates[0]).toEqual({
      identity: null,
      films: null,
      loading: true,
    });
    await anonymousLoad;
    expect(updates.at(-1)).toEqual({
      identity: null,
      films: [anonymousFilm],
      loading: false,
    });

    const userALoad = controller.transition("user-a");
    expect(updates.at(-1)).toEqual({
      identity: "user-a",
      films: null,
      loading: true,
    });
    const userBLoad = controller.transition("user-b");
    expect(updates.at(-1)).toEqual({
      identity: "user-b",
      films: null,
      loading: true,
    });

    resolvers.get("user-b")?.([userBFilm]);
    await userBLoad;
    expect(updates.at(-1)).toEqual({
      identity: "user-b",
      films: [userBFilm],
      loading: false,
    });
    resolvers.get("user-a")?.([userAFilm]);
    await userALoad;
    expect(updates.at(-1)).not.toEqual({
      identity: "user-a",
      films: [userAFilm],
      loading: false,
    });

    const logoutLoad = controller.transition(null);
    expect(updates.at(-1)).toEqual({
      identity: null,
      films: null,
      loading: true,
    });
    await logoutLoad;
    expect(updates.at(-1)).toEqual({
      identity: null,
      films: [anonymousFilm],
      loading: false,
    });
  });

  it("keeps an explicit import update when an older provider load resolves", async () => {
    const storage = createMemoryStorage();
    let resolveCloud!: (films: FilmEvent[]) => void;
    const updates: unknown[] = [];
    const controller = createImportStateController({
      loadCloud: () =>
        new Promise<FilmEvent[]>((resolve) => {
          resolveCloud = resolve;
        }),
      storage,
      onStateChange: (update) => updates.push(update),
    });

    const pendingLoad = controller.transition("user-a");
    controller.apply("user-a", [userBFilm]);
    resolveCloud([userAFilm]);
    await pendingLoad;

    expect(updates.at(-1)).toEqual({
      identity: "user-a",
      films: [userBFilm],
      loading: false,
    });
    expect(loadLocalFilms("user-a", storage)).toEqual([userBFilm]);
  });

  it("reloads the current identity when the provider is remounted", async () => {
    const storage = createMemoryStorage();
    const firstUpdates: unknown[] = [];
    const firstController = createImportStateController({
      loadCloud: vi.fn(async () => [userAFilm]),
      storage,
      onStateChange: (update) => firstUpdates.push(update),
    });
    await firstController.transition("user-a");
    firstController.dispose();

    const secondUpdates: unknown[] = [];
    const secondLoadCloud = vi.fn(async () => [] as FilmEvent[]);
    const remountedController = createImportStateController({
      loadCloud: secondLoadCloud,
      storage,
      onStateChange: (update) => secondUpdates.push(update),
    });
    await remountedController.transition("user-a");

    expect(firstUpdates.at(-1)).toEqual({
      identity: "user-a",
      films: [userAFilm],
      loading: false,
    });
    expect(secondLoadCloud).toHaveBeenCalledWith("user-a");
    expect(secondUpdates).toEqual([
      { identity: "user-a", films: null, loading: true },
      { identity: "user-a", films: [], loading: false },
    ]);
  });

  it("blocks every later import write after the authenticated identity changes", async () => {
    let currentIdentity: string | null = "user-a";
    let releaseImport: () => void = () => undefined;
    const writes: string[] = [];
    const operation = createImportOperationGuard(
      "user-a",
      () => currentIdentity,
    );

    const importWork = (async () => {
      await runGuardedImportWrite(operation, () => {
        writes.push(`setFilms:${operation.userId}`);
      });
      await new Promise<void>((resolve) => {
        releaseImport = resolve;
      });
      await runGuardedImportWrite(operation, () => {
        writes.push(`saveIndexedDb:${operation.userId}`);
      });
      await runGuardedImportWrite(operation, () => {
        writes.push(`saveCloud:${operation.userId}`);
      });
    })();

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    currentIdentity = "user-b";
    releaseImport();

    await expect(importWork).rejects.toMatchObject({
      name: "ImportIdentityChangedError",
    });
    expect(writes).toEqual(["setFilms:user-a"]);
    expect(writes).not.toContain("saveCloud:user-b");
    expect(operation.userId).toBe("user-a");
  });

  it("applies a provider write only to the identity captured by the import", () => {
    const writes: string[] = [];

    expect(() =>
      runForImportIdentity("user-a", "user-b", () => writes.push("stale")),
    ).toThrow(ImportIdentityChangedError);
    expect(writes).toEqual([]);

    runForImportIdentity("user-a", "user-a", () => writes.push("current"));
    expect(writes).toEqual(["current"]);
  });
});
