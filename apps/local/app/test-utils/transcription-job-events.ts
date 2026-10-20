import type { WireJob } from "@/features/jobs/job-wire";
import type { clipStateReducer } from "@/features/video-editor/clip-state-reducer";

/**
 * A `transcribe-clips` Job Event as the edit page's bridge hears it, for
 * clip reducer tests. Event ids count up across a test run, so each one is
 * newer than the last and than a fixture's `jobEventCursor` of 0; pass `id`
 * to place one exactly.
 */
let nextEventId = 1;

export const heardTranscriptionEvent = (
  jobId: string,
  type: string,
  data: Record<string, unknown> = {},
  options: { id?: number; job?: Partial<WireJob> } = {}
): clipStateReducer.Action => ({
  type: "job-event-heard",
  heard: {
    job: {
      id: jobId,
      kind: "transcribe-clips",
      title: "Transcribe Clips",
      attempt: 1,
      maxAttempts: 1,
      subjectType: "video",
      subjectId: "video-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...options.job,
    },
    event: {
      id: options.id ?? nextEventId++,
      jobId,
      type,
      data,
      at: "2026-10-09T12:00:00.000Z",
    },
  },
});

/** The Job took these Clips on. */
export const transcriptionJobStarted = (jobId: string, clipIds: string[]) =>
  heardTranscriptionEvent(jobId, "clips-started", { clipIds });

/** One Clip's Transcription landed. */
export const clipTranscribed = (
  jobId: string,
  clipId: string,
  text: string,
  hasTranscriptWords = true
) =>
  heardTranscriptionEvent(jobId, "clip-settled", {
    id: clipId,
    transcriptionStatus: "done",
    text,
    hasTranscriptWords,
  });

/** Whisper refused one Clip. */
export const clipTranscriptionFailed = (jobId: string, clipId: string) =>
  heardTranscriptionEvent(jobId, "clip-settled", {
    id: clipId,
    transcriptionStatus: "failed",
  });

/** The Job itself ended without settling its Clips. */
export const transcriptionJobEnded = (
  jobId: string,
  how: "failed" | "interrupted" = "failed"
) => heardTranscriptionEvent(jobId, how);
