import { describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "@/features/video-editor/cvm-recorder-reducer";
import type {
  CvmRecorderMessage,
  PlacedTake,
} from "@/features/video-editor/cvm-recorder-wire";
import { setupClipServiceTests, clipService } from "../clip-service-test-setup";
import {
  clipTimes,
  film,
  startServiceAndClient as setup,
  tmp,
} from "./recorder-client-test-harness";

/**
 * End to end, without hardware (recorder-client-test-harness.ts): the
 * recorder service hearing a synthetic mic, the app server saving its
 * Takes, and the editor's CVM recorder adapter showing them.
 */

setupClipServiceTests();

describe("Takes, end to end", () => {
  // The recorder service alone decides what is a Take (speech-detector.ts),
  // by the rule a Clip is cut with: the editor shows an Optimistic Clip for
  // exactly the speech that becomes a Clip, so none is left a ghost for the
  // next take to fill.
  it("shows an Optimistic Clip for every speech that becomes a Clip and for no other: an 'um' makes neither", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    // The editor: its CVM recorder adapter, hearing what the app server
    // says, and answering every place-take as use-cvm-recorder.ts does.
    const editor = new ReducerTester(
      cvmRecorderReducer,
      createInitialCvmRecorderState()
    );
    const heard: CvmRecorderMessage[] = [];
    const placed: Promise<PlacedTake>[] = [];
    let effectsSeen = 0;
    client.subscribe(video.id, (message) => {
      heard.push(message);
      editor.send({ type: "recorder-message-heard", message });
      for (const effect of editor.getEffects().slice(effectsSeen))
        if (effect.type === "place-take")
          placed.push(
            client.placeTake(video.id, effect.recordingSessionId, {
              type: "start",
            })
          );
      effectsSeen = editor.getEffects().length;
    });
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    await client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    });

    film(windows.recorder("camera"), {
      silenceSeconds: 0.8,
      sound: [
        // An "um": 0.5 s, then silence.
        [2, 2.5],
        // A take.
        [5, 7],
        // An "um", a 0.5 s pause (no silence), then the take it opens.
        [10, 10.5],
        [11, 12.5],
        // A hair under the minimum Clip length.
        [15, 15.95],
        // An "um" still going at Stop.
        [18.5, 30],
      ],
      until: 19,
    });
    await client.stopRecording(video.id);
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("recording-stopped")
    );

    const takes = editor
      .getEffects()
      .filter((e) => e.type === "start-take")
      .map((e) => e.soundDetectionId);
    expect(takes).toHaveLength(2);
    expect(new Set(takes).size).toBe(2);
    // Each Take's end was placed, and made exactly one Clip.
    const answers = await Promise.all(placed);
    expect(answers.map((a) => a.clips.length)).toEqual([1, 1]);
    expect(heard.map((m) => m.type)).not.toContain("clips-saved");
    // The um before the second take is in its Clip (mic offset 0.15 s).
    expect((await clipTimes(video.id)).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [5.15, 7.23],
      [10.15, 12.73],
    ]);
    // Every Take starts before its speech ends, and only a Take is placed.
    expect(
      heard
        .map((m) => m.type)
        .filter((t) => t === "take-started" || t.startsWith("speech-"))
    ).toEqual([
      ...["speech-started", "speech-ended"],
      ...["speech-started", "take-started", "speech-ended"],
      ...["speech-started", "take-started", "speech-ended"],
      ...["speech-started", "speech-ended"],
      ...["speech-started", "speech-ended"],
    ]);
  });
});

describe("an editor that leaves mid-take (New Short, another page, a reload)", () => {
  it("stops the take, and its last Take is saved where that editor's Insertion Point was, not after the Video's last item", async () => {
    const { windows, client } = await setup();
    const video = await clipService.createVideo("CVM recorder");
    const [first] = await clipService.appendClips({
      videoId: video.id,
      insertionPoint: { type: "start" },
      items: [],
      clips: [
        { inputVideo: "first.mp4", startTime: 0, endTime: 1 },
        { inputVideo: "last.mp4", startTime: 0, endTime: 1 },
      ],
    });
    const heard: CvmRecorderMessage[] = [];
    const leave = client.subscribe(video.id, (message) => heard.push(message));
    await vi.waitFor(() =>
      expect(heard).toContainEqual({ type: "camera-went-live" })
    );
    await client.startRecording(video.id, {
      silenceLength: "short",
      folder: tmp(),
    });
    const started = await vi.waitFor(() => {
      const m = heard.find((m) => m.type === "recording-started");
      if (m?.type !== "recording-started") throw new Error("not started");
      return m;
    });

    // A Take still being spoken as the editor goes.
    film(windows.recorder("camera"), {
      silenceSeconds: 0.8,
      sound: [[5, 30]],
      until: 12,
    });
    await vi.waitFor(() =>
      expect(heard.map((m) => m.type)).toContain("take-started")
    );
    leave();
    await client.stopRecording(video.id, {
      recordingSessionId: started.recordingSessionId,
      insertionPoint: { type: "after-clip", databaseClipId: first!.id },
    });
    expect(client.recording()).toBe(false);

    await vi.waitFor(async () =>
      expect(
        (await clipService.getTimeline(video.id)).flatMap((i) =>
          i.type === "clip" ? [i.data.videoFilename] : []
        )
      ).toEqual(["first.mp4", expect.stringMatching(/mic\.mkv$/), "last.mp4"])
    );
  });
});
