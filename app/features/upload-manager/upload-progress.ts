import type { uploadReducer } from "./upload-reducer";

/**
 * The progress model behind every bar in the upload manager.
 *
 * Every job type divides its single bar into one band per stage: the stage
 * change jumps to `start`, then any real percentage the stage streams fills
 * `width` of that band. A stage with `width: 0` reports no measurable progress
 * and simply parks the bar at `start`. 100 is reserved for completion
 * (UPLOAD_SUCCESS).
 *
 * A Publish is the exception: its bar is derived from its per-Video children
 * rather than banded, because export and upload overlap and its stages no
 * longer happen in order.
 */

export interface StageBand {
  start: number;
  width: number;
}

const EXPORT_STAGE_BANDS: Record<uploadReducer.ExportStage, StageBand> = {
  queued: { start: 0, width: 0 },
  "concatenating-clips": { start: 0, width: 80 },
  "normalizing-audio": { start: 80, width: 19 },
};

// Only the blob upload streams a real byte percentage; Buffer's own pipeline
// gives us stage transitions and nothing finer.
export const BUFFER_STAGE_BANDS: Record<uploadReducer.BufferStage, StageBand> =
  {
    "uploading-blob": { start: 0, width: 50 },
    "creating-post": { start: 50, width: 0 },
    polling: { start: 70, width: 0 },
    "cleaning-up": { start: 90, width: 0 },
  };

// A Publish's stages are only sequential either side of the work: it
// validates, Submits (freezing, cloning), and only then encodes and uploads —
// and those two overlap, so neither can own a band of its own. The bands here
// are just the prologue's floors; everything from PUBLISH_WORK_BAND onwards is
// derived from the per-Video children instead (see deriveParentProgress).
export const PUBLISH_STAGE_BANDS: Record<
  uploadReducer.PublishStage,
  StageBand
> = {
  validating: { start: 2, width: 0 },
  freezing: { start: 4, width: 0 },
  cloning: { start: 6, width: 0 },
  exporting: { start: 10, width: 0 },
  uploading: { start: 10, width: 0 },
  // The Promote has landed and the `complete` event is one step behind this
  // one. 100 stays reserved for that event's UPLOAD_SUCCESS.
  complete: { start: 99, width: 0 },
};

// The span of a Publish's bar owned by its per-Video tasks. 100 is reserved
// for the commit receipt landing (UPLOAD_SUCCESS).
const PUBLISH_WORK_BAND: StageBand = { start: 10, width: 89 };

// A per-Video task under a Publish does two things in sequence — encode, then
// upload — so its single bar is split in half rather than spent entirely on
// the export. A standalone export keeps EXPORT_STAGE_BANDS: it has no upload
// half to leave room for.
const PUBLISH_VIDEO_EXPORT_BANDS: Record<uploadReducer.ExportStage, StageBand> =
  {
    queued: { start: 0, width: 0 },
    "concatenating-clips": { start: 0, width: 40 },
    "normalizing-audio": { start: 40, width: 9 },
  };

export const PUBLISH_VIDEO_UPLOAD_BANDS: Record<
  uploadReducer.VideoUploadStage,
  StageBand
> = {
  "queued-for-upload": { start: 50, width: 0 },
  uploading: { start: 50, width: 49 },
};

export const exportStageBands = (upload: uploadReducer.ExportUploadEntry) =>
  upload.parentUploadId ? PUBLISH_VIDEO_EXPORT_BANDS : EXPORT_STAGE_BANDS;

// An Autofill reports nothing finer than "which Video am I on", so its stages
// are floors rather than bands. The parent leaves everything above
// AUTOFILL_WORK_BAND.start to its per-Video children.
export const AUTOFILL_STAGE_BANDS: Record<
  uploadReducer.AutofillStage,
  StageBand
> = {
  selecting: { start: 1, width: 0 },
  writing: { start: 2, width: 0 },
};

// An Autofill's whole bar is its children: unlike a Publish it has no
// prologue worth a band of its own. 100 is reserved for the run settling.
const AUTOFILL_WORK_BAND: StageBand = { start: 2, width: 97 };

export const RENDER_VERTICAL_STAGE_BANDS: Record<
  uploadReducer.RenderVerticalStage,
  StageBand
> = {
  "concatenating-clips": { start: 10, width: 0 },
  transcribing: { start: 30, width: 0 },
  "rendering-overlay": { start: 60, width: 0 },
  compositing: { start: 85, width: 0 },
};

/** A job that has said its final word: nothing may move it again. */
export const isSettled = (upload: uploadReducer.UploadEntry) =>
  upload.status === "success" || upload.status === "error";

/** Where in the bar `percent` (0–100, within the stage) lands. */
export const fillBand = (band: StageBand, percent: number) =>
  band.start + Math.floor((percent / 100) * band.width);

/**
 * The band a raw `UPDATE_PROGRESS` percentage belongs to. `null` when the job
 * streams a real percentage for its whole life rather than per stage, in which
 * case the percentage already *is* the bar position.
 */
export const streamedProgressBand = (
  upload: uploadReducer.UploadEntry
): StageBand | null => {
  if (upload.uploadType === "buffer" && upload.bufferStage) {
    return BUFFER_STAGE_BANDS[upload.bufferStage];
  }
  return null;
};

/**
 * A Publish's bar, once it has per-Video children, is the byte-weighted mean
 * of those children rather than a number of its own — the stages it used to be
 * banded by no longer happen in order. A child whose size is not known yet
 * stands in at the mean of the children already measured, so the denominator
 * cannot collapse to whatever has landed so far.
 */
const deriveParentProgress = (
  parent: uploadReducer.UploadEntry,
  children: uploadReducer.UploadEntry[]
): number | null => {
  if (children.length === 0) return null;

  const knownSizes = children.flatMap((child) =>
    child.uploadType === "export" && child.totalBytes !== null
      ? [child.totalBytes]
      : []
  );
  const meanKnown =
    knownSizes.length > 0
      ? knownSizes.reduce((sum, bytes) => sum + bytes, 0) / knownSizes.length
      : 1;
  const weightOf = (child: uploadReducer.UploadEntry) =>
    child.uploadType === "export" && child.totalBytes !== null
      ? child.totalBytes
      : meanKnown;

  let weighted = 0;
  let total = 0;
  for (const child of children) {
    const weight = weightOf(child);
    total += weight;
    weighted += weight * child.progress;
  }
  if (total <= 0) return null;

  return fillBand(
    parent.uploadType === "autofill" ? AUTOFILL_WORK_BAND : PUBLISH_WORK_BAND,
    weighted / total
  );
};

/**
 * Re-derive every parent's progress from its children. Runs after each action
 * because any child's movement changes its parent's bar, and never lowers a
 * bar: a child whose size only just became known can otherwise reweight the
 * mean downwards.
 */
export const withDerivedParentProgress = (
  uploads: uploadReducer.State["uploads"]
): uploadReducer.State["uploads"] => {
  const childrenByParent = new Map<string, uploadReducer.UploadEntry[]>();
  for (const upload of Object.values(uploads)) {
    if (!upload.parentUploadId) continue;
    const siblings = childrenByParent.get(upload.parentUploadId) ?? [];
    siblings.push(upload);
    childrenByParent.set(upload.parentUploadId, siblings);
  }
  if (childrenByParent.size === 0) return uploads;

  let next = uploads;
  for (const [parentId, children] of childrenByParent) {
    const parent = next[parentId];
    if (!parent || isSettled(parent)) continue;
    const derived = deriveParentProgress(parent, children);
    if (derived === null || derived <= parent.progress) continue;
    next = { ...next, [parentId]: { ...parent, progress: derived } };
  }
  return next;
};
