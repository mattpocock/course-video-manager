import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import type { VideoMenuActions } from "@/features/video-menu/video-menu";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useNavigate } from "react-router";
import { toast } from "@/components/ui/toast";
import {
  resolveForVideo,
  type ResolverTimelineItem,
} from "@/lib/diagram-action-resolver";
import { fetchMeta } from "@/features/diagrams/use-diagram-snapshot-scene";
import {
  openPlayground,
  openPlaygroundWithDiagram,
} from "@/lib/diagram-window";
import { teleprompterChannel } from "@/lib/teleprompter-protocol";
import type {
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer";
import { useContextSelector } from "use-context-selector";
import { useRetranscribeAllClips } from "./components/transcript-word-actions";
import { VideoEditorContext } from "./video-editor-context";
import { editorVideoMenuGroups } from "./editor-menu";
import { useNewShortAction } from "./new-short-action";

type GroupsRef = { current: ActionMenuGroups | null };

const EditorVideoMenuContext = createContext<GroupsRef | null>(null);

/**
 * Carries the editor's Video menu from the player panel, which builds it (its
 * handlers close over the panel's own modals and fetchers), to the compact
 * header's breadcrumb, which is the menu's second door (CODING_STANDARDS.md,
 * "Action menus", rule 1). A ref, not state: the groups are rebuilt on every
 * render, and the breadcrumb only needs the latest as its menu opens.
 */
export function EditorVideoMenuProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ActionMenuGroups | null>(null);
  return (
    <EditorVideoMenuContext.Provider value={ref}>
      {children}
    </EditorVideoMenuContext.Provider>
  );
}

/** Called by the panel that owns the Actions dropdown, with the groups it renders. */
export function usePublishEditorVideoMenu(groups: ActionMenuGroups) {
  const ref = useContext(EditorVideoMenuContext);
  useLayoutEffect(() => {
    if (ref) ref.current = groups;
  });
}

/** The groups the Actions dropdown last rendered. Read it as the menu opens. */
export function useEditorVideoMenuRef(): GroupsRef | null {
  return useContext(EditorVideoMenuContext);
}

/**
 * The Actions menu of whichever editor is open — the landscape editor or the
 * Short's portrait studio — from the one action set below. `panelActions` are
 * the few whose dialogs the panel itself owns. The Video Format alone decides
 * what is left out (`editor-menu.ts`).
 */
export function useEditorVideoMenu(panelActions: VideoMenuActions): {
  groups: ActionMenuGroups;
  launch: { teleprompter: () => void; diagramPlayground: () => void };
} {
  const videoFormat = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoFormat
  );
  const { menu, launch } = useEditorVideoActions();
  return {
    groups: editorVideoMenuGroups(videoFormat, { ...menu, ...panelActions }),
    launch,
  };
}

/**
 * The Video actions both editors offer — the landscape editor and the
 * portrait Studio — wired to the editor's context. `menu` is the action set
 * `useEditorVideoMenu` renders; `launch` is the two popup openers on
 * their own, for the landscape editor's launcher buttons.
 */
function useEditorVideoActions(): {
  menu: VideoMenuActions;
  launch: { teleprompter: () => void; diagramPlayground: () => void };
} {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  const allClipsHaveText = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveText
  );
  const copyTranscriptToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyTranscriptToClipboard
  );
  const youtubeChapters = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.youtubeChapters
  );
  const copyYoutubeChaptersToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyYoutubeChaptersToClipboard
  );
  const modalDispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.modalDispatch
  );
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const lessonId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.lessonId
  );
  const referenceCandidates = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.referenceCandidates
  );
  const referenceVideoId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.referenceVideoId
  );
  const setReferenceVideoId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setReferenceVideoId
  );
  const onOpenAutofillChaptersModal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onOpenAutofillChaptersModal
  );
  const silenceLength = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.silenceLength
  );
  const setSilenceLength = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setSilenceLength
  );
  const isRecordingActive = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isRecordingActive
  );
  const { startExportUpload, startRenderVerticalUpload } = useUploadActions();
  const openInVSCodeFetcher = useFetcher();
  const navigate = useNavigate();
  const newShort = useNewShortAction();
  const retranscribeAllClips = useRetranscribeAllClips();
  const revealVideoFetcher = useFetcher();

  // Reveal in File System only applies once there is an exported file.
  const [exportFileExists, setExportFileExists] = useState(false);
  useEffect(() => {
    fetch(`/api/videos/${videoId}/export-file-exists`)
      .then((res) => res.json())
      .then((data: { exists: boolean }) => setExportFileExists(data.exists))
      .catch(() => setExportFileExists(false));
  }, [videoId]);

  const isReferenceOpen =
    referenceVideoId !== null &&
    referenceCandidates.some((c) => c.id === referenceVideoId);

  const launch = {
    teleprompter: () => void teleprompterChannel.open(),
    diagramPlayground: () =>
      void openDiagramPlaygroundAt(items, insertionPoint),
  };
  const menu: VideoMenuActions = {
    openTeleprompter: launch.teleprompter,
    openDiagramPlayground: launch.diagramPlayground,
    rename: () => modalDispatch({ type: "rename-video-clicked" }),
    duplicate: () => modalDispatch({ type: "copy-video-clicked" }),
    export: () => startExportUpload(videoId, videoTitle),
    copyTranscript: {
      onSelect: () =>
        void copyTranscriptToClipboard().then(() =>
          toast("Transcript copied to clipboard")
        ),
      disabled: !allClipsHaveText,
      description: allClipsHaveText
        ? undefined
        : "Waiting for transcription to complete",
    },
    revealInFileSystem: exportFileExists
      ? () =>
          revealVideoFetcher.submit(
            {},
            { method: "post", action: `/api/videos/${videoId}/reveal` }
          )
      : undefined,
    renderVerticalShort: () => startRenderVerticalUpload(videoId, videoTitle),
    retranscribeAllClips,
    copyYouTubeChapters:
      youtubeChapters.length > 0
        ? () =>
            void copyYoutubeChaptersToClipboard().then(() =>
              toast("YouTube chapters copied to clipboard")
            )
        : undefined,
    copyLogPath: () => void copyLogPath(videoId),
    openInVSCode: () =>
      openInVSCodeFetcher.submit(
        {},
        { method: "post", action: `/api/videos/${videoId}/open-in-vscode` }
      ),
    createConcatenatedVideo: () =>
      navigate(`/videos/concatenate?initial=${videoId}`),
    reference: isReferenceOpen
      ? { close: () => setReferenceVideoId(null) }
      : { candidates: referenceCandidates, open: setReferenceVideoId },
    newShort,
    autofillChapters: {
      onSelect: onOpenAutofillChaptersModal,
      disabled: !allClipsHaveText,
      description: allClipsHaveText
        ? undefined
        : "Waiting for transcription to complete",
    },
    addNote: () => modalDispatch({ type: "add-note-from-clipboard-clicked" }),
    addVideoToLesson: lessonId
      ? () => modalDispatch({ type: "add-video-to-lesson-clicked" })
      : undefined,
    silenceLength: {
      value: silenceLength,
      onValueChange: setSilenceLength,
      disabled: isRecordingActive,
    },
  };
  return { menu, launch };
}

/**
 * Opens the Diagram Playground on the Diagram the timeline shows at the
 * insertion point, or empty when there is none.
 */
async function openDiagramPlaygroundAt(
  items: TimelineItem[],
  insertionPoint: FrontendInsertionPoint
) {
  const resolverItems: ResolverTimelineItem[] = items.map((item) => {
    if (item.type === "on-database" || item.type === "optimistically-added") {
      return {
        frontendId: item.frontendId as string,
        kind: "clip" as const,
        diagramSnapshotId:
          item.type === "on-database" ? (item.diagramSnapshotId ?? null) : null,
      };
    }
    return {
      frontendId: item.frontendId as string,
      kind: "chapter" as const,
      diagramSnapshotId: null,
    };
  });

  const snapshotIds = new Set(
    resolverItems
      .filter((i) => i.diagramSnapshotId)
      .map((i) => i.diagramSnapshotId!)
  );
  const snapshotMap = new Map<string, string>();
  await Promise.all(
    [...snapshotIds].map(async (sid) => {
      const meta = await fetchMeta(sid);
      if (meta.diagramId) snapshotMap.set(sid, meta.diagramId);
    })
  );

  const result = resolveForVideo(
    resolverItems,
    insertionPoint,
    (sid) => snapshotMap.get(sid) ?? null
  );
  if (result.kind === "diagram") {
    openPlaygroundWithDiagram(result.diagramId);
  } else {
    openPlayground();
  }
}

async function copyLogPath(videoId: string) {
  try {
    const res = await fetch(`/api/videos/${videoId}/log-path`);
    await navigator.clipboard.writeText(await res.text());
    toast("Log path copied to clipboard");
  } catch {
    toast.error("Failed to copy log path to clipboard");
  }
}
