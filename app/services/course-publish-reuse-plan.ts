import { Effect } from "effect";
import { download, listFolder } from "./dropbox-http-client";

/**
 * A file in the previously Published Bundle that a Video of THIS Publish can
 * take verbatim, because both were produced from the same Export Hash.
 *
 * `sha256` and `bytes` are owed to the new manifest and come straight out of
 * the old one, so a reused Video costs no local read at all. `contentHash` is
 * what the copy is checked against once Dropbox reports it back.
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

/** Keyed by Export Hash — the only key that identifies a Video's bytes. */
export type ReusePlan = ReadonlyMap<string, ReusableSource>;

export const EMPTY_REUSE_PLAN: ReusePlan = new Map();

/**
 * The manifest is walked structurally rather than decoded against the Schema.
 * A previous Bundle was written by whatever code shipped at the time, and a
 * manifest this Publish cannot fully understand is a reason to reuse LESS, not
 * a reason to fail. Anything unrecognised simply contributes no entry.
 */
type ManifestVideo = {
  hash: string;
  relativePath: string;
  sha256: string;
  bytes: number;
};

const isManifestVideo = (value: unknown): value is ManifestVideo => {
  if (typeof value !== "object" || value === null) return false;
  const { hash, relativePath, sha256, bytes } = value as Record<
    string,
    unknown
  >;
  return (
    typeof hash === "string" &&
    hash.length > 0 &&
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
 * knows each file's Export Hash and SHA256; only a listing knows its Dropbox
 * content hash, which is what the copy is later verified against.
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
    // Two Videos can share an Export Hash — same Clips, same Video Format.
    // Either copy serves, because the bytes are identical by construction.
    if (plan.has(video.hash)) continue;
    const fromPath = `${input.dropboxCourseDir}/${video.relativePath}`;
    const remote = contentHashByPath.get(fromPath.toLowerCase());
    // Listed but gone, or never listed: the manifest promised a file that is
    // no longer there. Upload it instead.
    if (!remote) continue;
    // The manifest and the listing must agree about the file before it is
    // worth copying. Disagreement means the Bundle was tampered with.
    if (remote.size !== video.bytes) continue;
    plan.set(video.hash, {
      fromPath,
      contentHash: remote.hash,
      sha256: video.sha256,
      bytes: video.bytes,
    });
  }

  return plan as ReusePlan;
});
