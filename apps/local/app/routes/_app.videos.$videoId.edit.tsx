import { useMemo } from "react";
import { VideoEditor } from "@/features/video-editor/video-editor";
import { EditorLayout } from "@/features/video-editor/components/editor-layout";
import { useVideoEditorWiring } from "@/features/video-editor/use-video-editor-wiring";
import {
  loadVideoEditor,
  type VideoEditorLoaderData,
} from "@/services/video-editor-loader.server";
import { runtimeLive } from "@/services/layer.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { useRouteLoaderData } from "react-router";
import { getBackButtonUrl } from "@/features/video-editor/video-editor-selectors";
import type { loader as parentLoader } from "./_app.videos.$videoId";
import type { Route } from "./+types/_app.videos.$videoId.edit";

export const handle = { fullscreen: true, hideParentHeader: true };

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.map(
      loadVideoEditor(params.videoId!),
      (data): VideoEditorLoaderData => ({
        ...data,
        fsData: runtimeLive.runPromise(data.fsData),
      })
    ),
});

export default function Component(props: Route.ComponentProps) {
  return <ComponentInner {...props} key={props.loaderData.video.id} />;
}

type ParentLoaderData = Awaited<ReturnType<typeof parentLoader>>;

export const ComponentInner = (props: Route.ComponentProps) => {
  const parentData = useRouteLoaderData("routes/_app.videos.$videoId") as
    ParentLoaderData | undefined;

  const navigation = useMemo(() => {
    if (!parentData) return undefined;
    const breadcrumb = parentData.isStandalone
      ? parentData.videoTitle
      : `${parentData.sectionPath}/${parentData.lessonPath}/${parentData.videoTitle}`;
    return {
      backButtonUrl: getBackButtonUrl(
        parentData.repoId,
        parentData.lessonId,
        parentData.format,
        parentData.pitchId
      ),
      breadcrumb,
      nextVideoId: parentData.nextVideoId,
      previousVideoId: parentData.previousVideoId,
      showTabSwitcher: parentData.videoFormat !== "short",
      videoId: parentData.videoId,
      lessonId: parentData.lessonId,
      hasAnimatic: parentData.clipMockupCount > 0,
    };
  }, [parentData]);

  const wiring = useVideoEditorWiring(props.loaderData);

  return (
    <VideoEditor
      {...wiring}
      layout={({ sidePanel }) => (
        <EditorLayout navigation={navigation} sidePanel={sidePanel} />
      )}
    />
  );
};
