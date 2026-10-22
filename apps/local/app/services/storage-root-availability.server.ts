import { Effect } from "effect";
import {
  offlineRootMessage,
  storageRootOfflineErrorOf,
  type StorageRootOfflineError,
} from "@/packages/storage";
import { rootIsOnline } from "@/packages/storage/server";
import { readStorageRootsOrNone } from "./storage-roots";

/** An Offline Storage Root as the app banner shows it. */
export interface OfflineStorageRoot {
  readonly root: string;
  readonly message: string;
}

/**
 * Which Storage Roots are Offline, checked at most once per `ttlMs` and
 * shared by every request, so the app-level banner costs one top-level
 * listing per root now and then. Logs one line each time a root goes
 * Offline or comes back, never one per request.
 */
export const makeStorageRootAvailability = <R>(opts: {
  readonly isOnline: (root: string) => Effect.Effect<boolean, never, R>;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly ttlMs: number;
}) => {
  const online = new Map<string, boolean>();
  let checkedAt = Number.NEGATIVE_INFINITY;

  /** Record what was seen of a root; log only when that changes. */
  const observe = (root: string, isOnline: boolean) => {
    const was = online.get(root) ?? true;
    online.set(root, isOnline);
    if (was === isOnline) return;
    opts.log(
      isOnline
        ? `[storage] Storage Root ${root} is back online`
        : `[storage] ${offlineRootMessage(root)}`
    );
  };

  const offlineRoots = (
    roots: readonly string[]
  ): Effect.Effect<OfflineStorageRoot[], never, R> =>
    Effect.gen(function* () {
      if (opts.now() - checkedAt >= opts.ttlMs) {
        checkedAt = opts.now();
        const seen = yield* Effect.forEach(roots, opts.isOnline, {
          concurrency: "unbounded",
        });
        roots.forEach((root, i) => observe(root, seen[i]!));
      }
      return roots
        .filter((root) => online.get(root) === false)
        .map((root) => ({ root, message: offlineRootMessage(root) }));
    });

  return { offlineRoots, observe };
};

const availability = makeStorageRootAvailability({
  isOnline: rootIsOnline,
  now: () => Date.now(),
  log: (line) => console.warn(line),
  ttlMs: 15_000,
});

/** The Storage Roots that are Offline right now (cached), for the app banner. */
export const offlineStorageRoots = Effect.suspend(() =>
  availability.offlineRoots(readStorageRootsOrNone())
);

/**
 * The failure as a {@link StorageRootOfflineError} when it says a Storage
 * Root is Offline (and noted, so the log says so once), else `undefined`.
 * For a route's answer (`route-action.server.ts`).
 */
export const asStorageRootOffline = (
  error: unknown
): StorageRootOfflineError | undefined => {
  const offline = storageRootOfflineErrorOf(error, readStorageRootsOrNone());
  if (offline !== undefined) availability.observe(offline.root, false);
  return offline;
};
