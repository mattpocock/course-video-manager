import type {
  EffectEntity,
  EffectReducer,
  EffectReducerExec,
} from "use-effect-reducer";
import type { CourseStructure } from "@/components/video-context-panel";
import type { YouTubeUploadEntry } from "@/features/upload-manager/upload-entry";
import { findYouTubeMetadataProblem } from "@/lib/youtube-metadata";
import {
  findConvertibleAiHeroUrls,
  hasAiHeroUrls,
  replaceUrls,
} from "./convert-short-links";
import {
  createInitialGeneratedFieldState,
  generatedFieldReducer,
} from "./generated-field-reducer";
import type { CreatedShortLink, GenerateTextRequest } from "./posting-requests";

/**
 * The post page: a Video's YouTube title and description (generated, copied
 * from the Pitch, or typed), its visibility and Thumbnail, the press that
 * checks for an Exported Video and starts the YouTube upload Job, and turning
 * aihero.dev links into short links. The title and description are the
 * Video's YouTube Draft: kept here, and saved to the Video a moment after each
 * edit. See docs/FRONTEND_STATE.md.
 */
export namespace postPageReducer {
  export type Field = "title" | "description";
  export type PrivacyStatus = "public" | "unlisted";

  /** Everything the upload Job needs, fixed when Post was pressed. */
  export type Upload = {
    videoId: string;
    title: string;
    description: string;
    privacyStatus: PrivacyStatus;
    thumbnailId: string;
  };

  export interface State {
    videoId: string;
    title: string;
    description: string;
    /** The YouTube Draft as the Video last saved it. */
    saved: { title: string; description: string };
    /** The save waiting out its delay, so the next edit replaces it. */
    draftSave: EffectEntity<State, Action> | null;
    /** Why the last save failed; cleared by the next one that succeeds. */
    draftSaveError: string | null;
    fields: generatedFieldReducer.State<Field>;
    privacyStatus: PrivacyStatus;
    selectedThumbnailId: string | null;
    /** Post was pressed; the page is asking whether the Exported Video exists. */
    checkingExport: Upload | null;
    /** The description the short links are being made for. */
    convertingShortLinks: { description: string } | null;
    /** The YouTube id this Video was last uploaded as, kept in this browser. */
    storedYoutubeVideoId: string;
  }

  export type Action =
    | generatedFieldReducer.Action<Field, GenerateTextRequest>
    | { type: "title-edited"; title: string }
    | { type: "description-edited"; description: string }
    | { type: "youtube-draft-saved"; title: string; description: string }
    | { type: "youtube-draft-save-failed"; message: string }
    | { type: "youtube-draft-retry-clicked" }
    | { type: "copy-from-pitch-clicked"; pitchTitle: string }
    | { type: "video-opened"; videoId: string }
    | { type: "stored-youtube-video-id-read"; youtubeVideoId: string | null }
    /** This Video's YouTube upload Job succeeded, as the jobs list reports. */
    | {
        type: "youtube-upload-succeeded";
        videoId: string;
        youtubeVideoId: string;
      }
    | { type: "privacy-status-selected"; privacyStatus: PrivacyStatus }
    | { type: "thumbnail-selected"; thumbnailId: string | null }
    | { type: "thumbnail-delete-clicked"; thumbnailId: string }
    | { type: "post-clicked" }
    | { type: "export-checked"; exists: boolean }
    | { type: "export-check-failed" }
    | { type: "convert-short-links-clicked" }
    | { type: "short-links-created"; links: CreatedShortLink[] }
    | { type: "short-links-failed"; message: string }
    | { type: "disconnect-clicked" };

  export type Effect =
    // An applied text lands in this state instead (`applyFieldText`).
    | Exclude<
        generatedFieldReducer.Effect<Field, GenerateTextRequest>,
        { type: "apply-field-text" }
      >
    /** Wait `delayMs`, then save the YouTube Draft. Replaced by the next edit. */
    | {
        type: "save-youtube-draft";
        videoId: string;
        title: string;
        description: string;
        delayMs: number;
      }
    | { type: "read-stored-youtube-video-id"; videoId: string }
    | {
        type: "store-youtube-video-id";
        videoId: string;
        youtubeVideoId: string;
      }
    | { type: "delete-thumbnail"; thumbnailId: string }
    | { type: "check-export"; videoId: string }
    /** `exportFirst`: queue an export Job and start the upload behind it. */
    | (Upload & { type: "start-youtube-upload"; exportFirst: boolean })
    | { type: "create-short-links"; urls: string[]; linkDescription: string }
    | { type: "show-toast"; title: string; description: string }
    | { type: "show-error"; title: string; description?: string }
    | { type: "disconnect-youtube" };
}

/** How long typing pauses before the YouTube Draft is saved. */
export const YOUTUBE_DRAFT_SAVE_DELAY_MS = 500;

export const createInitialPostPageState = (opts: {
  videoId: string;
  selectedThumbnailId: string | null;
  /** The YouTube Draft the page opens with. */
  title: string;
  description: string;
}): postPageReducer.State => ({
  videoId: opts.videoId,
  title: opts.title,
  description: opts.description,
  saved: { title: opts.title, description: opts.description },
  draftSave: null,
  draftSaveError: null,
  fields: createInitialGeneratedFieldState(),
  privacyStatus: "unlisted",
  selectedThumbnailId: opts.selectedThumbnailId,
  checkingExport: null,
  convertingShortLinks: null,
  storedYoutubeVideoId: "",
});

/** What the page knows about the writing context when Generate is pressed. */
export interface PostGenerationContext {
  videoId: string;
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  includeTranscript: boolean;
  hasChapters: boolean;
  courseStructure: CourseStructure | null;
  includeCourseStructure: boolean;
}

/**
 * The generation request for one field. With chapters, the transcript goes
 * with the request when any chapter is ticked; without, when the whole
 * transcript is.
 */
export const selectGenerateRequest = (
  field: postPageReducer.Field,
  context: PostGenerationContext
): GenerateTextRequest => ({
  videoId: context.videoId,
  mode: field === "title" ? "youtube-title-single" : "youtube-description",
  enabledFiles: Array.from(context.enabledFiles),
  includeTranscript: context.hasChapters
    ? context.enabledSections.size > 0
    : context.includeTranscript,
  enabledSections: Array.from(context.enabledSections),
  courseStructure:
    context.includeCourseStructure && context.courseStructure
      ? context.courseStructure
      : undefined,
});

/**
 * What YouTube would refuse, named, so the upload is never queued with it.
 * A blank title is not reported: the button is already off for it.
 */
export const selectMetadataProblem = (title: string, description: string) =>
  title.trim() ? findYouTubeMetadataProblem({ title, description }) : null;

/** Post can be pressed: both fields filled, a Thumbnail picked, nothing YouTube would refuse. */
export const selectCanPost = (state: postPageReducer.State) =>
  !!state.title.trim() &&
  !!state.description.trim() &&
  !!state.selectedThumbnailId &&
  !selectMetadataProblem(state.title, state.description);

/** Whether the Video has the YouTube Draft the page shows. */
export const selectYoutubeDraftStatus = (
  state: postPageReducer.State
): "saved" | "saving" | "failed" => {
  if (state.draftSaveError !== null) return "failed";
  return state.title === state.saved.title &&
    state.description === state.saved.description
    ? "saved"
    : "saving";
};

/** The YouTube Draft the Video does not have yet, or null when it has it. */
export const selectUnsavedYoutubeDraft = (state: postPageReducer.State) =>
  state.title === state.saved.title &&
  state.description === state.saved.description
    ? null
    : {
        videoId: state.videoId,
        title: state.title,
        description: state.description,
      };

/**
 * How the upload reads on the page: from this Video's upload Job while there
 * is one, else from the YouTube id this browser remembers.
 */
export const selectUploadDisplay = (
  state: postPageReducer.State,
  upload:
    | Pick<
        YouTubeUploadEntry,
        "status" | "progress" | "errorMessage" | "youtubeVideoId"
      >
    | undefined
): {
  status: "idle" | "uploading" | "success" | "error";
  progress: number;
  error: string;
  youtubeVideoId: string;
} => ({
  status: upload
    ? upload.status === "retrying" || upload.status === "waiting"
      ? "uploading"
      : upload.status
    : state.storedYoutubeVideoId
      ? "success"
      : "idle",
  progress: upload?.progress ?? 0,
  error: upload?.errorMessage ?? "",
  youtubeVideoId: upload?.youtubeVideoId ?? state.storedYoutubeVideoId,
});

type State = postPageReducer.State;
type Exec = EffectReducerExec<
  postPageReducer.State,
  postPageReducer.Action,
  postPageReducer.Effect
>;

/** A new YouTube Draft: shown at once, saved once `delayMs` passes without another. */
const draftChanged = (
  state: State,
  draft: { title: string; description: string },
  exec: Exec,
  delayMs = YOUTUBE_DRAFT_SAVE_DELAY_MS
): State => ({
  ...state,
  ...draft,
  draftSave: exec.replace(state.draftSave ?? undefined, {
    type: "save-youtube-draft",
    videoId: state.videoId,
    ...draft,
    delayMs,
  }),
});

/** A generated, copied or converted text lands in its field, and is saved. */
const applyFieldText = (
  state: State,
  field: postPageReducer.Field,
  text: string,
  exec: Exec
): State =>
  draftChanged(
    state,
    {
      title: field === "title" ? text : state.title,
      description: field === "description" ? text : state.description,
    },
    exec
  );

const fieldAction = (
  state: State,
  action: generatedFieldReducer.Action<
    postPageReducer.Field,
    GenerateTextRequest
  >,
  exec: Exec
): State => {
  const applied: Array<{ field: postPageReducer.Field; text: string }> = [];
  const fields = generatedFieldReducer(state.fields, action, (effect) => {
    if (effect.type === "apply-field-text") applied.push(effect);
    else exec(effect);
  });
  return applied.reduce(
    (next, { field, text }) => applyFieldText(next, field, text, exec),
    fields === state.fields ? state : { ...state, fields }
  );
};

const postClicked = (state: State, exec: Exec): State => {
  const thumbnailId = state.selectedThumbnailId;
  if (state.checkingExport || !thumbnailId) return state;
  if (!selectCanPost(state)) return state;
  const upload: postPageReducer.Upload = {
    videoId: state.videoId,
    title: state.title,
    description: state.description,
    privacyStatus: state.privacyStatus,
    thumbnailId,
  };
  exec({ type: "check-export", videoId: state.videoId });
  return { ...state, checkingExport: upload };
};

const convertShortLinksClicked = (state: State, exec: Exec): State => {
  if (state.convertingShortLinks) return state;
  if (!hasAiHeroUrls(state.description)) {
    exec({
      type: "show-toast",
      title: "No aihero.dev links found",
      description: "The description doesn't contain any aihero.dev URLs.",
    });
    return state;
  }
  const urls = findConvertibleAiHeroUrls(state.description);
  if (urls.length === 0) {
    exec({
      type: "show-toast",
      title: "All links already converted",
      description: "All aihero.dev links are already short links.",
    });
    return state;
  }
  exec({
    type: "create-short-links",
    urls,
    linkDescription: `YouTube (${state.title || "Untitled"})`,
  });
  return {
    ...state,
    convertingShortLinks: { description: state.description },
  };
};

const shortLinksCreated = (
  state: State,
  action: Extract<postPageReducer.Action, { type: "short-links-created" }>,
  exec: Exec
): State => {
  const converting = state.convertingShortLinks;
  if (!converting) return state;
  const count = action.links.length;
  const description = replaceUrls(
    converting.description,
    new Map(action.links.map((link) => [link.url, link.shortLinkUrl]))
  );
  exec({
    type: "show-toast",
    title: "Links converted",
    description: `Converted ${count} aihero.dev URL${count > 1 ? "s" : ""} to short links.`,
  });
  return applyFieldText(
    { ...state, convertingShortLinks: null },
    "description",
    description,
    exec
  );
};

export const postPageReducer: EffectReducer<
  postPageReducer.State,
  postPageReducer.Action,
  postPageReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "generate-clicked":
    case "text-generated":
    case "text-generation-failed":
    case "text-offered":
    case "overwrite-confirmed":
    case "overwrite-cancelled":
      return fieldAction(state, action, exec);
    case "copy-from-pitch-clicked":
      return fieldAction(
        state,
        {
          type: "text-offered",
          field: "title",
          currentText: state.title,
          text: action.pitchTitle,
        },
        exec
      );
    case "title-edited":
      return draftChanged(
        state,
        { title: action.title, description: state.description },
        exec
      );
    case "description-edited":
      return draftChanged(
        state,
        { title: state.title, description: action.description },
        exec
      );
    case "youtube-draft-saved":
      return {
        ...state,
        saved: { title: action.title, description: action.description },
        draftSaveError: null,
      };
    case "youtube-draft-save-failed":
      return { ...state, draftSaveError: action.message };
    case "youtube-draft-retry-clicked":
      return draftChanged(
        state,
        { title: state.title, description: state.description },
        exec,
        0
      );
    case "video-opened":
      exec({ type: "read-stored-youtube-video-id", videoId: action.videoId });
      return state;
    case "stored-youtube-video-id-read":
      // Nothing stored keeps what the page already shows.
      if (!action.youtubeVideoId) return state;
      return { ...state, storedYoutubeVideoId: action.youtubeVideoId };
    case "youtube-upload-succeeded":
      exec({
        type: "store-youtube-video-id",
        videoId: action.videoId,
        youtubeVideoId: action.youtubeVideoId,
      });
      return { ...state, storedYoutubeVideoId: action.youtubeVideoId };
    case "privacy-status-selected":
      return { ...state, privacyStatus: action.privacyStatus };
    case "thumbnail-selected":
      return { ...state, selectedThumbnailId: action.thumbnailId };
    case "thumbnail-delete-clicked":
      // The Thumbnail menu has already asked (useThumbnailMenu).
      exec({ type: "delete-thumbnail", thumbnailId: action.thumbnailId });
      if (action.thumbnailId !== state.selectedThumbnailId) return state;
      return { ...state, selectedThumbnailId: null };
    case "post-clicked":
      return postClicked(state, exec);
    case "export-checked": {
      const upload = state.checkingExport;
      if (!upload) return state;
      exec({
        type: "start-youtube-upload",
        ...upload,
        exportFirst: !action.exists,
      });
      exec(
        action.exists
          ? {
              type: "show-toast",
              title: "Upload started",
              description: `"${upload.title}" is uploading to YouTube`,
            }
          : {
              type: "show-toast",
              title: "Export + upload started",
              description: `"${upload.title}" will export first, then upload to YouTube`,
            }
      );
      return { ...state, checkingExport: null };
    }
    case "export-check-failed":
      if (!state.checkingExport) return state;
      exec({ type: "show-error", title: "Failed to check export status" });
      return { ...state, checkingExport: null };
    case "convert-short-links-clicked":
      return convertShortLinksClicked(state, exec);
    case "short-links-created":
      return shortLinksCreated(state, action, exec);
    case "short-links-failed":
      if (!state.convertingShortLinks) return state;
      exec({
        type: "show-error",
        title: "Failed to convert links",
        description: action.message,
      });
      return { ...state, convertingShortLinks: null };
    case "disconnect-clicked":
      exec({ type: "disconnect-youtube" });
      return state;
  }
};
