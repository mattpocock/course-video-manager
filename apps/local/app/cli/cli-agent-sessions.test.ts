import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import nodeFs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import * as schema from "@/db/schema";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";
import { toDate } from "@/packages/clock";

// ===========================================================================
// cvm video agent-sessions set | get | clear. Every session file here is a
// small hand-written fixture: this repo is public, so no real session content
// is ever committed.
//
// The Video's cut, on the wall clock (2026-01-15, London = UTC in winter):
//   c1  Code    OBS file 10:00:00 (+0.5 s), source 10–20  → 10:00:10.5–20.5
//   c2  Camera  same file,                  source 20–30
//   c3  Code    Recording Session 10:00:30, source 10–20  → 10:00:40–50
// So c1 plays at 0–10 s of the Video, c2 at 10–20 s and c3 at 20–30 s.
// ===========================================================================

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;
let dir: string;
let clips: Record<"c1" | "c2" | "c3", string>;

const at = (seconds: number) =>
  toDate(Date.UTC(2026, 0, 15, 10, 0, 0) + seconds * 1000).toISOString();

const CWD = "/home/dev/proj";

/** One JSONL line of a Claude Code session, with the fields the reader reads. */
const line = (
  uuid: string,
  parentUuid: string | null,
  seconds: number,
  type: "user" | "assistant",
  content: unknown,
  extra: Record<string, unknown> = {}
) =>
  JSON.stringify({
    type,
    uuid,
    parentUuid,
    sessionId: "claude-session-1",
    cwd: CWD,
    timestamp: at(seconds),
    message: { role: type, id: `msg-${uuid}`, content },
    ...extra,
  });

/**
 * The prompt is answered twice: the first answer (and the interrupt after it)
 * was rewound, so only the second branch is kept. Its last reply comes after
 * the last screen Clip.
 */
const SESSION = [
  line("u1", null, 12.5, "user", "Add a test for the parser"),
  line("a1", "u1", 13, "assistant", [
    { type: "thinking", thinking: "hmm" },
    { type: "text", text: "An answer that was rewound." },
  ]),
  line("u2", "a1", 14, "user", "[Request interrupted by user]"),
  line("a2", "u1", 25.5, "assistant", [
    { type: "thinking", thinking: "let me look" },
    { type: "text", text: "Reading the parser." },
  ]),
  line("a3", "a2", 26, "assistant", [
    {
      type: "tool_use",
      id: "tool-1",
      name: "Read",
      input: { file_path: `${CWD}/src/parser.ts` },
    },
  ]),
  line("r1", "a3", 26.2, "user", [
    { type: "tool_result", tool_use_id: "tool-1", content: "file body" },
  ]),
  line("a4", "r1", 61, "assistant", [{ type: "text", text: "Done." }]),
];

/** A refused `set`'s stderr: the tag and every reason. */
const refusalOf = (r: RunResult) =>
  JSON.parse(r.stderr.trim()) as { _tag: string; reasons: string[] };

const writeSession = (name: string, lines: ReadonlyArray<string>) => {
  const path = nodePath.join(dir, name);
  nodeFs.writeFileSync(path, lines.join("\n") + "\n");
  return path;
};

/** A prompt following the one sent a second before it. */
const prompt = (seconds: number, text: string) =>
  line(`p${seconds}`, `p${seconds - 1}`, seconds, "user", text);

type GotEntry = {
  agentSessionId: string;
  clipId: string;
  footageTime: number;
  visibleFrom: number | null;
  kind: string;
  text?: string;
  tool?: string;
  summary?: string | null;
};

const getEntries = async () => {
  const r = await run(["video", "agent-sessions", "get", s.lessonVideoId]);
  expect(r.exitCode, r.stderr).toBe(0);
  return ndjson(r.stdout) as GotEntry[];
};

const visibleFromOf = async () =>
  Object.fromEntries(
    (await getEntries()).map((e) => [e.text ?? e.tool, e.visibleFrom])
  );

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  run = makeRun(buildWriteLayer(testDb));
});

afterAll(() => nodeFs.rmSync(dir, { recursive: true, force: true }));

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
  dir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "cvm-agent-sessions-"));
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      cameraFilePath: "c.mkv",
      screenFilePath: "s.mkv",
      micFilePath: "m.mkv",
      startedAt: toDate(at(30)),
    })
    .returning();
  const obs = "raw-footage/2026-01-15_10-00-00.mkv";
  const rows = await testDb
    .insert(schema.clips)
    .values(
      [
        {
          videoFilename: obs,
          sourceStartTime: 10,
          sourceEndTime: 20,
          order: "a1",
          scene: "Code",
        },
        {
          videoFilename: obs,
          sourceStartTime: 20,
          sourceEndTime: 30,
          order: "a2",
          scene: "Camera",
        },
        {
          videoFilename: "m.mkv",
          sourceStartTime: 10,
          sourceEndTime: 20,
          order: "a3",
          scene: "Code",
          recordingSessionId: session!.id,
        },
      ].map((clip) => ({ ...clip, videoId: s.lessonVideoId, text: "" }))
    )
    .returning();
  clips = { c1: rows[0]!.id, c2: rows[1]!.id, c3: rows[2]!.id };
});

describe("cvm video agent-sessions", () => {
  it("stores only the kept branch, each entry on the first screen Clip that ends after it", async () => {
    const set = await run([
      "video",
      "agent-sessions",
      "set",
      "--session",
      writeSession("s.jsonl", SESSION),
      s.lessonVideoId,
    ]);
    expect(set.exitCode, set.stderr).toBe(0);
    expect(one(set.stdout)).toMatchObject({
      sessions: [
        {
          sourceSessionId: "claude-session-1",
          reused: false,
          kept: 3,
          dropped: { afterLastScreenClip: 1, offBranchMessages: 2 },
        },
      ],
    });

    expect(await getEntries()).toMatchObject([
      // Written during c1, 12 s into its Footage: 2 s past its in-point.
      {
        kind: "userPrompt",
        text: "Add a test for the parser",
        clipId: clips.c1,
        footageTime: 12,
        visibleFrom: 2,
      },
      // Written while the Camera Clip played: on c3, before its in-point, so
      // shown from c3's start.
      {
        kind: "assistantText",
        text: "Reading the parser.",
        clipId: clips.c3,
        footageTime: -4.5,
        visibleFrom: 20,
      },
      {
        kind: "toolCall",
        tool: "Read",
        summary: "src/parser.ts",
        clipId: clips.c3,
        visibleFrom: 20,
      },
    ]);
  });

  it("follows the current cut: an insert, an in-point trim, a reorder and an out-point trim", async () => {
    await run([
      "video",
      "agent-sessions",
      "set",
      "--session",
      writeSession("s.jsonl", SESSION),
      s.lessonVideoId,
    ]);
    const setClip = (
      id: string,
      values: Partial<typeof schema.clips.$inferInsert>
    ) => testDb.update(schema.clips).set(values).where(eq(schema.clips.id, id));

    // A 5 s Camera Clip inserted at the front shifts everything by 5 s.
    await testDb.insert(schema.clips).values({
      videoId: s.lessonVideoId,
      videoFilename: "intro.mkv",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      scene: "Camera",
      text: "",
    });
    expect(await visibleFromOf()).toMatchObject({
      "Add a test for the parser": 7,
      "Reading the parser.": 25,
    });

    // c1's in-point moved past the prompt: it shows from c1's start.
    await setClip(clips.c1, { sourceStartTime: 13 });
    expect(await visibleFromOf()).toMatchObject({
      "Add a test for the parser": 5,
      "Reading the parser.": 22,
    });

    // c3 moved before c1.
    await setClip(clips.c3, { order: "a00" });
    expect(await visibleFromOf()).toMatchObject({
      "Add a test for the parser": 15,
      "Reading the parser.": 5,
    });

    // c1's out-point trimmed before the prompt, and no screen Clip follows c1.
    await setClip(clips.c1, { sourceStartTime: 10, sourceEndTime: 11.5 });
    expect(await visibleFromOf()).toMatchObject({
      "Add a test for the parser": null,
      "Reading the parser.": 5,
    });
  });

  it("refuses the whole upload, naming every reason, and stores nothing", async () => {
    const bad = writeSession("bad.jsonl", [
      prompt(12, "Use sk-abcdefghijklmnopqrstuvwxyz123456 for this"),
      prompt(13, "DATABASE_URL=postgres-thing-here"),
      prompt(14, "Read sk-learn-the-basics-of-typescript, a slug"),
      prompt(15, "Base directory for this skill: /home/dev/.claude/skills/tdd"),
    ]);
    const r = await run([
      "video",
      "agent-sessions",
      "set",
      "--session",
      bad,
      s.lessonVideoId,
    ]);

    expect(r.exitCode).toBe(3);
    const failure = refusalOf(r);
    expect(failure._tag).toBe("AgentSessionUploadRefusedError");
    expect(failure.reasons.join("\n")).toMatch(/skill's body/);
    expect(failure.reasons.join("\n")).toMatch(/an API key/);
    expect(failure.reasons.join("\n")).toMatch(
      /\.env-style value for DATABASE_URL/
    );
    expect(failure.reasons.join("\n")).not.toMatch(/entry 3 /);
    expect(failure.reasons).toHaveLength(3);
    expect(await getEntries()).toEqual([]);
  });

  it("rewrites paths, never refusing on one, and unwraps pasted content", async () => {
    const session = writeSession("paths.jsonl", [
      prompt(12, `Start in ${CWD}`),
      prompt(13, `It is checked out at ${CWD}. Next`),
      prompt(14, "Also read /home/dev/other/notes.md"),
      prompt(15, "Save it to /tmp/shots/a.png"),
      prompt(16, "Import from ~/db and ~/modules/*"),
      prompt(17, '<pasted_content id="ab12">\nStage 3/4\n</pasted_content>'),
      prompt(
        18,
        '<pasted_content id="cd34" kind="text">\nStage 4/4\n</pasted_content id="cd34">'
      ),
    ]);
    const r = await run([
      "video",
      "agent-sessions",
      "set",
      "--session",
      session,
      s.lessonVideoId,
    ]);

    expect(r.exitCode, r.stderr).toBe(0);
    expect((await getEntries()).map((e) => e.text)).toEqual([
      "Start in .",
      "It is checked out at ./. Next",
      "Also read ~/other/notes.md",
      "Save it to /tmp/shots/a.png",
      "Import from ~/db and ~/modules/*",
      "Stage 3/4",
      "Stage 4/4",
    ]);
  });

  it("refuses when Claude Code's session id matches more than one Agent Session", async () => {
    await testDb
      .insert(schema.agentSessions)
      .values([
        { sourceSessionId: "claude-session-1" },
        { sourceSessionId: "claude-session-1" },
      ]);
    const r = await run([
      "video",
      "agent-sessions",
      "set",
      "--session",
      writeSession("s.jsonl", SESSION),
      s.lessonVideoId,
    ]);

    expect(r.exitCode).toBe(3);
    expect(refusalOf(r).reasons).toEqual([
      expect.stringMatching(/claude-session-1 matches 2 Agent Sessions/),
    ]);
  });

  it("re-running set replaces the entries and reuses the session; clear removes both", async () => {
    const path = writeSession("s.jsonl", SESSION);
    const first = one<{ sessions: { agentSessionId: string }[] }>(
      (
        await run([
          "video",
          "agent-sessions",
          "set",
          "--session",
          path,
          s.lessonVideoId,
        ])
      ).stdout
    );
    const again = await run([
      "video",
      "agent-sessions",
      "set",
      "--session",
      path,
      s.lessonVideoId,
    ]);
    expect(one(again.stdout)).toMatchObject({
      sessions: [
        {
          agentSessionId: first.sessions[0]!.agentSessionId,
          reused: true,
          kept: 3,
        },
      ],
    });
    expect(await getEntries()).toHaveLength(3);

    const cleared = await run([
      "video",
      "agent-sessions",
      "clear",
      s.lessonVideoId,
    ]);
    expect(one(cleared.stdout)).toMatchObject({
      entriesDeleted: 3,
      agentSessionsDeleted: 1,
    });
    expect(await testDb.select().from(schema.agentSessions)).toEqual([]);
  });
});
