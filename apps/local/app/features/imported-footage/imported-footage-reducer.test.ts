import { describe, expect, it } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import {
  createInitialImportedFootageState,
  importedFootageReducer,
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
