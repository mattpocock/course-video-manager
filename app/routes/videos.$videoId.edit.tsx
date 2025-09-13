import { Button } from "@/components/ui/button";
import type { DB } from "@/db/schema";
import {
  OBSConnectionButton,
  useOBSConnector,
} from "@/features/video-editor/obs-connector";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
} from "@/features/video-editor/reducer";
import { TitleSection } from "@/features/video-editor/title-section";
import { useDebounceIdStore } from "@/features/video-editor/utils";
import {
  LiveMediaStream,
  RecordingSignalIndicator,
  VideoEditor,
} from "@/features/video-editor/video-editor";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { Effect } from "effect";
import { ChevronLeftIcon } from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/videos.$videoId.edit";

// Core data model - flat array of clips

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBService;
    const video = yield* db.getVideoWithClipsById(videoId);

    return { video, clips: video.clips, waveformData: undefined };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

// export const clientLoader = async (args: Route.ClientLoaderArgs) => {
//   const { video } = await args.serverLoader();

//   if (video.clips.length === 0) {
//     return { clips: [], video };
//   }

//   const audioBuffer = await extractAudioFromVideoURL(
//     `/view-video?videoPath=${video.clips[0]!.videoFilename}`
//   );

//   const waveformData = video.clips.reduce((acc, clip) => {
//     acc[clip.id] = getWaveformForTimeRange(
//       audioBuffer,
//       clip.sourceStartTime,
//       clip.sourceEndTime,
//       200
//     );
//     return acc;
//   }, {} as Record<string, number[]>);

//   return { clips: video.clips, waveformData, video };
// };

const useDebounceTranscribeClips = (
  onClipsUpdated: (clips: ClipOnDatabase[]) => void
) => {
  const transcribe = useDebounceIdStore(
    (ids) =>
      fetch("/clips/transcribe", {
        method: "POST",
        body: JSON.stringify({ clipIds: ids }),
      })
        .then((res) => res.json())
        .then((clips: DB.Clip[]) => {
          onClipsUpdated(
            clips.map((clip) => ({
              ...clip,
              type: "on-database",
            }))
          );
        }),
    500
  );

  return {
    transcribe,
  };
};

export default function Component(props: Route.ComponentProps) {
  const { setClipsToArchive } = useDebounceArchiveClips();

  const [clips, setClips] = useState<Clip[]>(
    props.loaderData.clips.map((clip) => ({
      ...clip,
      type: "on-database",
    }))
  );

  const obsConnector = useOBSConnector({
    videoId: props.loaderData.video.id,
    onNewDatabaseClips: (databaseClips) => {
      const toArchive = new Set<string>();
      setClips((prev) => {
        const newClips = [...prev];
        for (const databaseClip of databaseClips) {
          // Find the most recently added optimistically added clip
          const optimisticallyAddedClipIndex = newClips.findIndex(
            (c) => c.type === "optimistically-added"
          );

          if (optimisticallyAddedClipIndex === -1) {
            newClips.push({
              ...databaseClip,
              type: "on-database",
            });
            continue;
          }

          const optimisticallyAddedClip = newClips[
            optimisticallyAddedClipIndex
          ]! as ClipOptimisticallyAdded;

          // If the optimistically added clip should be archived,
          // archive it and remove it from the list
          if (optimisticallyAddedClip.shouldArchive) {
            toArchive.add(databaseClip.id);
            newClips.splice(optimisticallyAddedClipIndex, 1);
          } else {
            newClips[optimisticallyAddedClipIndex] = {
              ...databaseClip,
              type: "on-database",
            };
          }
        }

        return newClips;
      });

      if (toArchive.size > 0) {
        setClipsToArchive(Array.from(toArchive));
      }

      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });
    },
    onNewClipOptimisticallyAdded: (clip) => {
      setClips((prev) => [...prev, clip]);
    },
  });

  const transcribeClips = useDebounceTranscribeClips((modifiedClips) => {
    const newClips = clips.map((clip) => {
      const modifiedClip = modifiedClips.find((c) => c.id === clip.id);
      if (modifiedClip) {
        return modifiedClip;
      }
      return clip;
    });
    setClips(newClips);
  });

  const [clipIdsBeingTranscribed, setClipIdsBeingTranscribed] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    if (clips.length === 0) {
      return;
    }

    const clipIdsToTranscribe = clips
      .filter((clip) => clip.type === "on-database")
      .filter(
        (clip) =>
          !clip.transcribedAt &&
          !clipIdsBeingTranscribed.has(clip.id) &&
          !clip.text
      )
      .map((clip) => clip.id);

    setClipIdsBeingTranscribed(
      (prev) => new Set([...prev, ...clipIdsToTranscribe])
    );

    if (clipIdsToTranscribe.length > 0) {
      transcribeClips.transcribe(clipIdsToTranscribe);
    }
  }, [clips]);

  if (clips.length === 0) {
    return (
      <div className="flex p-6 w-full">
        <div className="flex-1">
          <TitleSection
            videoPath={props.loaderData.video.path}
            lessonPath={props.loaderData.video.lesson.path}
            repoName={props.loaderData.video.lesson.section.repo.name}
          />
          <p className="text-sm text-muted-foreground mb-4">No clips found</p>
          <div className="flex gap-2 mb-4">
            <Button asChild variant="secondary">
              <Link
                to={`/?repoId=${props.loaderData.video.lesson.section.repo.id}#${props.loaderData.video.lesson.id}`}
              >
                <ChevronLeftIcon className="w-4 h-4 mr-1" />
                Go Back
              </Link>
            </Button>
            <OBSConnectionButton state={obsConnector.state} />
          </div>
        </div>
        {obsConnector.mediaStream && (
          <div className="w-full flex-1 relative">
            {obsConnector.state.type === "obs-recording" && (
              <RecordingSignalIndicator />
            )}

            <LiveMediaStream
              mediaStream={obsConnector.mediaStream}
              speechDetectorState={obsConnector.speechDetectorState}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <VideoEditor
      onClipsRemoved={(clipIds) => {
        const clipsToRemove = clips.filter((clip) => clipIds.includes(clip.id));

        console.log("clipsToRemove", clipsToRemove);

        const optimisticClipsToMarkForArchive = clipsToRemove.filter(
          (clip) => clip.type === "optimistically-added"
        );

        const databaseClipsToRemoveDirectly = clipsToRemove.filter(
          (clip) => clip.type === "on-database"
        );

        startTransition(() => {
          setClips((prev) =>
            prev
              // Remove the database clips directly
              .filter((clip) =>
                databaseClipsToRemoveDirectly.every((c) => c.id !== clip.id)
              )
              // Mark the optimistic clips for archive
              .map((clip) => {
                if (
                  clip.type === "optimistically-added" &&
                  optimisticClipsToMarkForArchive.some((c) => c.id === clip.id)
                ) {
                  return {
                    ...clip,
                    shouldArchive: true,
                  };
                }
                return clip;
              })
          );

          setClipsToArchive(
            databaseClipsToRemoveDirectly.map((clip) => clip.id)
          );
        });
      }}
      obsConnectorState={obsConnector.state}
      clips={clips.filter((clip) => {
        if (clip.type === "optimistically-added" && clip.shouldArchive) {
          return false;
        }
        return true;
      })}
      // waveformDataForClip={props.loaderData.waveformData ?? {}}
      repoId={props.loaderData.video.lesson.section.repo.id}
      lessonId={props.loaderData.video.lesson.id}
      videoPath={props.loaderData.video.path}
      lessonPath={props.loaderData.video.lesson.path}
      repoName={props.loaderData.video.lesson.section.repo.name}
      videoId={props.loaderData.video.id}
      liveMediaStream={obsConnector.mediaStream}
      speechDetectorState={obsConnector.speechDetectorState}
      clipIdsBeingTranscribed={clipIdsBeingTranscribed}
    />
  );
}

const useDebounceArchiveClips = () => {
  const archiveClipFetcher = useFetcher();

  const setClipsToArchive = useDebounceIdStore(
    (ids) =>
      archiveClipFetcher.submit(
        { clipIds: ids },
        {
          method: "POST",
          action: "/clips/archive",
          encType: "application/json",
        }
      ),
    500
  );

  return {
    setClipsToArchive,
  };
};
