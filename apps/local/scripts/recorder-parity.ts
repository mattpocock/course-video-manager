/**
 * Recorder parity: does a CVM-recorder Clip look and sound like an OBS Clip
 * when both land in one exported Video?
 *
 *   pnpm --filter @cvm/local recorder-parity <obs-clip-id> <cvm-clip-id>
 *   pnpm --filter @cvm/local recorder-parity --video <video-id>
 *     [--seconds 4] [--out <dir>]
 *
 * `--video` takes the first OBS Clip and the first CVM-recorder Clip of that
 * Video, in order. Each Clip's first `--seconds` is rendered through the real
 * segmented export (`clipSegmentArgs`, as `concatenateClipSegments` runs it
 * for a Video holding a CVM-recorder Clip), in the CVM Clip's Video Format.
 * Writes `report.md`, a side-by-side still and a 50% blend still (layout
 * geometry: anything that does not line up shows as a double image), and
 * prints the report's path.
 *
 * Reads the database only (Clips, their Recording Session) and the Footage
 * files on disk. Opens no capture device.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import * as schema from "@cvm/core/db/schema";
import { clipRecordingSessionRelation } from "@cvm/core/services/clip-recording-session-relation";
import { DEFAULT_MIC_OFFSET_MS } from "@cvm/core/features/videos/recorder";
import { VIDEO_FORMAT_DIMENSIONS } from "@cvm/core/features/videos/video-format";
import {
  clipComposite,
  clipFfmpegInput,
  clipSource,
} from "@/packages/clip-source";
import { clipSegmentArgs } from "@/services/clip-segment-args";
import { micEqFilters } from "@/packages/mic-eq";
import { cpuFallbackArgs } from "@/services/ffmpeg-error";
import {
  BANDS,
  compareSides,
  MEASURE_FILTERS,
  parseBlurMean,
  parseIntegratedLufs,
  parseLumaLevels,
  parseProbe,
  parseRmsLevel,
  renderReport,
  type BandLevels,
  type SideMetrics,
} from "./recorder-parity-metrics";
import { scriptDrizzle } from "./script-database-url";

const USAGE =
  "Usage: recorder-parity <obs-clip-id> <cvm-clip-id> | --video <video-id>  [--seconds 4] [--out <dir>]";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const videoId = flag("--video");
const seconds = Number(flag("--seconds") ?? "4");
const outDir = path.resolve(
  flag("--out") ??
    path.join(
      os.tmpdir(),
      `recorder-parity-${new Date().toISOString().replace(/[:.]/g, "-")}`
    )
);
if ((!videoId && args.length !== 2) || !(seconds > 0)) {
  console.error(USAGE);
  process.exit(2);
}

const { db } = scriptDrizzle();

const clipQuery = {
  with: {
    recordingSession: clipRecordingSessionRelation,
    video: { columns: { format: true, title: true } },
  },
} as const;

const loadClip = async (id: string) => {
  const clip = await db.query.clips.findFirst({
    ...clipQuery,
    where: eq(schema.clips.id, id),
  });
  if (!clip) throw new Error(`No Clip ${id}`);
  return clip;
};

const pickClips = async () => {
  if (!videoId) {
    return Promise.all([loadClip(args[0]!), loadClip(args[1]!)]);
  }
  const clips = await db.query.clips.findMany({
    ...clipQuery,
    where: eq(schema.clips.videoId, videoId),
    orderBy: asc(schema.clips.order),
  });
  const live = clips.filter((c) => !c.archived);
  const obs = live.find((c) => c.recordingSessionId === null);
  const cvm = live.find((c) => c.recordingSessionId !== null);
  if (!obs || !cvm) {
    throw new Error(
      `Video ${videoId} needs an OBS Clip and a CVM-recorder Clip (has ${live.length} Clips)`
    );
  }
  return [obs, cvm] as const;
};

const [obsClip, cvmClip] = await pickClips();
if (obsClip.recordingSessionId !== null) {
  throw new Error(`Clip ${obsClip.id} is a CVM-recorder Clip, not an OBS one`);
}
const session = cvmClip.recordingSession;
if (!session) {
  throw new Error(`Clip ${cvmClip.id} has no Recording Session`);
}
const format = session.format;
const dims = VIDEO_FORMAT_DIMENSIONS[format];
fs.mkdirSync(outDir, { recursive: true });

const ffmpeg = (ffArgs: readonly string[]): string => {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...ffArgs], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`ffmpeg failed:\n${run.stderr.slice(-2000)}`);
  }
  return run.stderr;
};

const ffprobe = (file: string, entries: string) =>
  execFileSync(
    "ffprobe",
    ["-v", "error", ...entries.split(" "), "-of", "json", file],
    { encoding: "utf8" }
  );

/** One Clip's first `seconds`, rendered as the segmented export renders it. */
const renderSegment = (clip: typeof obsClip, name: string) => {
  const source = clipSource(clip);
  const input = clipFfmpegInput(source);
  const duration = Math.min(seconds, input.duration);
  const out = path.join(outDir, `${name}.mov`);
  const segmentArgs = clipSegmentArgs(
    {
      inputVideo: input.inputVideo,
      startTime: input.startTime,
      duration,
      zoomType: clip.zoomType,
      composite: clipComposite(source, { durationSeconds: duration }),
    },
    dims,
    out
  );
  const run = spawnSync("ffmpeg", segmentArgs, { encoding: "utf8" });
  if (run.status !== 0) {
    const fallback = cpuFallbackArgs(segmentArgs, run.stderr);
    if (!fallback)
      throw new Error(`Render of ${name} failed:\n${run.stderr.slice(-2000)}`);
    ffmpeg(fallback);
  }
  return { file: out, duration, source, input };
};

const bandLevels = (
  inputArgs: readonly string[],
  before: readonly string[] = []
): BandLevels => {
  const level = (band: (typeof BANDS)[number]) =>
    parseRmsLevel(
      ffmpeg([
        ...inputArgs,
        "-af",
        [...before, MEASURE_FILTERS.band(band)].join(","),
        "-f",
        "null",
        "-",
      ])
    );
  return { lowDb: level("low"), midDb: level("mid"), highDb: level("high") };
};

const measure = (file: string): SideMetrics => {
  const probe = parseProbe(ffprobe(file, "-show_streams"));
  const pictureLog = ffmpeg([
    "-i",
    file,
    "-an",
    "-vf",
    MEASURE_FILTERS.picture,
    "-f",
    "null",
    "-",
  ]);
  const loudnessLog = ffmpeg([
    "-i",
    file,
    "-vn",
    "-af",
    MEASURE_FILTERS.loudness,
    "-f",
    "null",
    "-",
  ]);
  return {
    picture: probe.picture,
    levels: parseLumaLevels(pictureLog),
    blurMean: parseBlurMean(pictureLog),
    lufs: parseIntegratedLufs(loudnessLog),
    bands: bandLevels(["-i", file, "-vn"]),
    avDurationSkewMs: probe.avDurationSkewMs ?? Number.NaN,
  };
};

/** A Footage file's own colour tags, for the report's context. */
const describeFootage = (label: string, file: string) => {
  try {
    const { picture } = parseProbe(ffprobe(file, "-show_streams"));
    return `${label} \`${file}\`: ${picture.width}x${picture.height} @ ${picture.fps}, ${picture.pixFmt}, range ${picture.colorRange}, matrix ${picture.colorSpace}, primaries ${picture.colorPrimaries}`;
  } catch (error) {
    return `${label} \`${file}\`: unreadable (${(error as Error).message.split("\n")[0]})`;
  }
};

const startTime = (file: string) =>
  Number(
    (
      JSON.parse(ffprobe(file, "-show_entries format=start_time")) as {
        format: { start_time: string };
      }
    ).format.start_time
  );

console.log(`Rendering ${seconds}s of each Clip (${format}) into ${outDir}`);
const obs = renderSegment(obsClip, "obs");
const cvm = renderSegment(cvmClip, "cvm");
const obsMetrics = measure(obs.file);
const cvmMetrics = measure(cvm.file);
const rawMicSpan = [
  "-ss",
  String(cvm.input.startTime),
  "-t",
  String(cvm.duration),
  "-i",
  session.micFilePath,
  "-vn",
];
const cvmRawMicBands = bandLevels(rawMicSpan);
const micEq = cvm.source.kind === "recording-session" ? cvm.source.micEq : null;
const cvmObsEqMicBands = micEq
  ? bandLevels(rawMicSpan, micEqFilters(micEq))
  : null;

const stillAt = String(Math.min(obs.duration, cvm.duration) / 2);
const still = (out: string, graph: string) =>
  ffmpeg([
    "-y",
    "-ss",
    stillAt,
    "-i",
    obs.file,
    "-ss",
    stillAt,
    "-i",
    cvm.file,
    "-filter_complex",
    graph,
    "-frames:v",
    "1",
    path.join(outDir, out),
  ]);
still("side-by-side.png", "[0:v][1:v]hstack=inputs=2");
still("blend.png", "[0:v][1:v]blend=all_mode=average");

const checks = compareSides({
  obs: obsMetrics,
  cvm: cvmMetrics,
  cvmRawMicBands,
  cvmObsEqMicBands,
});
const files = [session.cameraFilePath, session.micFilePath];
const report = renderReport({
  title: `Recorder parity: OBS Clip vs CVM-recorder Clip (${format})`,
  context: [
    `OBS Clip \`${obsClip.id}\` (Video "${obsClip.video.title}"), ${obs.duration.toFixed(2)}s from ${obsClip.sourceStartTime}s`,
    `CVM Clip \`${cvmClip.id}\` (Video "${cvmClip.video.title}"), Recording Session \`${session.id}\`, ${cvm.duration.toFixed(2)}s from ${cvmClip.sourceStartTime}s`,
    `Both rendered by \`clipSegmentArgs\` at ${dims.width}x${dims.height}; stills taken ${stillAt}s in (OBS left, CVM right)`,
    describeFootage("OBS Footage", obsClip.videoFilename),
    describeFootage("CVM camera", session.cameraFilePath),
    ...(session.screenCaptured
      ? [describeFootage("CVM screen", session.screenFilePath)]
      : []),
    `Mic EQ the export applied: ${micEq ? `low ${micEq.lowDb} dB, mid ${micEq.midDb} dB, high ${micEq.highDb} dB` : "none"}`,
    `Mic offset: ${session.micOffsetMs} ms (OBS applies ${DEFAULT_MIC_OFFSET_MS} ms to the same mic); raw camera/mic start skew ${Math.round((startTime(files[1]!) - startTime(files[0]!)) * 1000)} ms`,
  ],
  images: [
    { label: "Side by side (OBS left, CVM right)", file: "side-by-side.png" },
    { label: "50% blend (layout geometry)", file: "blend.png" },
  ],
  checks,
  notes: [
    "Layout geometry is judged by eye from the blend: the camera and screen line up when both images overlap cleanly.",
    "Lip sync is checked structurally (segment durations, offsets); a take with a clap is the only true measure of it.",
    "LUFS is measured before the export's whole-Video normalize pass, which moves every Clip alike, so a difference here is a step between Clips in the export.",
  ],
});
const reportFile = path.join(outDir, "report.md");
fs.writeFileSync(reportFile, report);
console.log(report);
console.log(`\nReport: ${reportFile}`);
process.exit(checks.every((c) => c.pass) ? 0 : 1);
