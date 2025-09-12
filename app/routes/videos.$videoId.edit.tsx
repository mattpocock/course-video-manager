import { Button } from "@/components/ui/button";
import {
  OBSConnectionButton,
  useOBSConnector,
} from "@/features/video-editor/obs-connector";
import { TitleSection } from "@/features/video-editor/title-section";
import { useSpeechDetector } from "@/features/video-editor/use-speech-detector";
import {
  LiveMediaStream,
  RecordingSignalIndicator,
  VideoEditor,
} from "@/features/video-editor/video-editor";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { Effect } from "effect";
import { ChevronLeftIcon } from "lucide-react";
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

export default function Component(props: Route.ComponentProps) {
  const refetch = useFetcher();
  const obsConnector = useOBSConnector({
    videoId: props.loaderData.video.id,
    onImportComplete: () => {
      refetch.load(`/videos/${props.loaderData.video.id}/edit`).then(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      });
    },
  });

  const speechDetectorState = useSpeechDetector({
    mediaStream: obsConnector.mediaStream,
    isRecording: obsConnector.state.type === "obs-recording",
  });

  if (props.loaderData.clips.length === 0) {
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
            <OBSConnectionButton
              state={obsConnector.state}
              isImporting={obsConnector.isImporting}
            />
          </div>
        </div>
        {obsConnector.mediaStream && (
          <div className="w-full flex-1 relative">
            {obsConnector.state.type === "obs-recording" && (
              <RecordingSignalIndicator />
            )}

            <LiveMediaStream
              mediaStream={obsConnector.mediaStream}
              speechDetectorState={speechDetectorState}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <VideoEditor
      obsConnectorState={obsConnector.state}
      initialClips={props.loaderData.clips}
      // waveformDataForClip={props.loaderData.waveformData ?? {}}
      repoId={props.loaderData.video.lesson.section.repo.id}
      lessonId={props.loaderData.video.lesson.id}
      videoPath={props.loaderData.video.path}
      lessonPath={props.loaderData.video.lesson.path}
      repoName={props.loaderData.video.lesson.section.repo.name}
      videoId={props.loaderData.video.id}
      isImporting={obsConnector.isImporting}
      liveMediaStream={obsConnector.mediaStream}
      speechDetectorState={speechDetectorState}
    />
  );
}
