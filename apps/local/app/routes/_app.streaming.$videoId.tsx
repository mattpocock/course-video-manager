import { useMemo } from "react";
import { redirect } from "react-router";
import { Effect } from "effect";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { useVideoEditorWiring } from "@/features/video-editor/use-video-editor-wiring";
import { StreamingLayout } from "@/features/streaming/streaming-layout";
import {
  loadVideoEditor,
  type VideoEditorLoaderData,
} from "@/services/video-editor-loader.server";
import { makeLoader } from "@/services/route-action.server";
import type { Route } from "./+types/_app.streaming.$videoId";

export const handle = { fullscreen: true };

export const meta: Route.MetaFunction = () => [{ title: "CVM - Streaming" }];

/**
 * The Streaming tab for one Landscape Video: the video editor's wiring
 * (`loadVideoEditor`) in the stream studio's layout. A Short is never
 * streamed: its URL goes back to the Video picker. The Video Files read is
 * awaited here rather than streamed after the page, which keeps the run in
 * `makeLoader`.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const { fsData, ...data } = yield* loadVideoEditor(params.videoId!);
      if (data.video.format !== "landscape") {
        return yield* Effect.die(redirect("/streaming"));
      }
      return { ...data, fsData: yield* fsData };
    }),
});

export default function Component(props: Route.ComponentProps) {
  return <StreamingStudio {...props} key={props.loaderData.video.id} />;
}

const StreamingStudio = (props: Route.ComponentProps) => {
  const loaderData = useMemo(
    (): VideoEditorLoaderData => ({
      ...props.loaderData,
      fsData: Promise.resolve(props.loaderData.fsData),
    }),
    [props.loaderData]
  );
  const wiring = useVideoEditorWiring(loaderData);

  return (
    <VideoEditor
      {...wiring}
      replay={false}
      layout={({ sidePanel }) => <StreamingLayout sidePanel={sidePanel} />}
    />
  );
};
