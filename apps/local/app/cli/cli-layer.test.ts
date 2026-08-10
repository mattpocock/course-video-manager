import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { DeliverableOperationsService } from "@/services/db-deliverable-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { SearchOperationsService } from "@/services/db-search-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { cliLayer } from "./layer";

// ===========================================================================
// The CLI's own layer, on a machine that has only a token.
//
// The rest of the cli-* suites provide their own layer, so this is the one
// place `cliLayer` itself is exercised. What it proves is the whole point of
// the transport: `cvm` reaches EVERY verb group with NO connection string
// anywhere near the box.
// ===========================================================================

const ENV_KEYS = ["DATABASE_URL", "CVM_API_URL", "CVM_API_TOKEN"] as const;
const previous: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  delete process.env.DATABASE_URL;
  process.env.CVM_API_URL = "http://cvm-api.test";
  process.env.CVM_API_TOKEN = "cvm_deadbeef_not-used-no-request-is-made";
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** One representative method per service — enough to prove it is wired. */
const GROUPS = [
  ["search", SearchOperationsService, "search"],
  ["course", CourseOperationsService, "getCourses"],
  ["version", VersionOperationsService, "getCourseVersions"],
  ["section / lesson", LessonSectionOperationsService, "getLessonsBySectionId"],
  ["lesson move", CourseWriteService, "moveToSection"],
  ["video", VideoOperationsService, "getVideoRowById"],
  ["clip", ClipOperationsService, "getClipsByIds"],
  ["beat", BeatOperationsService, "listBeatsByVideoId"],
  ["pitch", PitchOperationsService, "listPitches"],
  ["deliverable", DeliverableOperationsService, "listDeliverables"],
] as const;

describe("with a token and no DATABASE_URL", () => {
  it.each(GROUPS)("hands out the %s verb group", async (_, tag, method) => {
    const service = await Effect.runPromise(
      Effect.provide(tag as never, cliLayer)
    );

    expect(typeof (service as Record<string, unknown>)[method]).toBe(
      "function"
    );
  });
});
