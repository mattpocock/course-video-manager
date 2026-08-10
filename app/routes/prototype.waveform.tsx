// PROTOTYPE — Audio Waveform.
//
// Replaces the earlier audio-proofread prototype (ffmpeg silencedetect
// thresholds auto-flagging candidate pauses/dropouts/joins). Matt's
// feedback on that design: "this feels quite a lot worse than just seeing
// a waveform" — a thresholded detector is a worse proofreading tool than
// his own eyes on the actual audio. So instead: pick a video, render one
// row per clip — timecode, transcript, and waveform, so Matt can scan down
// the list quickly — with a dimmed sliver of each neighboring clip's audio
// at the start/end of the row and a vertical divider at each cut, so a bad
// join is visible without cross-referencing another row.
//
// No detection, no flagging, no thresholds — a picture, nothing else.

import { Effect } from "effect";
import { useState } from "react";
import { useFetcher } from "react-router";
import { data } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSecondsToTimeCode } from "@/services/utils";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import {
  ClipWaveformService,
  sanitizeWaveformOptions,
} from "@/services/clip-waveform.server";
import { makeLoader, makeAction } from "@/services/route-action.server";
import { Loader2Icon, AudioWaveformIcon } from "lucide-react";
import type { Route } from "./+types/prototype.waveform";

// ─── Data ────────────────────────────────────────────────────────────────

interface VideoOption {
  id: string;
  title: string;
  contextLabel: string;
  durationSeconds: number;
}

const computeDuration = (
  clips: { sourceStartTime: number; sourceEndTime: number }[]
) => clips.reduce((acc, c) => acc + (c.sourceEndTime - c.sourceStartTime), 0);

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const courseOps = yield* CourseOperationsService;

      const [standaloneVideos, courseList] = yield* Effect.all(
        [
          videoOps.getAllStandaloneVideos({ format: "landscape" }),
          courseOps.getCourses(),
        ],
        { concurrency: "unbounded" }
      );

      const fullCourses = yield* Effect.all(
        courseList.map((course) =>
          courseOps.getCourseWithSectionsById(course.id)
        ),
        { concurrency: "unbounded" }
      );

      const options: VideoOption[] = standaloneVideos.map((v) => ({
        id: v.id,
        title: v.title,
        contextLabel: "Standalone",
        durationSeconds: computeDuration(v.clips),
      }));

      for (let i = 0; i < courseList.length; i++) {
        const course = courseList[i]!;
        const full = fullCourses[i]!;
        const draftVersion = full.versions[0];
        if (!draftVersion) continue;

        for (const section of draftVersion.sections) {
          for (const lesson of section.lessons) {
            for (const v of lesson.videos) {
              if (v.clips.length === 0) continue;
              options.push({
                id: v.id,
                title: v.title,
                contextLabel: `${course.name} / ${section.title} / ${lesson.title}`,
                durationSeconds: computeDuration(v.clips),
              });
            }
          }
        }
      }

      options.sort((a, b) => a.title.localeCompare(b.title));

      return { videoOptions: options };
    }),
});

export const action = makeAction({
  input: "json",
  dump: false,
  effect: ({ payload }) =>
    Effect.gen(function* () {
      if (
        !payload ||
        typeof payload !== "object" ||
        !("videoId" in payload) ||
        typeof (payload as { videoId: unknown }).videoId !== "string"
      ) {
        return yield* Effect.die(
          data("Body must be a JSON object with a string videoId", {
            status: 400,
          })
        );
      }
      const { videoId, pxPerSecond, height, contextSeconds, gainDb } =
        payload as {
          videoId: string;
          pxPerSecond?: unknown;
          height?: unknown;
          contextSeconds?: unknown;
          gainDb?: unknown;
        };

      const options = sanitizeWaveformOptions({
        pxPerSecond,
        height,
        contextSeconds,
        gainDb,
      });

      const waveformService = yield* ClipWaveformService;
      const result = yield* waveformService.getWaveforms(videoId, options);
      return data({ result });
    }),
});

// ─── Presentation ────────────────────────────────────────────────────────

interface WaveformContextImage {
  durationSeconds: number;
  widthPx: number;
  imageDataUrl: string;
}

interface WaveformClip {
  clipId: string;
  order: number;
  videoStartSeconds: number;
  durationSeconds: number;
  text: string;
  widthPx: number;
  imageDataUrl: string;
  leadIn: WaveformContextImage | null;
  leadOut: WaveformContextImage | null;
}

interface WaveformResultData {
  videoId: string;
  title: string;
  totalDurationSeconds: number;
  clips: WaveformClip[];
}

type RenderResponse = { result: WaveformResultData };

const DEFAULT_PX_PER_SECOND = 40;
const DEFAULT_HEIGHT = 64;
// Talking-head recordings peak well below 0dBFS, and showwavespic maps
// amplitude onto image height with no auto-gain — without this, normal
// speech renders as a near-invisible sliver regardless of zoom/height. +12dB
// was measured (see ffmpeg-commands.ts's generateWaveformPng doc comment) to
// make a typical quiet clip use most of the image height without pinning
// louder passages flat. Source levels vary clip to clip, so it's a knob, not
// a constant.
const DEFAULT_GAIN_DB = 12;
// "the first five seconds" — Matt's own words for how much of the adjacent
// clip's audio should show, dimmed, on each side of a row.
const DEFAULT_CONTEXT_SECONDS = 5;

function WaveformRow({ clip, height }: { clip: WaveformClip; height: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
          #{clip.order + 1} · {formatSecondsToTimeCode(clip.videoStartSeconds)}
        </span>
      </div>
      <p className="text-sm leading-snug">
        {clip.text.trim() || (
          <span className="text-muted-foreground italic">(no transcript)</span>
        )}
      </p>
      <div className="overflow-x-auto">
        <div className="flex items-end w-max">
          {clip.leadIn && (
            <img
              src={clip.leadIn.imageDataUrl}
              alt={`End of clip ${clip.order}`}
              width={clip.leadIn.widthPx}
              height={height}
              className="block opacity-35"
              title="Previous clip's tail — context only"
            />
          )}
          {clip.leadIn && (
            <div
              className="w-0.5 shrink-0 bg-sky-400"
              style={{ height }}
              title="Cut: previous clip → this clip"
            />
          )}
          <img
            src={clip.imageDataUrl}
            alt={`Waveform for clip ${clip.order + 1}`}
            width={clip.widthPx}
            height={height}
            className="block"
          />
          {clip.leadOut && (
            <div
              className="w-0.5 shrink-0 bg-sky-400"
              style={{ height }}
              title="Cut: this clip → next clip"
            />
          )}
          {clip.leadOut && (
            <img
              src={clip.leadOut.imageDataUrl}
              alt={`Start of clip ${clip.order + 2}`}
              width={clip.leadOut.widthPx}
              height={height}
              className="block opacity-35"
              title="Next clip's head — context only"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WaveformList({
  clips,
  height,
}: {
  clips: WaveformClip[];
  height: number;
}) {
  if (clips.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No clips to render.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {clips.map((clip) => (
        <WaveformRow key={clip.clipId} clip={clip} height={height} />
      ))}
    </div>
  );
}

// ─── Route ───────────────────────────────────────────────────────────────

export default function PrototypeWaveform({
  loaderData,
}: Route.ComponentProps) {
  const { videoOptions } = loaderData;
  const [selectedVideoId, setSelectedVideoId] = useState<string>(
    videoOptions[0]?.id ?? ""
  );
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [contextSeconds, setContextSeconds] = useState(DEFAULT_CONTEXT_SECONDS);
  const [gainDb, setGainDb] = useState(DEFAULT_GAIN_DB);
  const fetcher = useFetcher<RenderResponse>();

  const isRendering = fetcher.state !== "idle";
  const result = fetcher.data?.result;

  const runRender = () => {
    if (!selectedVideoId) return;
    fetcher.submit(
      JSON.stringify({
        videoId: selectedVideoId,
        pxPerSecond,
        height,
        contextSeconds,
        gainDb,
      }),
      {
        method: "post",
        encType: "application/json",
      }
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">Audio Waveform (prototype)</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          One row per clip — timecode, transcript, waveform — with a dimmed
          sliver of each neighboring clip's audio and a vertical divider at
          every cut, so a bad join is visible without cross-referencing another
          row. Proofread by looking, not by trusting a detector.
        </p>
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <Select value={selectedVideoId} onValueChange={setSelectedVideoId}>
            <SelectTrigger className="w-[420px]">
              <SelectValue placeholder="Pick a video…" />
            </SelectTrigger>
            <SelectContent>
              {videoOptions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.title}{" "}
                  <span className="text-muted-foreground">
                    — {v.contextLabel}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Zoom (px/sec)
            <Input
              type="number"
              min={2}
              max={400}
              value={pxPerSecond}
              onChange={(e) => setPxPerSecond(Number(e.target.value))}
              className="w-28"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Height (px)
            <Input
              type="number"
              min={16}
              max={400}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="w-28"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Join context (s)
            <Input
              type="number"
              min={0}
              max={30}
              value={contextSeconds}
              onChange={(e) => setContextSeconds(Number(e.target.value))}
              className="w-28"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Gain (dB)
            <Input
              type="number"
              min={-24}
              max={48}
              value={gainDb}
              onChange={(e) => setGainDb(Number(e.target.value))}
              className="w-28"
            />
          </label>

          <Button
            onClick={runRender}
            disabled={!selectedVideoId || isRendering}
          >
            {isRendering ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <AudioWaveformIcon className="size-4" />
            )}
            Render
          </Button>
        </div>

        {videoOptions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No videos with clips found.
          </p>
        )}

        {isRendering && (
          <p className="text-sm text-muted-foreground">
            Rendering up to three waveform images per clip (its own audio, plus
            join context from each neighbor) — this shells out to ffmpeg several
            times per clip, so it can take a while on a long video.
          </p>
        )}

        {result && !isRendering && (
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium mb-1">{result.title}</h2>
              <p className="text-xs text-muted-foreground">
                {formatSecondsToTimeCode(result.totalDurationSeconds)} total ·{" "}
                {result.clips.length} clip
                {result.clips.length === 1 ? "" : "s"}
              </p>
            </div>

            <WaveformList clips={result.clips} height={height} />
          </div>
        )}
      </div>
    </div>
  );
}
