import { Data } from "effect";
import { rootLabel } from "./storage-roots";

/**
 * A Storage Root is Offline: the drive is unplugged, not mounted, or a stale
 * WSL mount that answers ENODEV. Expected, and distinct from a file that is
 * missing on a root that is there ({@link StorageFileNotFoundError}): nothing
 * on that root can be read or written until it is back.
 */
export class StorageRootOfflineError extends Data.TaggedError(
  "StorageRootOfflineError"
)<{
  readonly root: string;
  readonly message: string;
}> {}

/** What Matt is told about an Offline root: which drive, and what to do. */
export const offlineRootMessage = (root: string): string => {
  const label = rootLabel(root);
  return label === root
    ? `Storage Root ${root} is offline — reconnect it, then remount ${root}`
    : `Storage Root ${root} is offline — reconnect drive ${label}, then remount ${root}`;
};

/**
 * The error codes a path on a root that is not there fails with. ENOENT is
 * one only for the root itself: under a root it is a missing file.
 */
const OFFLINE_CODES = new Set([
  "ENODEV",
  "EIO",
  "ETIMEDOUT",
  "ENOTCONN",
  "ESTALE",
  "EHOSTDOWN",
]);

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;

/**
 * The code and path of a filesystem failure: an `@effect/platform`
 * SystemError (the Node error is its `cause`) or a Node error itself.
 */
const codeAndPath = (error: unknown) => {
  const code = field(error, "code") ?? field(field(error, "cause"), "code");
  const path = field(error, "pathOrDescriptor") ?? field(error, "path");
  return typeof code === "string" && typeof path === "string"
    ? { code, path }
    : undefined;
};

/**
 * The failure as a {@link StorageRootOfflineError} when it says a Storage
 * Root is Offline, else `undefined`. An error that already is one comes back
 * as it is.
 */
export const storageRootOfflineErrorOf = (
  error: unknown,
  roots: readonly string[]
): StorageRootOfflineError | undefined => {
  if (error instanceof StorageRootOfflineError) return error;
  const failure = codeAndPath(error);
  if (failure === undefined) return undefined;
  const { code, path } = failure;
  const root = roots.find((r) => path === r || path.startsWith(`${r}/`));
  if (root === undefined) return undefined;
  const offline =
    OFFLINE_CODES.has(code) || (code === "ENOENT" && path === root);
  return offline
    ? new StorageRootOfflineError({ root, message: offlineRootMessage(root) })
    : undefined;
};
