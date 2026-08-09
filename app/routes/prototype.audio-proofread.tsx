// PROTOTYPE — Audio Proofread.
// Answers one question: can ffmpeg silence-detection catch the kind of
// editing problems a human notices by ear in a rendered lesson (a pause that
// runs long, a brief audio dropout, a click at a clip join)? Pick a video,
// click Analyze, judge the results against what you'd actually write as
// feedback. No auto-fix, no publish-gating — a report, nothing else.
//
// Ground truth to test against: "Choosing a Model" — a human wrote
// "(1:30) There is a pause lasting a few seconds that could be shortened"
// and "(5:39) The audio cuts out very briefly."

import { Effect } from "effect";
import { useState } from "react";
import { useFetcher } from "react-router";
import { data } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import {
  ClipAudioProofreadService,
  type ProofreadSpan,
  type ProofreadSpanType,
} from "@/services/clip-audio-proofread";
import { makeLoader, makeAction } from "@/services/route-action.server";
import { Loader2Icon, PlayIcon } from "lucide-react";
import type { Route } from "./+types/prototype.audio-proofread";

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
      const { videoId } = payload as { videoId: string };

      const proofreadService = yield* ClipAudioProofreadService;
      const result = yield* proofreadService.proofreadVideo(videoId);
      return data({ result });
    }),
});

// ─── Presentation ────────────────────────────────────────────────────────

const TYPE_META: Record<
  ProofreadSpanType,
  { label: string; dotClass: string; badgeClass: string }
> = {
  "long-pause": {
    label: "Long pause",
    dotClass: "bg-amber-400",
    badgeClass: "border-amber-500/40 text-amber-400",
  },
  "short-cutout": {
    label: "Short cutout",
    dotClass: "bg-red-400",
    badgeClass: "border-red-500/40 text-red-400",
  },
  boundary: {
    label: "Boundary",
    dotClass: "bg-sky-400",
    badgeClass: "border-sky-500/40 text-sky-400",
  },
};

function Timeline({
  totalDurationSeconds,
  spans,
}: {
  totalDurationSeconds: number;
  spans: ProofreadSpan[];
}) {
  if (totalDurationSeconds <= 0) return null;

  return (
    <div className="space-y-2">
      <div className="relative h-10 rounded-md border border-border bg-card">
        {spans.map((span, i) => {
          const pct = Math.min(
            100,
            Math.max(
              0,
              (span.videoTimestampSeconds / totalDurationSeconds) * 100
            )
          );
          const meta = TYPE_META[span.type];
          return (
            <div
              key={i}
              className={cn(
                "absolute top-0 -translate-x-1/2 w-2.5 h-full rounded-sm opacity-80 hover:opacity-100 cursor-default",
                meta.dotClass
              )}
              style={{ left: `${pct}%` }}
              title={`${meta.label} · ${formatSecondsToTimeCode(
                span.videoTimestampSeconds
              )} · ${span.durationSeconds.toFixed(2)}s`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>0:00</span>
        <span>{formatSecondsToTimeCode(totalDurationSeconds)}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {(Object.keys(TYPE_META) as ProofreadSpanType[]).map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className={cn("size-2.5 rounded-sm", TYPE_META[type].dotClass)}
            />
            {TYPE_META[type].label}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpansTable({ spans }: { spans: ProofreadSpan[] }) {
  if (spans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No candidate spots found.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground border-b border-border">
          <th className="py-2 pr-4 font-medium">Type</th>
          <th className="py-2 pr-4 font-medium">Timestamp</th>
          <th className="py-2 pr-4 font-medium">Duration</th>
          <th className="py-2 pr-4 font-medium">Clip id</th>
        </tr>
      </thead>
      <tbody>
        {spans.map((span, i) => {
          const meta = TYPE_META[span.type];
          return (
            <tr key={i} className="border-b border-border/50">
              <td className="py-2 pr-4">
                <Badge variant="outline" className={meta.badgeClass}>
                  {meta.label}
                </Badge>
              </td>
              <td className="py-2 pr-4 tabular-nums">
                {formatSecondsToTimeCode(span.videoTimestampSeconds)}
              </td>
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                {span.durationSeconds.toFixed(2)}s
              </td>
              <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                {span.clipId}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Route ───────────────────────────────────────────────────────────────

interface AnalyzeResult {
  videoId: string;
  title: string;
  totalDurationSeconds: number;
  spans: ProofreadSpan[];
}

type AnalyzeResponse = { result: AnalyzeResult };

export default function PrototypeAudioProofread({
  loaderData,
}: Route.ComponentProps) {
  const { videoOptions } = loaderData;
  const [selectedVideoId, setSelectedVideoId] = useState<string>(
    videoOptions[0]?.id ?? ""
  );
  const fetcher = useFetcher<AnalyzeResponse>();

  const isAnalyzing = fetcher.state !== "idle";
  const result = fetcher.data?.result;

  const runAnalysis = () => {
    if (!selectedVideoId) return;
    fetcher.submit(
      { videoId: selectedVideoId },
      { method: "post", encType: "application/json" }
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">Audio Proofread (prototype)</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          ffmpeg silence-detection over a rendered lesson's clips — validating
          whether it catches what a human notices by ear. Not a feature yet.
        </p>
      </div>

      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
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
          <Button
            onClick={runAnalysis}
            disabled={!selectedVideoId || isAnalyzing}
          >
            {isAnalyzing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlayIcon className="size-4" />
            )}
            Analyze
          </Button>
        </div>

        {videoOptions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No videos with clips found.
          </p>
        )}

        {isAnalyzing && (
          <p className="text-sm text-muted-foreground">
            Running silence detection per clip and per clip boundary — this
            shells out to ffmpeg once or twice per clip, so it can take a while
            on a long video.
          </p>
        )}

        {result && !isAnalyzing && (
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-medium mb-1">{result.title}</h2>
              <p className="text-xs text-muted-foreground">
                {formatSecondsToTimeCode(result.totalDurationSeconds)} total ·{" "}
                {result.spans.length} candidate spot
                {result.spans.length === 1 ? "" : "s"}
              </p>
            </div>

            <Timeline
              totalDurationSeconds={result.totalDurationSeconds}
              spans={result.spans}
            />

            <SpansTable spans={result.spans} />
          </div>
        )}
      </div>
    </div>
  );
}
