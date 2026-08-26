import { describe, expect, it, vi } from "vitest";
import { createEditEffectHandlers } from "./edit-effect-handlers";
import type {
  ClipReducerAction,
  ClipReducerEffect,
  ClipReducerState,
  DatabaseId,
} from "./clip-state-reducer";
import type { ClipService } from "@/services/clip-service";

// ===========================================================================
// The editor's side of a Transcription. A transcription rewrites the Clip's
// text AND its Transcript Words, so the loader's missing-word-timing flag —
// which is what the "Missing word timing" alert reads — is stale the moment
// one lands.
// ===========================================================================

const makeHandlers = (opts: {
  revalidate: () => void;
  respondWith: Array<{ id: string; text: string }>;
}) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => opts.respondWith,
    }))
  );

  return createEditEffectHandlers({
    videoId: "vid_1",
    clipService: {} as ClipService,
    clipStateRef: { current: {} as ClipReducerState },
    revalidate: opts.revalidate,
    whiteNoiseAssetPath: "/assets/effects/white-noise.mp4",
  });
};

const runTranscribe = (
  handlers: ReturnType<typeof createEditEffectHandlers>,
  clipIds: DatabaseId[],
  dispatch: (action: ClipReducerAction) => void
) => {
  const effect: Extract<ClipReducerEffect, { type: "transcribe-clips" }> = {
    type: "transcribe-clips",
    clipIds,
  };
  handlers["transcribe-clips"]!(
    {} as ClipReducerState,
    effect,
    dispatch as never
  );
};

describe("the transcribe-clips effect", () => {
  it("hands the transcribed text back to the reducer", async () => {
    const dispatch = vi.fn();
    const handlers = makeHandlers({
      revalidate: vi.fn(),
      respondWith: [{ id: "clip_1", text: "hello there" }],
    });

    runTranscribe(handlers, ["clip_1" as DatabaseId], dispatch);

    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "clips-transcribed",
        clips: [{ databaseId: "clip_1", text: "hello there" }],
      })
    );
  });

  it("re-reads the loader once the words have landed, so the missing-word-timing alert can clear", async () => {
    // Recording is the main flow a Clip gets transcribed in, and it is the
    // flow that lights the alert in the first place: the session's clips are
    // appended with no words yet, the loader is re-read as the session ends,
    // and the alert comes up. Without this the alert then stays up for the
    // rest of the session, insisting the word timing never arrived.
    const revalidate = vi.fn();
    const handlers = makeHandlers({
      revalidate,
      respondWith: [{ id: "clip_1", text: "hello there" }],
    });

    runTranscribe(handlers, ["clip_1" as DatabaseId], vi.fn());

    await vi.waitFor(() => expect(revalidate).toHaveBeenCalled());
  });

  it("does not re-read the loader when the transcription failed", async () => {
    const revalidate = vi.fn();
    const dispatch = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, statusText: "Error" }))
    );
    const handlers = createEditEffectHandlers({
      videoId: "vid_1",
      clipService: {} as ClipService,
      clipStateRef: { current: {} as ClipReducerState },
      revalidate,
      whiteNoiseAssetPath: "/assets/effects/white-noise.mp4",
    });

    runTranscribe(handlers, ["clip_1" as DatabaseId], dispatch);

    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ effectType: "transcribe-clips" })
      )
    );
    expect(revalidate).not.toHaveBeenCalled();
  });
});
