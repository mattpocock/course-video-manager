/**
 * alternate-clip-zoom — a one-shot authoring pass over a Course's Clip Zooms.
 *
 * Where two or more camera Clips run back to back, this alternates their Clip
 * Zoom (none, subtle, none…) so every cut inside the run changes the shot. The
 * rule itself lives in `alternate-clip-zoom.plan.ts` and is tested there; this
 * file is only the I/O around it.
 *
 * It is a WRAPPER OVER THE cvm CLI, not a second way into the database. Every
 * read is `cvm course tree` / `cvm clip list` and every write is
 * `cvm clip update --zoom`, so this pass inherits the CLI's rules rather than
 * restating them: the camera-scene check, the Draft-Version write guard and the
 * Export Hash all behave exactly as they do when you set a zoom by hand.
 *
 * It is also deliberately NOT part of the product. Nothing in the editor or the
 * export applies a Clip Zoom on its own — a Clip Zoom is an editorial choice.
 * This is a tool you point at a Course when you want that choice made in bulk.
 *
 * USAGE
 *   tsx scripts/alternate-clip-zoom.ts --course <courseId> [--apply]
 *   tsx scripts/alternate-clip-zoom.ts --video <videoId> [--video <id>…] [--apply]
 *
 *   Without --apply it only prints the plan. Nothing is written until you ask.
 *
 * EXIT CODES
 *   0  the plan printed, or every write succeeded
 *   1  --apply was given and at least one write failed
 *   2  bad arguments
 */

import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planZoomAlternation,
  type PlannedClip,
  type ZoomChange,
} from "./alternate-clip-zoom.plan";

const USAGE = `alternate-clip-zoom — alternate the Clip Zoom along runs of camera clips.

Where two or more camera clips run back to back, set their Clip Zoom to
none, subtle, none… so every cut inside the run changes the shot. A lone camera
clip is never touched, and neither is any clip that cannot be zoomed.

USAGE
  tsx scripts/alternate-clip-zoom.ts --course <courseId> [--apply]
  tsx scripts/alternate-clip-zoom.ts --video <videoId> [--video <videoId>…] [--apply]

OPTIONS
  --course <id>   every Video in this Course's Draft Version
  --video <id>    one Video; repeat the flag for several
  --apply         actually write the changes (without it, only the plan prints)
  --help          this text

This wraps the cvm CLI, so the camera-scene rule, the Draft-Version write guard
and the Export Hash all behave as they do for 'cvm clip update' by hand.`;

/**
 * Run a cvm verb and hand back its stdout. Throws with stderr on a failure.
 *
 * stdout goes to a FILE rather than down a pipe, and that is not a style
 * choice. `cvm`'s bin edge calls process.exit as soon as the command resolves;
 * writes to a pipe are asynchronous, so anything still buffered is discarded
 * and a large read comes back silently truncated at the pipe capacity — a
 * `course tree --depth all` of this size loses roughly 90% of itself. Writes to
 * a file are synchronous and survive the exit. Reading a truncated tree would
 * quietly plan a zoom pass over a fraction of the course, so this is the
 * difference between a correct pass and a plausible-looking wrong one.
 */
const cvm = (...args: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "cvm-zoom-"));
  const outPath = join(dir, "stdout");
  const fd = openSync(outPath, "w");

  try {
    execFileSync("cvm", args, { stdio: ["ignore", fd, "pipe"] });
    return readFileSync(outPath, "utf8");
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
};

type TreeNode = {
  id: string;
  kind: string;
  name: string;
  children?: TreeNode[];
};

/** Every Video in a Course's Draft Version, in course order. */
const videosInCourse = (
  courseId: string
): Array<{ id: string; name: string }> => {
  const root = JSON.parse(cvm("course", "tree", "--depth", "all", courseId));
  const videos: Array<{ id: string; name: string }> = [];

  const walk = (node: TreeNode): void => {
    if (node.kind === "video") videos.push({ id: node.id, name: node.name });
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);

  return videos;
};

/** One Video's Clips, in timeline order. `clip list` emits NDJSON. */
const clipsInVideo = (videoId: string): PlannedClip[] =>
  cvm("clip", "list", "--video", videoId)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as PlannedClip);

const describeChange = (change: ZoomChange): string =>
  `    ${change.clipId}  ${change.from} -> ${change.to}` +
  `   (clip ${change.indexInRun + 1} of a ${change.runLength}-clip run)`;

const parseArgs = (argv: string[]) => {
  const courseIds: string[] = [];
  const videoIds: string[] = [];
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--help" || arg === "-h") return "help" as const;
    else if (arg === "--course") courseIds.push(argv[++i] ?? "");
    else if (arg === "--video") videoIds.push(argv[++i] ?? "");
    else return { error: `unknown argument ${JSON.stringify(arg)}` };
  }

  if (courseIds.length === 0 && videoIds.length === 0) {
    return { error: "give --course <id> or --video <id>" };
  }
  if (courseIds.some((id) => id === "") || videoIds.some((id) => id === "")) {
    return { error: "--course and --video each need an id" };
  }

  return { courseIds, videoIds, apply };
};

const main = (): number => {
  const args = parseArgs(process.argv.slice(2));

  if (args === "help") {
    console.log(USAGE);
    return 0;
  }
  if ("error" in args) {
    console.error(`${args.error}\n\n${USAGE}`);
    return 2;
  }

  const videos = [
    ...args.courseIds.flatMap(videosInCourse),
    ...args.videoIds.map((id) => ({ id, name: id })),
  ];

  console.log(
    `${args.apply ? "Applying" : "Planning"} zoom alternation over ${
      videos.length
    } video(s).\n`
  );

  let planned = 0;
  let applied = 0;
  let failed = 0;

  for (const video of videos) {
    const changes = planZoomAlternation(clipsInVideo(video.id));
    if (changes.length === 0) continue;

    planned += changes.length;
    console.log(`  ${video.name}`);
    for (const change of changes) console.log(describeChange(change));

    if (!args.apply) {
      console.log("");
      continue;
    }

    for (const change of changes) {
      try {
        // Options BEFORE the positional id — @effect/cli rejects a flag that
        // follows one (exit 3, "MissingValue"), as it does across every verb.
        cvm("clip", "update", "--zoom", change.to, change.clipId);
        applied++;
      } catch (error) {
        failed++;
        // stderr carries the CLI's own message — a refused scene, or a Video
        // whose Course Version is no longer a Draft.
        const stderr =
          error instanceof Error && "stderr" in error
            ? String(error.stderr).trim()
            : String(error);
        console.error(`    FAILED ${change.clipId}: ${stderr}`);
      }
    }
    console.log("");
  }

  if (planned === 0) {
    console.log("Every run already alternates. Nothing to do.");
    return 0;
  }

  console.log(
    args.apply
      ? `${applied} clip(s) updated, ${failed} failed.`
      : `${planned} clip(s) would change. Re-run with --apply to write them.`
  );

  return failed > 0 ? 1 : 0;
};

process.exit(main());
