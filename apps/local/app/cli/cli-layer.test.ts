import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_HEADER,
} from "@cvm/core/rpc/schema-version";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
// the transport: with NO connection string anywhere near the box, every verb
// group reaches the deployed API — the right endpoint, the bearer token, the
// schema version, and the caller's own arguments, untouched.
//
// `fetch` is stubbed rather than a server started. That is the one boundary
// this file mocks, and it is a system boundary (an external HTTP API), which
// is what makes the request itself the thing under assertion: a service wired
// to the wrong endpoint, or one that quietly dropped an argument on its way to
// the wire, fails here rather than on a box nobody is watching.
// ===========================================================================

const BASE_URL = "http://cvm-api.test";
const TOKEN = "cvm_deadbeef_a-token-no-request-is-really-made-with";

const ENV_KEYS = ["DATABASE_URL", "CVM_API_URL", "CVM_API_TOKEN"] as const;
const previousEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

/** Every request the layer made, in order. */
let requests: Request[] = [];

beforeAll(() => {
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  delete process.env.DATABASE_URL;
  process.env.CVM_API_URL = BASE_URL;
  process.env.CVM_API_TOKEN = TOKEN;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input as string, init));
    return Response.json({ ok: true, value: null });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  requests = [];
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/**
 * One representative verb per group: the endpoint it must reach, and the
 * arguments it must put on the wire in that order.
 *
 * `search` is the group that earns its place twice — its `types` is a `Set` in
 * the service and a `Set` is not JSON, so the conversion is a real step this
 * asserts on rather than a pass-through.
 */
const GROUPS = [
  {
    group: "search",
    tag: SearchOperationsService,
    method: "search",
    args: [{ root: "/", query: "hono", types: new Set(["video"]) }],
    path: "/rpc/search/search",
    body: [{ root: "/", query: "hono", types: ["video"] }],
  },
  {
    group: "course",
    tag: CourseOperationsService,
    method: "getCourses",
    args: [],
    path: "/rpc/course/getCourses",
    body: [],
  },
  {
    group: "version",
    tag: VersionOperationsService,
    method: "getCourseVersions",
    args: ["course_1"],
    path: "/rpc/version/getCourseVersions",
    body: ["course_1"],
  },
  {
    group: "section",
    tag: LessonSectionOperationsService,
    method: "getSectionsByRepoVersionId",
    args: ["version_1"],
    path: "/rpc/section/getSectionsByRepoVersionId",
    body: ["version_1"],
  },
  {
    group: "lesson",
    tag: LessonSectionOperationsService,
    method: "getLessonById",
    args: ["lesson_1"],
    path: "/rpc/lesson/getLessonById",
    body: ["lesson_1"],
  },
  {
    group: "lesson move",
    tag: CourseWriteService,
    method: "moveToSection",
    args: ["lesson_1", "section_2"],
    path: "/rpc/lesson/moveToSection",
    body: ["lesson_1", "section_2"],
  },
  {
    group: "video",
    tag: VideoOperationsService,
    method: "getVideoRowById",
    args: ["video_1"],
    path: "/rpc/video/getVideoRowById",
    body: ["video_1"],
  },
  {
    group: "clip",
    tag: ClipOperationsService,
    method: "getClipsByIds",
    args: [["clip_1", "clip_2"]],
    path: "/rpc/clip/getClipsByIds",
    body: [["clip_1", "clip_2"]],
  },
  {
    group: "beat",
    tag: BeatOperationsService,
    method: "listBeatsByVideoId",
    args: ["video_1"],
    path: "/rpc/beat/listBeatsByVideoId",
    body: ["video_1"],
  },
  {
    group: "pitch",
    tag: PitchOperationsService,
    method: "listPitches",
    args: [],
    path: "/rpc/pitch/listPitches",
    body: [],
  },
  {
    group: "deliverable",
    tag: DeliverableOperationsService,
    method: "listDeliverables",
    args: [],
    path: "/rpc/deliverable/listDeliverables",
    body: [],
  },
] as const;

/** Invoke one verb through `cliLayer` and hand back the request it made. */
const callThroughCliLayer = async (
  tag: unknown,
  method: string,
  args: ReadonlyArray<unknown>
): Promise<Request> => {
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(tag as never, (service) =>
        (service as Record<string, (...a: ReadonlyArray<unknown>) => never>)[
          method
        ]!(...args)
      ),
      cliLayer
    )
  );

  expect(requests).toHaveLength(1);
  return requests[0]!;
};

describe("with a token and no DATABASE_URL", () => {
  it.each(GROUPS)(
    "reaches $path for the $group verb group",
    async ({ tag, method, args, path, body }) => {
      const request = await callThroughCliLayer(tag, method, args);

      expect(new URL(request.url)).toMatchObject({
        origin: BASE_URL,
        pathname: path,
      });
      expect(request.method).toBe("POST");
      // The arguments, in the caller's own order — `rpcMethod` forwards them
      // variadically, so a reordered or dropped one shows up right here.
      expect(await request.json()).toEqual(body);
    }
  );

  it("presents the bearer token on every request", async () => {
    const request = await callThroughCliLayer(
      CourseOperationsService,
      "getCourses",
      []
    );

    expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("states the schema version it was built against on every request", async () => {
    const request = await callThroughCliLayer(
      CourseOperationsService,
      "getCourses",
      []
    );

    expect(request.headers.get(SCHEMA_VERSION_HEADER)).toBe(
      String(SCHEMA_VERSION)
    );
  });
});
