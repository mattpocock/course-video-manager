/**
 * Pure helpers for whole-file **Footage** transcription (see CONTEXT.md
 * "Footage"). Extracted from VideoProcessingService so the two decisions that
 * are easy to get wrong — WHERE to split a long recording, and how to STITCH
 * the per-chunk transcripts back onto one timeline — are plain functions with
 * no ffmpeg, no Whisper and no filesystem, unit-tested directly.
 *
 * Whisper caps an upload at 25MB. A long recording's mono 64kbps audio exceeds
 * that, so it is transcribed in pieces; each piece is cut at a real silence
 * point (never mid-word) near a target duration, transcribed on its own, and
 * its timestamps are shifted back by the piece's start before merging — so the
 * merged transcript reads as if the whole file were transcribed at once.
 */

export interface TranscriptWord {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface TranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface FootageTranscript {
  readonly words: ReadonlyArray<TranscriptWord>;
  readonly segments: ReadonlyArray<TranscriptSegment>;
}

/** A half-open window `[start, end)` into the source file, in seconds. */
export interface ChunkBoundary {
  readonly start: number;
  readonly end: number;
}

/**
 * ~27 minutes. At mono 64kbps that is ~13MB — comfortably under Whisper's 25MB
 * cap even if the nearest silence lands a few minutes late, so a chunk chosen
 * around this target never has to be re-split.
 */
export const FOOTAGE_TARGET_CHUNK_SECONDS = 27 * 60;

/**
 * Split `[0, durationSeconds)` into consecutive chunks each roughly
 * `targetChunkSeconds` long, choosing every internal boundary at the SILENCE
 * POINT nearest the target rather than at a fixed interval — so a cut never
 * lands inside a spoken word (which would drop or duplicate it across the two
 * pieces, the exact failure fixed-interval + overlap chunking exists to paper
 * over).
 *
 * `silencePoints` are absolute times (seconds) where the file is silent — the
 * ends of speaking clips from `findSilenceInVideo` are the natural source. A
 * boundary is picked from the points falling in the acceptable window around
 * the target; if none do (a stretch of unbroken speech longer than the window),
 * the chunk is cut at the target time itself, so a pathological input still
 * yields chunks under the size cap.
 *
 * The last chunk always runs to `durationSeconds`, and can be up to 1.5× the
 * target so a short tail is absorbed rather than left as a sliver.
 */
export const planChunkBoundaries = (opts: {
  readonly durationSeconds: number;
  readonly silencePoints: ReadonlyArray<number>;
  readonly targetChunkSeconds?: number;
}): ChunkBoundary[] => {
  const { durationSeconds } = opts;
  const target = opts.targetChunkSeconds ?? FOOTAGE_TARGET_CHUNK_SECONDS;
  const maxChunk = target * 1.5;

  if (!(durationSeconds > 0)) return [];

  const sorted = [...opts.silencePoints].sort((a, b) => a - b);
  const boundaries: ChunkBoundary[] = [];
  let start = 0;

  // A remainder no bigger than one over-long chunk becomes the final piece.
  while (durationSeconds - start > maxChunk) {
    const ideal = start + target;
    // The window keeps a chunk between half the target and 1.5× it, so a cut
    // is always a plausible chunk length even when silence is sparse.
    const minEnd = start + target * 0.5;
    const maxEnd = Math.min(start + maxChunk, durationSeconds);
    const inWindow = sorted.filter((p) => p > minEnd && p < maxEnd);

    const cut =
      inWindow.length > 0
        ? inWindow.reduce((best, p) =>
            Math.abs(p - ideal) < Math.abs(best - ideal) ? p : best
          )
        : Math.min(ideal, durationSeconds);

    boundaries.push({ start, end: cut });
    start = cut;
  }

  boundaries.push({ start, end: durationSeconds });
  return boundaries;
};

/** One chunk's own-timeline transcript plus the offset it sits at in the file. */
export interface ChunkTranscript extends FootageTranscript {
  /** Seconds to add to every timestamp — the chunk's start in the source. */
  readonly offset: number;
}

/**
 * Concatenate per-chunk transcripts into one whole-file transcript, shifting
 * every word and segment timestamp by its chunk's `offset`. Chunks are merged
 * in the order given (which is timeline order — see `planChunkBoundaries`), so
 * the result's timestamps are strictly the source file's own.
 */
export const mergeChunkTranscripts = (
  chunks: ReadonlyArray<ChunkTranscript>
): FootageTranscript => {
  const words: TranscriptWord[] = [];
  const segments: TranscriptSegment[] = [];

  for (const chunk of chunks) {
    for (const w of chunk.words) {
      words.push({
        start: w.start + chunk.offset,
        end: w.end + chunk.offset,
        text: w.text,
      });
    }
    for (const s of chunk.segments) {
      segments.push({
        start: s.start + chunk.offset,
        end: s.end + chunk.offset,
        text: s.text,
      });
    }
  }

  return { words, segments };
};

/**
 * The text of a Footage transcript sliced to the window `[startTime, endTime)`
 * — every word that OVERLAPS the window, joined into one string. This is what
 * `cvm clip add` uses to populate a new Clip's `text` from the cached whole-file
 * transcript, with no fresh Whisper call.
 *
 * Words are preferred (they slice tightly); a transcript that somehow carries
 * segments but no words falls back to overlapping segments. Whisper word tokens
 * arrive without surrounding spaces, so they are trimmed and space-joined.
 */
export const sliceTranscriptText = (
  transcript: FootageTranscript,
  startTime: number,
  endTime: number
): string => {
  const overlaps = (s: number, e: number) => s < endTime && e > startTime;

  const wordText = transcript.words
    .filter((w) => overlaps(w.start, w.end))
    .map((w) => w.text.trim())
    .filter((t) => t.length > 0)
    .join(" ");
  if (wordText.length > 0) return wordText;

  return transcript.segments
    .filter((s) => overlaps(s.start, s.end))
    .map((s) => s.text.trim())
    .filter((t) => t.length > 0)
    .join(" ");
};

/**
 * The **Transcript Words** of a Footage transcript sliced to the window
 * `[startTime, endTime)` — every word that OVERLAPS the window, re-expressed
 * as CLIP-RELATIVE offsets (`0` = `startTime`). The word-level sibling of
 * `sliceTranscriptText`: the same overlap rule, the same call site
 * (`cvm clip add`), but keeping the timing that `sliceTranscriptText` throws
 * away by joining to a flat string.
 *
 * A word straddling a boundary is CLAMPED into `[0, endTime - startTime]`
 * rather than dropped or left poking out of the Clip: it IS audible in the
 * Clip, so it belongs in its words, and every offset a reader gets back
 * addresses a moment that actually exists inside the Clip.
 *
 * There is no segment fallback (unlike `sliceTranscriptText`) — a segment is a
 * sentence-ish span, so passing one off as a word would be inventing timing
 * that Whisper never reported. A transcript with no words yields no words.
 */
export const sliceTranscriptWords = (
  transcript: FootageTranscript,
  startTime: number,
  endTime: number
): TranscriptWord[] => {
  const duration = endTime - startTime;

  return transcript.words
    .filter((w) => w.start < endTime && w.end > startTime)
    .map((w) => ({
      start: Math.min(Math.max(w.start - startTime, 0), duration),
      end: Math.min(Math.max(w.end - startTime, 0), duration),
      text: w.text.trim(),
    }))
    .filter((w) => w.text.length > 0);
};
