// PROTOTYPE — Audio Waveform.
//
// Replaces the earlier audio-proofread prototype (ffmpeg silencedetect
// thresholds auto-flagging candidate pauses/dropouts/joins). Matt's
// feedback on that design: "this feels quite a lot worse than just seeing
// a waveform" — a thresholded detector is a worse proofreading tool than
// his own eyes on the actual audio. So instead: pick a video, render its
// waveform (one image per clip, at the zoom/height you choose), and look at
// it yourself. Clip boundaries are marked with a vertical divider so a
// click or level-jump right at a join is easy to spot.
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
      const { videoId, pxPerSecond, height } = payload as {
        videoId: string;
        pxPerSecond?: unknown;
        height?: unknown;
      };

      const options = sanitizeWaveformOptions({ pxPerSecond, height });

      const waveformService = yield* ClipWaveformService;
      const result = yield* waveformService.getWaveforms(videoId, options);
      return data({ result });
    }),
});

// ─── Presentation ────────────────────────────────────────────────────────

interface WaveformClip {
  clipId: string;
  order: number;
  videoStartSeconds: number;
  durationSeconds: number;
  widthPx: number;
  imageDataUrl: string;
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

function WaveformStrip({
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
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div className="flex items-end w-max">
        {clips.map((clip) => (
          <div
            key={clip.clipId}
            className="group relative shrink-0 border-r-2 border-sky-400"
            style={{ width: clip.widthPx, height }}
            title={`Clip #${clip.order + 1} · starts ${formatSecondsToTimeCode(
              clip.videoStartSeconds
            )} · ${clip.durationSeconds.toFixed(2)}s`}
          >
            <img
              src={clip.imageDataUrl}
              alt={`Waveform for clip ${clip.order + 1}`}
              width={clip.widthPx}
              height={height}
              className="block"
            />
            <div className="absolute inset-x-0 bottom-0 translate-y-full pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap text-[10px] text-muted-foreground tabular-nums">
              #{clip.order + 1} ·{" "}
              {formatSecondsToTimeCode(clip.videoStartSeconds)}
            </div>
          </div>
        ))}
      </div>
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
  const fetcher = useFetcher<RenderResponse>();

  const isRendering = fetcher.state !== "idle";
  const result = fetcher.data?.result;

  const runRender = () => {
    if (!selectedVideoId) return;
    fetcher.submit(
      JSON.stringify({ videoId: selectedVideoId, pxPerSecond, height }),
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
          Renders a rendered lesson's audio as a waveform, one image per clip,
          with a vertical divider at every clip boundary — proofread by looking,
          not by trusting a detector.
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
            Rendering one waveform image per clip — this shells out to ffmpeg
            once per clip, so it can take a while on a long video.
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

            <WaveformStrip clips={result.clips} height={height} />
          </div>
        )}
      </div>
    </div>
  );
}
