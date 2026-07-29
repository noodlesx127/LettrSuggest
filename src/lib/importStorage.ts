import type { FilmEvent } from "@/lib/normalize";

export type ImportStorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type ImportIdentity = string | null;
export type CloudFilmLoader = (userId: string) => Promise<FilmEvent[]>;

type ImportStateResolution =
  | { source: "cloud"; films: FilmEvent[] }
  | { source: "local" | "none"; films: FilmEvent[] | null };

const IMPORT_STORAGE_PREFIX = "lettr-import-v1";

function getStorage(storage?: ImportStorageLike): ImportStorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getImportStorageKey(userId: ImportIdentity): string {
  return userId === null
    ? `${IMPORT_STORAGE_PREFIX}:anonymous`
    : `${IMPORT_STORAGE_PREFIX}:user:${encodeURIComponent(userId)}`;
}

export function loadLocalFilms(
  userId: ImportIdentity,
  storage?: ImportStorageLike,
): FilmEvent[] | null {
  const target = getStorage(storage);
  if (!target) return null;

  try {
    const raw = target.getItem(getImportStorageKey(userId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FilmEvent[]) : null;
  } catch {
    return null;
  }
}

export function saveLocalFilms(
  userId: ImportIdentity,
  films: FilmEvent[],
  storage?: ImportStorageLike,
): void {
  const target = getStorage(storage);
  if (!target) return;

  try {
    target.setItem(getImportStorageKey(userId), JSON.stringify(films));
  } catch {
    // Local persistence is a best-effort cache; cloud state remains authoritative.
  }
}

export function clearLocalFilms(
  userId: ImportIdentity,
  storage?: ImportStorageLike,
): void {
  const target = getStorage(storage);
  if (!target) return;

  try {
    target.removeItem(getImportStorageKey(userId));
  } catch {
    // Ignore storage quota and privacy-mode failures.
  }
}

async function resolveImportState(
  userId: ImportIdentity,
  loadCloud?: CloudFilmLoader,
  storage?: ImportStorageLike,
): Promise<ImportStateResolution> {
  const localFilms = loadLocalFilms(userId, storage);

  // Anonymous state has no cloud owner. Authenticated callers must provide a
  // cloud loader so a missing loader cannot accidentally use another namespace.
  if (userId === null) {
    return { source: localFilms ? "local" : "none", films: localFilms };
  }
  if (!loadCloud) return { source: "none", films: null };

  try {
    const cloudFilms = await loadCloud(userId);
    return { source: "cloud", films: cloudFilms };
  } catch {
    // The authenticated namespace is the only local fallback after a cloud
    // failure. Anonymous data is never promoted into a user namespace.
    return { source: localFilms ? "local" : "none", films: localFilms };
  }
}

export async function loadImportState(
  userId: ImportIdentity,
  loadCloud?: CloudFilmLoader,
  storage?: ImportStorageLike,
): Promise<FilmEvent[] | null> {
  const resolution = await resolveImportState(userId, loadCloud, storage);
  if (resolution.source === "cloud") {
    // A successful empty cloud response is a real snapshot, not a signal to
    // fall back to a larger stale local collection.
    saveLocalFilms(userId, resolution.films, storage);
  }
  return resolution.films;
}

export type ImportLoadResult =
  | { status: "applied"; films: FilmEvent[] | null }
  | { status: "stale" };

export function createImportStateLoader(options: {
  loadCloud?: CloudFilmLoader;
  storage?: ImportStorageLike;
} = {}) {
  let generation = 0;

  return {
    async load(userId: ImportIdentity): Promise<ImportLoadResult> {
      const requestGeneration = ++generation;
      const resolution = await resolveImportState(
        userId,
        options.loadCloud,
        options.storage,
      );

      if (requestGeneration !== generation) return { status: "stale" };
      if (resolution.source === "cloud") {
        saveLocalFilms(userId, resolution.films, options.storage);
      }
      return { status: "applied", films: resolution.films };
    },
    cancel() {
      generation += 1;
    },
  };
}

export type ImportStateUpdate = {
  identity: ImportIdentity;
  films: FilmEvent[] | null;
  loading: boolean;
};

export function createImportStateController(options: {
  loadCloud?: CloudFilmLoader;
  storage?: ImportStorageLike;
  onStateChange: (update: ImportStateUpdate) => void;
}) {
  let currentIdentity: ImportIdentity | undefined;
  let disposed = false;
  const loader = createImportStateLoader(options);

  return {
    transition(nextIdentity: ImportIdentity): Promise<void> {
      if (
        disposed ||
        (currentIdentity !== undefined && currentIdentity === nextIdentity)
      ) {
        return Promise.resolve();
      }

      currentIdentity = nextIdentity;
      options.onStateChange({
        identity: nextIdentity,
        films: null,
        loading: true,
      });

      return loader.load(nextIdentity).then((result) => {
        if (
          disposed ||
          result.status === "stale" ||
          currentIdentity !== nextIdentity
        ) {
          return;
        }

        options.onStateChange({
          identity: nextIdentity,
          films: result.films,
          loading: false,
        });
      });
    },
    getIdentity(): ImportIdentity | undefined {
      return currentIdentity;
    },
    apply(identity: ImportIdentity, films: FilmEvent[] | null): void {
      runForImportIdentity(
        identity,
        disposed ? undefined : currentIdentity,
        () => {
          loader.cancel();
          if (films) saveLocalFilms(identity, films, options.storage);
          else clearLocalFilms(identity, options.storage);
          options.onStateChange({ identity, films, loading: false });
        },
      );
    },
    dispose() {
      disposed = true;
      loader.cancel();
    },
  };
}

export class ImportIdentityChangedError extends Error {
  constructor() {
    super("Import identity changed");
    this.name = "ImportIdentityChangedError";
  }
}

export function runForImportIdentity<T>(
  expectedIdentity: ImportIdentity,
  currentIdentity: ImportIdentity | undefined,
  write: () => T,
): T {
  if (currentIdentity !== expectedIdentity) {
    throw new ImportIdentityChangedError();
  }
  return write();
}

export type ImportOperationGuard = {
  readonly userId: string;
  assertCurrent: () => Promise<void>;
  cancel: () => void;
};

/**
 * Run one import persistence step only while the identity captured for the
 * operation is still the active identity. The callback starts immediately
 * after the check so callers can place the revalidation directly before a
 * write.
 */
export async function runGuardedImportWrite<T>(
  operation: ImportOperationGuard,
  write: () => T | Promise<T>,
): Promise<T> {
  await operation.assertCurrent();
  return write();
}

export function createImportOperationGuard(
  userId: string,
  readCurrentIdentity: () => ImportIdentity | Promise<ImportIdentity>,
): ImportOperationGuard {
  let cancelled = false;

  return {
    userId,
    async assertCurrent(): Promise<void> {
      if (cancelled) throw new ImportIdentityChangedError();
      const currentIdentity = await readCurrentIdentity();
      if (cancelled || currentIdentity !== userId) {
        throw new ImportIdentityChangedError();
      }
    },
    cancel() {
      cancelled = true;
    },
  };
}
