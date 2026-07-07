import {
  EffortSelector,
  EFFORT_DOT_COLORS,
  EFFORT_LABELS,
  type Effort,
} from "@/components/effort-selector";
import {
  PrioritySelector,
  PRIORITY_STYLES,
  type Priority,
} from "@/components/priority-selector";
import {
  PitchStateBadge,
  type PitchState,
} from "@/components/status-icon-badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { CoursePublishService } from "@/services/course-publish-service";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { formatSecondsToTimeCode } from "@/services/utils";
import { Effect } from "effect";
import { FileVideo, Lightbulb, Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/_app.pitches._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Pitches" }];
};

type PitchPriority = 1 | 2 | 3;
type PitchEffort = 1 | 2 | 3;

function parsePriorityParam(raw: string | null): PitchPriority[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map(Number)
        .filter((n): n is PitchPriority => n === 1 || n === 2 || n === 3)
    ),
  ];
}

function parseEffortParam(raw: string | null): PitchEffort[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map(Number)
        .filter((n): n is PitchEffort => n === 1 || n === 2 || n === 3)
    ),
  ];
}

interface PitchVideo {
  id: string;
  title: string;
  firstClipId: string | null;
  totalDuration: number;
}

interface PitchWithVideos {
  id: string;
  title: string;
  description: string;
  state: PitchState;
  priority: number;
  effort: number;
  videos: PitchVideo[];
}

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const priorityFilter = parsePriorityParam(url.searchParams.get("priority"));
  const effortFilter = parseEffortParam(url.searchParams.get("effort"));
  const showShipped = url.searchParams.get("shipped") === "1";

  const stateFilter: PitchState[] = showShipped
    ? ["idle", "scheduled", "shipped"]
    : ["idle", "scheduled"];

  return makeLoader({
    effect: () =>
      Effect.gen(function* () {
        const db = yield* PitchOperationsService;
        const publishService = yield* CoursePublishService;

        const pitchesRaw = yield* db.listPitchesWithVideos({
          state: stateFilter,
          priority: priorityFilter.length > 0 ? priorityFilter : undefined,
          effort: effortFilter.length > 0 ? effortFilter : undefined,
        });

        const hasExportedVideoMap: Record<string, boolean> = {};
        const allVideos = pitchesRaw.flatMap((p) => p.videos);
        yield* Effect.forEach(
          allVideos,
          (video) =>
            Effect.gen(function* () {
              hasExportedVideoMap[video.id] =
                yield* publishService.isExported(video);
            }),
          { concurrency: "unbounded" }
        );

        const pitches: PitchWithVideos[] = pitchesRaw.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          state: p.state,
          priority: p.priority,
          effort: p.effort,
          videos: p.videos.map((v) => ({
            id: v.id,
            title: v.title,
            firstClipId: v.clips[0]?.id ?? null,
            totalDuration: v.clips.reduce(
              (acc, c) => acc + (c.sourceEndTime - c.sourceStartTime),
              0
            ),
          })),
        }));

        return {
          pitches,
          hasExportedVideoMap,
        };
      }),
  })(args);
};

export default function PitchesIndexRoute(props: Route.ComponentProps) {
  const { pitches, hasExportedVideoMap } = props.loaderData;
  const navigate = useNavigate();
  const createPitchFetcher = useFetcher<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const priorityFilter = parsePriorityParam(searchParams.get("priority"));
  const effortFilter = parseEffortParam(searchParams.get("effort"));
  const showShipped = searchParams.get("shipped") === "1";

  useEffect(() => {
    if (createPitchFetcher.state === "idle" && createPitchFetcher.data?.id) {
      navigate(`/pitches/${createPitchFetcher.data.id}`);
    }
  }, [createPitchFetcher.state, createPitchFetcher.data, navigate]);

  const updateFilters = (
    nextPriority: PitchPriority[],
    nextEffort: PitchEffort[],
    nextShowShipped: boolean
  ) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);

      if (nextPriority.length === 0) {
        next.delete("priority");
      } else {
        next.set("priority", nextPriority.join(","));
      }

      if (nextEffort.length === 0) {
        next.delete("effort");
      } else {
        next.set("effort", nextEffort.join(","));
      }

      if (nextShowShipped) {
        next.set("shipped", "1");
      } else {
        next.delete("shipped");
      }

      return next;
    });
  };

  const togglePriority = (p: PitchPriority) => {
    const next = priorityFilter.includes(p)
      ? priorityFilter.filter((x) => x !== p)
      : [...priorityFilter, p];
    updateFilters(next, effortFilter, showShipped);
  };

  const toggleEffort = (e: PitchEffort) => {
    const next = effortFilter.includes(e)
      ? effortFilter.filter((x) => x !== e)
      : [...effortFilter, e];
    updateFilters(priorityFilter, next, showShipped);
  };

  const clearAll = () => {
    updateFilters([], [], false);
  };

  const hasActiveFilters =
    priorityFilter.length > 0 || effortFilter.length > 0 || showShipped;

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Lightbulb className="size-6" />
              Pitches
              <span className="text-base font-normal text-muted-foreground">
                {pitches.length}
              </span>
            </h1>
            <Button
              onClick={() => {
                createPitchFetcher.submit(
                  {},
                  { method: "post", action: "/api/pitches/create" }
                );
              }}
              disabled={createPitchFetcher.state !== "idle"}
            >
              <Plus className="size-4 mr-1" /> New Pitch
            </Button>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 flex-wrap">
              {([1, 2, 3] as const).map((priority) => {
                const isSelected = priorityFilter.includes(priority);
                const showAsActive = priorityFilter.length === 0 || isSelected;
                return (
                  <button
                    key={priority}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-sm font-medium transition-colors",
                      showAsActive
                        ? PRIORITY_STYLES[priority]
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                      isSelected && "ring-1 ring-current"
                    )}
                    onClick={() => togglePriority(priority)}
                  >
                    P{priority}
                  </button>
                );
              })}

              <span className="text-muted-foreground mx-0.5">|</span>

              {([1, 2, 3] as const).map((effort) => {
                const isSelected = effortFilter.includes(effort);
                const showAsActive = effortFilter.length === 0 || isSelected;
                return (
                  <button
                    key={`effort-${effort}`}
                    className={cn(
                      "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-sm font-medium transition-colors",
                      showAsActive
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40 hover:text-muted-foreground/60",
                      isSelected && "ring-1 ring-current"
                    )}
                    onClick={() => toggleEffort(effort)}
                  >
                    <span
                      className={cn(
                        "inline-block w-2 h-2 rounded-full",
                        showAsActive
                          ? EFFORT_DOT_COLORS[effort]
                          : "bg-muted-foreground/30"
                      )}
                    />
                    {EFFORT_LABELS[effort]}
                  </button>
                );
              })}

              <span className="text-muted-foreground mx-0.5">|</span>

              <button
                className={cn(
                  "text-xs px-2 py-0.5 rounded-sm font-medium transition-colors",
                  showShipped
                    ? "bg-accent text-accent-foreground ring-1 ring-current"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
                onClick={() =>
                  updateFilters(priorityFilter, effortFilter, !showShipped)
                }
              >
                Show shipped
              </button>

              {hasActiveFilters && (
                <>
                  <span className="text-muted-foreground mx-0.5">|</span>
                  <button
                    className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                    onClick={clearAll}
                  >
                    Clear all
                  </button>
                </>
              )}
            </div>
          </div>

          {pitches.length === 0 ? (
            <div className="text-center py-12">
              <Lightbulb className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-xl font-semibold mb-2">No pitches yet</h3>
              <p className="text-muted-foreground">
                {hasActiveFilters
                  ? "No pitches match these filters."
                  : "Create a pitch to start packaging your next video idea."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pitches.map((pitch) => (
                <PitchRow
                  key={pitch.id}
                  pitch={pitch}
                  hasExportedVideoMap={hasExportedVideoMap}
                />
              ))}
            </div>
          )}

          <div className="mt-6">
            <Button
              variant="outline"
              onClick={() => {
                createPitchFetcher.submit(
                  {},
                  { method: "post", action: "/api/pitches/create" }
                );
              }}
              disabled={createPitchFetcher.state !== "idle"}
            >
              <Plus className="size-4 mr-1" /> New Pitch
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PitchRow({
  pitch,
  hasExportedVideoMap,
}: {
  pitch: PitchWithVideos;
  hasExportedVideoMap: Record<string, boolean>;
}) {
  const navigate = useNavigate();
  const createVideoFetcher = useFetcher<{ id: string }>();
  const priorityFetcher = useFetcher();
  const effortFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const isDeleting =
    deleteFetcher.state !== "idle" ||
    deleteFetcher.formAction === `/api/pitches/${pitch.id}/delete`;

  const optimisticPriority = (Number(priorityFetcher.formData?.get("value")) ||
    pitch.priority) as Priority;
  const optimisticEffort = (Number(effortFetcher.formData?.get("value")) ||
    pitch.effort) as Effort;

  useEffect(() => {
    if (createVideoFetcher.state === "idle" && createVideoFetcher.data?.id) {
      navigate(`/videos/${createVideoFetcher.data.id}/edit`);
    }
  }, [createVideoFetcher.state, createVideoFetcher.data, navigate]);

  if (isDeleting) return null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="border rounded-lg bg-card hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2 px-4 py-3">
            <PitchStateBadge state={pitch.state} />
            <Link
              to={`/pitches/${pitch.id}`}
              className="flex-1 min-w-0 font-medium truncate"
            >
              {pitch.title || "Untitled Pitch"}
            </Link>
            <PrioritySelector
              priority={optimisticPriority}
              onSelect={(p) => {
                priorityFetcher.submit(
                  { field: "priority", value: String(p) },
                  {
                    method: "post",
                    action: `/api/pitches/${pitch.id}/update`,
                  }
                );
              }}
            />
            <EffortSelector
              effort={optimisticEffort}
              onSelect={(e) => {
                effortFetcher.submit(
                  { field: "effort", value: String(e) },
                  {
                    method: "post",
                    action: `/api/pitches/${pitch.id}/update`,
                  }
                );
              }}
            />
          </div>
          {pitch.description && (
            <p className="ml-12 mr-4 pb-3 text-xs text-muted-foreground line-clamp-2">
              {pitch.description}
            </p>
          )}
          <div className="px-4 pb-3">
            {pitch.videos.length === 0 ? (
              <button
                className="ml-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed rounded px-2 py-1.5 transition-colors"
                onClick={() => {
                  createVideoFetcher.submit(
                    {},
                    {
                      method: "post",
                      action: `/api/pitches/${pitch.id}/create-video`,
                    }
                  );
                }}
                disabled={createVideoFetcher.state !== "idle"}
              >
                <Plus className="w-3.5 h-3.5" />
                Video
              </button>
            ) : (
              <div className="ml-5 flex flex-wrap gap-4">
                {pitch.videos.map((video) => (
                  <Link
                    key={video.id}
                    to={`/videos/${video.id}/edit`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-left items-center group/thumb bg-muted rounded overflow-hidden inline-flex hover:ring-1 hover:ring-foreground/20 transition-all"
                  >
                    <div className="relative aspect-video w-32 bg-muted">
                      {video.firstClipId ? (
                        <img
                          src={`/clips/${video.firstClipId}/first-frame`}
                          alt={video.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center border-r">
                          <FileVideo className="w-6 h-6 text-muted-foreground/40" />
                        </div>
                      )}
                      {!hasExportedVideoMap[video.id] && (
                        <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-red-500" />
                      )}
                    </div>
                    <div className="py-1 px-6 flex flex-col items-center text-muted-foreground">
                      <span className="text-xs truncate text-foreground transition-colors">
                        {video.title || "Untitled"}
                      </span>
                      <span className="text-xs font-mono mt-0.5">
                        {formatSecondsToTimeCode(video.totalDuration)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            deleteFetcher.submit(
              {},
              {
                method: "post",
                action: `/api/pitches/${pitch.id}/delete`,
              }
            );
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete pitch
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
