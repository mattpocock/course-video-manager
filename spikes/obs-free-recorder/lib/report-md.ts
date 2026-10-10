// report.md: the human-readable view of report.json.
import type { Report } from "./analyze.ts";
import { toWindowsPath } from "./win.ts";

export function toMarkdown(r: Report): string {
  const lines = [
    `# Rig report: ${r.mode}${r.synthetic ? (r.synthetic.realScreen ? " (real screen via ddagrab, synthetic camera and mic)" : " (synthetic sources)") : ""}`,
    "",
    `Run: \`${r.runDir}\` (Windows: \`${safeWin(r.runDir)}\`), ${r.durationSec} s recorded.`,
    "",
    "## Stop criteria",
    "",
    "| Criterion | Result |",
    "|---|---|",
    ...Object.entries(r.verdicts).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Sync at each marker (ms, onset of flash/beep)",
    "",
    "| Marker | file time (s) | camera - screen | audio - screen | audio - camera | camera - screen in file time |",
    "|---|---|---|---|---|---|",
    ...r.markers.map(
      (m) =>
        `| ${m.marker} | ${m.expected} | ${m.camMinusScreenMs ?? "–"} | ${m.audioMinusScreenMs ?? "–"} | ${m.audioMinusCameraMs ?? "–"} | ${m.fileTimeCamMinusScreenMs ?? "–"} |`
    ),
    "",
    "| Pair | markers | median offset | max deviation from median | range | linear trend over run |",
    "|---|---|---|---|---|---|",
    ...(
      [
        ["camera - screen", r.sync.camMinusScreen],
        ["audio - screen", r.sync.audioMinusScreen],
        ["audio - camera", r.sync.audioMinusCamera],
      ] as const
    ).map(
      ([k, d]) =>
        `| ${k} | ${d.n} | ${d.medianMs ?? "–"} | ${d.maxDevMs ?? "–"} | ${d.rangeMs ?? "–"} | ${d.trendMs ?? "–"} |`
    ),
    "",
    "The median offset is a constant (device latency, packetisation) to calibrate once; only movement is drift. Each pair is judged on |linear trend over the run| <= 33 ms (steady drift) and every marker within 33 ms of the median (jumps). Video onsets are capture-time: the CFR step's shift of the flash frame (read from *-arrivals.txt) is taken off, which removes the camera's saw-tooth. The last column is the raw file-time offset, which carries that saw-tooth (up to one camera frame, as in OBS). The OBS baseline has no arrival stamps, so its camera pairs get one frame of extra room.",
    "",
    "## Frames",
    "",
    "```json",
    JSON.stringify(r.frames, null, 1),
    "```",
    r.logWarnings.length
      ? `ffmpeg log warnings (first 20):\n\n\`\`\`\n${r.logWarnings.join("\n")}\n\`\`\``
      : "No drop/buffer warnings in the ffmpeg log.",
    "",
    "## Resources, size, latency",
    "",
    `- Size: ${r.sizeGB} GB, **${r.gbPerHour} GB/h**`,
    `- Preview delay, screen path (${r.previewDelayMs.source}; on-screen ms clock drawn → preview frame decoded in the page): ${fmtDelay(r.previewDelayMs.screenFeed, "page not opened, or the page wasn't fullscreen on the captured monitor")}`,
    `- Preview delay, camera path (${r.previewDelayMs.source}; flash drawn → seen by the camera → preview frame decoded in the page): ${fmtDelay(r.previewDelayMs.cameraFeed, "page not opened, or the camera never saw a flash")}`,
    "- Neither includes the page's composite or the display's scan-out (about 1–2 frames more), so they are not full glass-to-glass.",
    `- Preview frames received by the server: ${
      r.preview
        ? Object.entries(r.preview)
            .map(
              ([k, v]) =>
                `${k} ${v.frames} (first at ${v.firstFrameSec ?? "–"} s, longest gap ${v.maxGapSec} s)`
            )
            .join(", ")
        : "n/a"
    }`,
    "",
    "```json",
    JSON.stringify(
      { resources: r.resources, comparison: r.comparison },
      null,
      1
    ),
    "```",
    "",
    r.crash
      ? `## kill -9 recovery\n\n\`\`\`json\n${JSON.stringify(r.crash, null, 1)}\n\`\`\``
      : "",
    "## Formats",
    "",
    "```json",
    JSON.stringify(r.formats, null, 1),
    "```",
    "",
  ];
  return lines.join("\n");
}

function fmtDelay(
  d: { p50: number; p95: number; n: number } | null,
  why: string
) {
  return d
    ? `p50 ${d.p50} / p95 ${d.p95} ms over ${d.n} frames`
    : `n/a (${why})`;
}

function safeWin(p: string) {
  try {
    return toWindowsPath(p);
  } catch {
    return p;
  }
}
