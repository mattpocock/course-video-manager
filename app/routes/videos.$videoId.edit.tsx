import type { DB } from "@/db/schema";
import type {
  ClipOnDatabase,
  FrontendId,
} from "@/features/video-editor/clip-state-reducer";
import {
  clipStateReducer,
  createFrontendId,
} from "@/features/video-editor/clip-state-reducer";
import { useOBSConnector } from "@/features/video-editor/obs-connector";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { Effect } from "effect";
import { useEffectReducer } from "use-effect-reducer";
import type { Route } from "./+types/videos.$videoId.edit";

// Core data model - flat array of clips

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBService;
    const video = yield* db.getVideoWithClipsById(videoId);

    return { video, clips: video.clips as DB.Clip[], waveformData: undefined };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

export default function Component(props: Route.ComponentProps) {
  const [clipState, dispatch] = useEffectReducer(
    clipStateReducer,
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
    },
    {
      "archive-clips": (state, effect, dispatch) => {
        fetch("/clips/archive", {
          method: "POST",
          body: JSON.stringify({ clipIds: effect.clipIds }),
        }).then((res) => {
          res.json();
        });
      },
      "transcribe-clips": (state, effect, dispatch) => {
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
      },
      "scroll-to-bottom": () => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      },
      "update-clips": (state, effect, dispatch) => {
        fetch("/clips/update", {
          method: "POST",
          body: JSON.stringify({ clips: effect.clips }),
        }).then((res) => {
          res.json();
        });
      },
    }
  );

  const obsConnector = useOBSConnector({
    videoId: props.loaderData.video.id,
    onNewDatabaseClips: (databaseClips) => {
      dispatch({ type: "new-database-clips", clips: databaseClips });
    },
    onNewClipOptimisticallyAdded: ({ scene, profile }) => {
      dispatch({ type: "new-optimistic-clip-detected", scene, profile });
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
