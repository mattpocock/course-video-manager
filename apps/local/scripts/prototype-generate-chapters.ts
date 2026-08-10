/**
 * PROTOTYPE — throwaway. Answers: "Does our prompt produce good Chapter proposals?"
 *
 * Run:  pnpm tsx scripts/prototype-generate-chapters.ts <videoId>
 *
 * Loads a real Video's clips + existing Chapters from the DB, sends them to
 * Claude with the candidate prompt, and prints the proposed Chapters in the
 * same grouped layout the confirmation modal will use (title header → clip
 * transcripts beneath).
 *
 * Edit SYSTEM_PROMPT below and re-run. Delete this file once the prompt feels right.
 */

import { runtimeLive } from "@/services/layer.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { Effect } from "effect";
import { z } from "zod";

// ─── The prompt under test ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You generate Chapters (YouTube-chapter-style segment markers) for a recorded video.

You are given the video's clips in order. Each clip has an ID and a transcript.
You may also be given existing Chapters the author placed by hand — use these
as a soft guide for where they think breaks belong, but feel free to move, rename,
merge, drop, or add new ones as the content warrants. Your output replaces the
existing set entirely.

A Chapter is a marker placed BEFORE a clip; it labels the segment that begins
with that clip and runs until the next Chapter (or the end of the video).

Title rules:
- Short, descriptive, YouTube-chapter style (2–6 words typical).
- Sentence case. No trailing punctuation. No numbering.
- Describe what the segment CONTAINS, not generic labels like "Introduction" or "Part 1".
- Skip filler — don't section off every minor topic shift; aim for 3–8 sections in a
  typical video, fewer for short videos.

Return an array of { beforeClipId, title }. beforeClipId must be a clip ID from the
input. Order in the array doesn't matter — positions are determined by beforeClipId.

If the video is too short or homogeneous to warrant sectioning, return an empty array.`;

// ─── Schema ───────────────────────────────────────────────────────────────────

const ProposalSchema = z.object({
  sections: z.array(
    z.object({
      beforeClipId: z.string(),
      title: z.string(),
    })
  ),
});

// ─── Main ─────────────────────────────────────────────────────────────────────

const videoId = process.argv[2];
if (!videoId) {
  console.error(
    "Usage: pnpm tsx scripts/prototype-generate-chapters.ts <videoId>"
  );
  process.exit(1);
}

const program = Effect.gen(function* () {
  const videoOps = yield* VideoOperationsService;
  const video = yield* videoOps.getVideoWithClipsById(videoId);

  const clips = video.clips.map((c) => ({
    id: c.id,
    order: c.order,
    text: c.text ?? "",
  }));

  const existingSections = video.chapters.map((s) => ({
    id: s.id,
    order: s.order,
    name: s.name,
  }));

  const untranscribed = clips.filter((c) => !c.text.trim()).length;
  if (untranscribed > 0) {
    console.warn(
      `⚠ ${untranscribed}/${clips.length} clips are untranscribed. Production gates on this; prototype proceeds anyway.\n`
    );
  }

  // Build user message: clips in order, with existing sections interleaved by order
  const interleaved = [
    ...clips.map((c) => ({
      kind: "clip" as const,
      order: c.order,
      id: c.id,
      text: c.text,
    })),
    ...existingSections.map((s) => ({
      kind: "section" as const,
      order: s.order,
      name: s.name,
    })),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  const userMessage = [
    `Video has ${clips.length} clips and ${existingSections.length} existing Chapter(s).`,
    "",
    "Timeline (existing sections shown as [[SECTION: name]] lines):",
    "",
    ...interleaved.map((it) =>
      it.kind === "section"
        ? `[[SECTION: ${it.name}]]`
        : `clip ${it.id}: ${it.text}`
    ),
    "",
    "Propose the full replacement set of Chapters.",
  ].join("\n");

  console.log("─".repeat(72));
  console.log(`Video: ${videoId}`);
  console.log(
    `Clips: ${clips.length}  |  Existing Chapters: ${existingSections.length}`
  );
  console.log("─".repeat(72));
  console.log();

  const start = Date.now();
  const { object } = yield* Effect.tryPromise(() =>
    generateObject({
      model: anthropic("claude-sonnet-4-5"),
      schema: ProposalSchema,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `✔ Generated ${object.sections.length} Chapter(s) in ${elapsed}s\n`
  );

  // Render in the same grouped layout as the reference panel:
  // section title header, clips falling under it shown beneath.
  const proposedById = new Map(
    object.sections.map((s) => [s.beforeClipId, s.title])
  );

  let currentTitle: string | null = null;
  for (const clip of clips) {
    const newTitle = proposedById.get(clip.id);
    if (newTitle !== undefined) {
      currentTitle = newTitle;
      console.log(`\n━━ ${newTitle} ━━`);
    } else if (currentTitle === null && clip === clips[0]) {
      console.log("\n━━ (no section — clips before first proposed marker) ━━");
    }
    const preview =
      clip.text.length > 140 ? clip.text.slice(0, 137) + "..." : clip.text;
    console.log(`  • ${preview || "(empty transcript)"}`);
  }

  console.log("\n" + "─".repeat(72));

  // Flag any beforeClipId the model invented
  const validIds = new Set(clips.map((c) => c.id));
  const invented = object.sections.filter((s) => !validIds.has(s.beforeClipId));
  if (invented.length > 0) {
    console.log(
      `⚠ Model returned ${invented.length} unknown clip ID(s): ${invented.map((i) => i.beforeClipId).join(", ")}`
    );
  }
});

await runtimeLive.runPromise(program).catch((err) => {
  console.error("Prototype failed:", err);
  process.exit(1);
});
