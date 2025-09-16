import { Button } from "@/components/ui/button";
import type { DB } from "@/db/schema";
import {
  OBSConnectionButton,
  useOBSConnector,
} from "@/features/video-editor/obs-connector";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendId,
} from "@/features/video-editor/clip-state-reducer";
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
import { startTransition, useEffect, useReducer, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/videos.$videoId.edit";
import {
  clipStateReducer,
  createFrontendId,
} from "@/features/video-editor/clip-state-reducer";

// Core data model - flat array of clips

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBService;
    const video = yield* db.getVideoWithClipsById(videoId);

    return { video, clips: video.clips as DB.Clip[], waveformData: undefined };
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

export default function Component(props: Route.ComponentProps) {
  const { setClipsToArchive } = useDebounceArchiveClips();

  const [clipState, dispatch] = useReducer(
    clipStateReducer((effect) => {
      if (effect.type === "transcribe-clips") {
        fetch("/clips/transcribe", {
          method: "POST",
          body: JSON.stringify({ clipIds: effect.clipIds }),
        })
          .then((res) => res.json())
          .then((clips: DB.Clip[]) => {
            dispatch({
              type: "clips-transcribed",
              clips: clips.map((clip) => ({
                databaseId: clip.id,
                text: clip.text,
              })),
            });
          });
      } else if (effect.type === "archive-clips") {
        setClipsToArchive(effect.clipIds);
      } else if (effect.type === "scroll-to-bottom") {
        // Wrap in a setTimeout to ensure the frontend is rendered
        // before scrolling to the bottom
        setTimeout(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: "smooth",
          });
        }, 0);
      }
    }),
    {
      clips: props.loaderData.clips.map(
        (clip): ClipOnDatabase => ({
          ...clip,
          type: "on-database",
          frontendId: createFrontendId(),
          databaseId: clip.id,
        })
      ),
      clipIdsBeingTranscribed: new Set() satisfies Set<FrontendId>,
    }
  );

  const obsConnector = useOBSConnector({
    videoId: props.loaderData.video.id,
    onNewDatabaseClips: (databaseClips) => {
      dispatch({ type: "new-database-clips", clips: databaseClips });
    },
    onNewClipOptimisticallyAdded: () => {
      dispatch({ type: "new-optimistic-clip-detected" });
    },
  });

  return (
    <VideoEditor
      onClipsRemoved={(clipIds) => {
        dispatch({ type: "clips-deleted", clipIds: clipIds });
      }}
      obsConnectorState={obsConnector.state}
      clips={clipState.clips.filter((clip) => {
        if (clip.type === "optimistically-added" && clip.shouldArchive) {
          return false;
        }
        return true;
      })}
      repoId={props.loaderData.video.lesson.section.repo.id}
      lessonId={props.loaderData.video.lesson.id}
      videoPath={props.loaderData.video.path}
      lessonPath={props.loaderData.video.lesson.path}
      repoName={props.loaderData.video.lesson.section.repo.name}
      videoId={props.loaderData.video.id}
      liveMediaStream={obsConnector.mediaStream}
      speechDetectorState={obsConnector.speechDetectorState}
      clipIdsBeingTranscribed={clipState.clipIdsBeingTranscribed}
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
