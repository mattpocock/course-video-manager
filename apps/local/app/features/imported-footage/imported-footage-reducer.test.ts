import { describe, expect, it } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import {
  createInitialImportedFootageState,
  importedFootageReducer,
  liveDownloads,
  liveTranscriptions,
  onlyPlayerChanged,
  transcriptionStateOf,
} from "./imported-footage-reducer";

const INTERVIEW = "/mnt/d/raw-footage/imported/interview.mp4";
const NEW_IMPORT = "/mnt/d/raw-footage/imported/broll.mp4";

const job = (
  id: string,
  kind: string,
  subjectId: string,
  status: jobsReducer.JobStatus
): jobsReducer.JobView => fromPartial({ id, kind, subjectId, status });

const opened = () =>
  new ReducerTester(
    importedFootageReducer,
    createInitialImportedFootageState()
  );

describe("importedFootageReducer", () => {
  it("shows a listed file as transcribing while its Job is live, and reloads the page once it settles", () => {
    const t = opened();
    const listed = [{ absolute: INTERVIEW, transcribed: false }];
    const observe = (jobs: jobsReducer.JobView[]) =>
      t.send({
        type: "transcriptions-observed",
        live: liveTranscriptions(jobs),
        listed: listed.map((f) => f.absolute),
      });

    observe([job("j1", "transcribe-footage", INTERVIEW, "queued")]);
    expect(transcriptionStateOf(t.getState(), listed[0]!)).toBe("transcribing");
    observe([job("j1", "transcribe-footage", INTERVIEW, "running")]);
    expect(t.getEffects()).toEqual([]);

    observe([job("j1", "transcribe-footage", INTERVIEW, "succeeded")]);
    expect(transcriptionStateOf(t.getState(), listed[0]!)).toBe(
      "not-transcribed"
    );
    expect(t.getEffects()).toEqual([{ type: "reload-footage" }]);
    expect(
      transcriptionStateOf(t.getState(), {
        absolute: INTERVIEW,
        transcribed: true,
      })
    ).toBe("transcribed");
  });

  it("reloads for a new import once its transcription runs (its copy has landed), not while it waits", () => {
    const t = opened();
    const observe = (status: jobsReducer.JobStatus) =>
      t.send({
        type: "transcriptions-observed",
        live: liveTranscriptions([
          job("j0", "import-footage", NEW_IMPORT, "running"),
          job("j1", "transcribe-footage", NEW_IMPORT, status),
        ]),
        listed: [INTERVIEW],
      });

    observe("queued");
    expect(t.getEffects()).toEqual([]);
    observe("running");
    observe("running");
    expect(t.getEffects()).toEqual([{ type: "reload-footage" }]);
  });

  it("starts one YouTube import per URL pasted, empties the box once it starts, shows its download's progress and reloads when it ends", () => {
    const t = opened();
    const URL_ = "https://youtu.be/aB3_dEf-9Hi";
    const download = (
      status: jobsReducer.JobStatus,
      percent: number | null
    ): jobsReducer.JobView =>
      fromPartial({
        id: "d1",
        kind: "import-youtube-footage",
        subjectId: "aB3_dEf-9Hi",
        status,
        stage: "downloading",
        percent,
      });

    t.send({ type: "youtube-url-submitted", url: "  " })
      .send({ type: "youtube-url-submitted", url: ` ${URL_} ` })
      .send({ type: "youtube-url-submitted", url: URL_ });
    expect(t.getState().startingUrl).toBe(URL_);
    t.send({
      type: "youtube-import-started",
      videoId: "aB3_dEf-9Hi",
      jobId: "d1",
      path: null,
    });
    expect(t.getState()).toMatchObject({
      startingUrl: null,
      urlBoxGeneration: 1,
    });

    t.send({
      type: "downloads-observed",
      live: liveDownloads([download("running", 40)]),
    });
    expect(t.getState().downloads).toEqual({
      d1: { videoId: "aB3_dEf-9Hi", stage: "downloading", percent: 40 },
    });
    t.send({
      type: "downloads-observed",
      live: liveDownloads([download("succeeded", 100)]),
    });

    expect(t.getEffects()).toEqual([
      { type: "start-youtube-import", url: URL_ },
      { type: "reload-footage" },
    ]);
  });

  it("says a video already imported is there, and why a URL was refused, keeping what was typed", () => {
    const t = opened();
    t.send({
      type: "youtube-url-submitted",
      url: "https://youtu.be/aB3_dEf-9Hi",
    })
      .send({
        type: "youtube-import-started",
        videoId: "aB3_dEf-9Hi",
        jobId: null,
        path: "raw-footage/imported/Talk [aB3_dEf-9Hi].mp4",
      })
      .send({ type: "youtube-url-submitted", url: "https://vimeo.com/1" })
      .send({
        type: "youtube-import-refused",
        message: "not the URL of a YouTube video",
      });

    expect(t.getState()).toMatchObject({
      startingUrl: null,
      urlBoxGeneration: 1,
    });
    expect(t.getEffects()).toEqual([
      { type: "start-youtube-import", url: "https://youtu.be/aB3_dEf-9Hi" },
      {
        type: "show-toast",
        tone: "success",
        message:
          "Already imported: raw-footage/imported/Talk [aB3_dEf-9Hi].mp4",
      },
      { type: "start-youtube-import", url: "https://vimeo.com/1" },
      {
        type: "show-toast",
        tone: "error",
        message: "Could not import it: not the URL of a YouTube video",
      },
    ]);
  });

  it("copies the root-relative path and reveals a file, toasting only what the author needs to hear", () => {
    const t = opened();
    t.send({
      type: "copy-path-clicked",
      path: "raw-footage/imported/interview.mp4",
    })
      .send({ type: "path-copied" })
      .send({
        type: "copy-path-clicked",
        path: "raw-footage/imported/interview.mp4",
      })
      .send({ type: "copy-path-failed" })
      .send({
        type: "reveal-clicked",
        location: "/mnt/d",
        path: "raw-footage/imported/interview.mp4",
      })
      .send({ type: "reveal-failed", message: "no explorer" });

    expect(t.getEffects()).toEqual([
      { type: "copy-path", path: "raw-footage/imported/interview.mp4" },
      { type: "show-toast", tone: "success", message: "Path copied" },
      { type: "copy-path", path: "raw-footage/imported/interview.mp4" },
      { type: "show-toast", tone: "error", message: "Could not copy the path" },
      {
        type: "reveal-file",
        location: "/mnt/d",
        path: "raw-footage/imported/interview.mp4",
      },
      {
        type: "show-toast",
        tone: "error",
        message: "Could not show it in Explorer: no explorer",
      },
    ]);
  });
});

describe("onlyPlayerChanged", () => {
  const url = (search: string) =>
    new URL(`http://cvm.test/imported-footage${search}`);

  it("is true when only the hit being played changed, so nothing is loaded again", () => {
    expect(
      onlyPlayerChanged(url("?q=world"), url("?q=world&play=a.mp4&t=3"))
    ).toBe(true);
    expect(
      onlyPlayerChanged(
        url("?q=world&play=a.mp4&t=3"),
        url("?q=world&play=a.mp4&t=9")
      )
    ).toBe(true);
    expect(onlyPlayerChanged(url("?q=world"), url("?q=again"))).toBe(false);
    expect(
      onlyPlayerChanged(
        url("?q=world"),
        new URL("http://cvm.test/storage?q=world")
      )
    ).toBe(false);
  });
});
