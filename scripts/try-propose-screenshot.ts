/**
 * Run the screenshot judge against one clip, outside the app.
 *
 * The judge is two vision calls over real footage, so it cannot be unit
 * tested — this is how you measure it. Point it at a video and an alt, and it
 * prints the chosen timestamp and reason and writes the frame to disk so you
 * can look at what it picked.
 *
 *   pnpm tsx scripts/try-propose-screenshot.ts <videoId> <clipIndex> "<alt>"
 */
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import postgres from "postgres";
import path from "node:path";
import { tmpdir } from "node:os";
import type { IndexedClip } from "../app/features/article-writer/types";
import { FFmpegCommandsService } from "../app/services/ffmpeg-commands";
import { ScreenshotProposalService } from "../app/services/screenshot-proposal.server";

const [videoId, clipIndexArg, alt] = process.argv.slice(2);

if (!videoId || !clipIndexArg || !alt) {
  console.error(
    'Usage: pnpm tsx scripts/try-propose-screenshot.ts <videoId> <clipIndex> "<alt>"'
  );
  process.exit(1);
}

const clipIndex = Number(clipIndexArg);

const sql = postgres(process.env.DATABASE_URL!);

const rows = await sql<
  {
    index: number;
    source_start_time: number;
    source_end_time: number;
    video_filename: string;
    text: string;
  }[]
>`
  select
    row_number() over (order by "order")::int as index,
    source_start_time,
    source_end_time,
    video_filename,
    text
  from "course-video-manager_clip"
  where video_id = ${videoId} and archived = false
  order by "order"
`;

await sql.end();

const clips: IndexedClip[] = rows.map((r) => ({
  index: Number(r.index),
  sourceStartTime: Number(r.source_start_time),
  sourceEndTime: Number(r.source_end_time),
  videoFilename: r.video_filename,
  text: r.text,
}));

if (clips.length === 0) {
  console.error(`No clips found for video ${videoId}`);
  process.exit(1);
}

const program = Effect.gen(function* () {
  const proposals = yield* ScreenshotProposalService;
  const ffmpeg = yield* FFmpegCommandsService;

  const started = Date.now();
  const proposal = yield* proposals.proposeScreenshot({
    alt,
    clipIndex,
    clips,
    surroundingText: "",
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!proposal.found) {
    console.log(`\nNO FRAME FOUND (${elapsed}s)\n  ${proposal.reason}\n`);
    return;
  }

  const named = clips.find((c) => c.index === clipIndex)!;
  const winning = clips.find(
    (c) =>
      c.videoFilename === named.videoFilename &&
      proposal.timestamp >= c.sourceStartTime &&
      proposal.timestamp <= c.sourceEndTime
  );

  const outputPath = path.join(tmpdir(), `proposed-${Date.now()}.png`);
  yield* ffmpeg.captureFrameAtTime(
    named.videoFilename,
    proposal.timestamp,
    outputPath
  );

  console.log(`
FOUND (${elapsed}s)
  alt        ${alt}
  asked for  clip ${clipIndex}
  landed in  clip ${winning?.index ?? "?"}
  timestamp  ${proposal.timestamp.toFixed(2)}s
  reason     ${proposal.reason}
  frame      ${outputPath}
`);
});

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        ScreenshotProposalService.Default,
        FFmpegCommandsService.Default
      )
    ),
    Effect.provide(NodeContext.layer)
  )
);

process.exit(0);
