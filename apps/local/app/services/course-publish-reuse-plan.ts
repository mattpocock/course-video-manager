import { Effect } from "effect";
import { download, listFolder } from "./dropbox-http-client";

/**
 * A file in the previously Published Bundle that a Video of THIS Publish can
 * take verbatim, because Dropbox already holds exactly its bytes.
 *
 * `contentHash` is the file's Byte Hash as Dropbox reports it, and is both the
 * key the plan is indexed by and what the copy is checked against once Dropbox
 * reports it back. `sha256` and `bytes` come out of the previous manifest and
 * are owed to the new one only where this machine holds no export to digest —
 * a Video already sitting at this Publish's address with its local file since
 * collected. Everywhere else the manifest's SHA256 comes from the local Export
 * Digest, so that the receipt describes the bytes actually shipped rather than
 * the bytes some earlier release shipped.
 */
export type ReusableSource = {
  /** Full Dropbox path of the file inside the previous Bundle. */
  fromPath: string;
  /** Dropbox's block hash for that file, read from the Bundle listing. */
  contentHash: string;
  /** SHA256 of the bytes, read from the previous manifest. */
  sha256: string;
  bytes: number;
};

/**
 * What the previous Bundle can hand this one, indexed by Byte Hash.
 *
 * A Video is copyable when the Byte Hash of the export on THIS machine matches
 * a file Dropbox already holds. That is the only comparison that can tell a
 * re-export apart from an unchanged one, because the Export Hash names what the
 * renderer was asked to do and says nothing about what it produced. Indexing by
 * bytes also means a Video can be copied from ANY identical file in the
 * previous Bundle, not only from the one at its own Export Hash.
 *
 * There is no second index on the Export Hash. Every Unexported Video is
 * exported before this plan is consulted, so there is always a local file to
 * hash (issue #1562).
 */
export type ReusePlan = ReadonlyMap<string, ReusableSource>;

export const EMPTY_REUSE_PLAN: ReusePlan = new Map();

/**
 * The manifest is walked structurally rather than decoded against the Schema.
 * A previous Bundle was written by whatever code shipped at the time, and a
 * manifest this Publish cannot fully understand is a reason to reuse LESS, not
 * a reason to fail. Anything unrecognised simply contributes no entry.
 */
type ManifestVideo = {
  relativePath: string;
  sha256: string;
  bytes: number;
};

const isManifestVideo = (value: unknown): value is ManifestVideo => {
  if (typeof value !== "object" || value === null) return false;
  const { relativePath, sha256, bytes } = value as Record<string, unknown>;
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    typeof sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(sha256) &&
    typeof bytes === "number" &&
    Number.isInteger(bytes) &&
    bytes >= 0
  );
};

/** Every Video in a manifest, whatever Lesson shape it arrived in. */
const collectManifestVideos = (manifest: unknown): ManifestVideo[] => {
  const videos: ManifestVideo[] = [];
  if (typeof manifest !== "object" || manifest === null) return videos;
  const sections = (manifest as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return videos;

  for (const section of sections) {
    const lessons = (section as Record<string, unknown> | null)?.lessons;
    if (!Array.isArray(lessons)) continue;
    for (const lesson of lessons) {
      if (typeof lesson !== "object" || lesson === null) continue;
      // explainer | problem | solution — the roles a Lesson can carry.
      for (const role of ["explainer", "problem", "solution"] as const) {
        const candidate = (lesson as Record<string, unknown>)[role];
        if (isManifestVideo(candidate)) videos.push(candidate);
      }
    }
  }
  return videos;
};

/**
 * `versions/{versionFingerprint}-{assetFingerprint}` — the first two segments
 * of a manifest `relativePath`, which is written relative to the course
 * directory that holds the Commit receipt.
 */
const bundleDirOf = (relativePath: string): string | null => {
  const segments = relativePath.split("/");
  return segments.length >= 3 ? segments.slice(0, 2).join("/") : null;
};

/**
 * Work out which Videos of this Publish already exist on Dropbox, and where.
 *
 * The plan is drawn from the Commit receipt — the previously Published Bundle
 * — and nothing older. Reaching further back would make a Publish cost more
 * with every release ever made, for a hit rate that barely moves.
 *
 * TWO reads, because they carry different halves of the answer. The manifest
 * knows which files the previous Bundle holds and where; only a listing knows
 * each file's Byte Hash, which is both what this plan is indexed by and what
 * the copy is later verified against.
 *
 * This NEVER fails. An absent receipt, an unparseable manifest, a Bundle that
 * Course Builder has already archived past its 90-day TTL — each simply yields
 * a smaller plan, and every Video without an entry uploads exactly as it does
 * today.
 */
export const planBundleReuse = Effect.fn("planBundleReuse")(function* (input: {
  accessToken: string;
  dropboxCourseDir: string;
}) {
  const receipt = yield* download({
    accessToken: input.accessToken,
    path: `${input.dropboxCourseDir}/course.json`,
  }).pipe(Effect.catchTag("DropboxApiError", () => Effect.succeed(null)));
  if (receipt === null) return EMPTY_REUSE_PLAN;

  let manifest: unknown;
  try {
    manifest = JSON.parse(receipt.toString("utf-8"));
  } catch {
    return EMPTY_REUSE_PLAN;
  }

  const manifestVideos = collectManifestVideos(manifest);
  if (manifestVideos.length === 0) return EMPTY_REUSE_PLAN;

  const bundleDir = bundleDirOf(manifestVideos[0]!.relativePath);
  if (bundleDir === null) return EMPTY_REUSE_PLAN;

  const remoteEntries = yield* listFolder({
    accessToken: input.accessToken,
    path: `${input.dropboxCourseDir}/${bundleDir}`,
    recursive: true,
  }).pipe(Effect.catchTag("DropboxApiError", () => Effect.succeed([])));

  const contentHashByPath = new Map<string, { hash: string; size: number }>();
  for (const entry of remoteEntries) {
    if (entry[".tag"] !== "file") continue;
    contentHashByPath.set(entry.path_display.toLowerCase(), {
      hash: entry.content_hash,
      size: entry.size,
    });
  }

  const plan = new Map<string, ReusableSource>();
  for (const video of manifestVideos) {
    const fromPath = `${input.dropboxCourseDir}/${video.relativePath}`;
    const remote = contentHashByPath.get(fromPath.toLowerCase());
    // Listed but gone, or never listed: the manifest promised a file that is
    // no longer there. Upload it instead.
    if (!remote) continue;
    // The manifest and the listing must agree about the file before it is
    // worth copying. Disagreement means the Bundle was tampered with.
    if (remote.size !== video.bytes) continue;
    const source: ReusableSource = {
      fromPath,
      contentHash: remote.hash,
      sha256: video.sha256,
      bytes: video.bytes,
    };
    // Several files can carry one Byte Hash. Any of them serves, because the
    // bytes are the same bytes — so the first entry wins and the rest are
    // redundant.
    if (!plan.has(remote.hash)) plan.set(remote.hash, source);
  }

  return plan satisfies ReusePlan;
});
