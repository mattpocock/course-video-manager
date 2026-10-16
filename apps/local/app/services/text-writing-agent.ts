import { loadOtherVideosQuizIds } from "@/services/course-quiz-ids.server";
import { buildWriterTranscript } from "@/lib/transcript-builder";
import { isImageFilePath } from "@/lib/image-file-path";
import { generateArticlePrompt } from "@/prompts/generate-article";
import { generateArticlePlanPrompt } from "@/prompts/generate-article-plan";
import { generateStepsToCompleteForProjectPrompt } from "@/prompts/generate-steps-to-complete-for-project";
import { generateStepsToCompleteForSkillBuildingProblemPrompt } from "@/prompts/generate-steps-to-complete-for-skill-building-problem";
import { refineSkillBuildingWithStyleGuidePrompt } from "@/prompts/refine-skill-building-with-style-guide";
import { refineProjectWithStyleGuidePrompt } from "@/prompts/refine-project-with-style-guide";
import { generateSeoDescriptionPrompt } from "@/prompts/generate-seo-description";
import { generateYoutubeTitlePrompt } from "@/prompts/generate-youtube-title";
import { generateYoutubeThumbnailPrompt } from "@/prompts/generate-youtube-thumbnail";
import { generateYoutubeDescriptionPrompt } from "@/prompts/generate-youtube-description";
import { generateNewsletterPrompt } from "@/prompts/generate-newsletter";
import { generateInterviewPrepPrompt } from "@/prompts/generate-interview-prep";
import { generateInterviewPrompt } from "@/prompts/generate-interview";
import { generateBrainstormingPrompt } from "@/prompts/generate-brainstorming";
import { generateScopingDiscussionPrompt } from "@/prompts/generate-scoping-discussion";
import { generateScopingDocumentPrompt } from "@/prompts/generate-scoping-document";
import type { GlobalLink } from "@/prompts/link-instructions";
import { getBeatsSection } from "@/prompts/beats-instructions";
import { getAnimaticSection } from "@/prompts/animatic-instructions";
import { getScriptSection } from "@/prompts/script-instructions";
import { CACHE_BREAKPOINT_1H } from "./prompt-cache";
import { repairToolPartsForModel } from "./writer-message-repair";
import {
  ToolLoopAgent as Agent,
  convertToModelMessages,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  buildVideoChaptersFromRows,
  toYouTubeChapters,
} from "./video-chapters";
import {
  listVideoFiles,
  readVideoFile,
  readVideoFileString,
} from "./video-files";
import type { TextWritingAgentMode } from "@/routes/videos.$videoId.completions";

export type TextWritingAgentCodeFile = {
  path: string;
  content: string;
};

export type TextWritingAgentImageFile = {
  path: string;
  content: Uint8Array<ArrayBufferLike>;
};

export const createTextWritingAgent = (props: {
  model: LanguageModel;
  mode: TextWritingAgentMode;
  transcript: string;
  code: TextWritingAgentCodeFile[];
  imageFiles: TextWritingAgentImageFile[];
  youtubeChapters?: { timestamp: string; name: string }[];
  sectionNames?: string[];
  /** Quiz ids owned by other videos in this course. */
  existingQuizIds?: string[];
  links?: GlobalLink[];
  courseStructure?: string;
  aiHeroUrl?: string;
  memory?: string;
  beats?: string;
  script?: string;
  animatic?: string;
}) => {
  const links = props.links ?? [];
  const systemPrompt = (() => {
    switch (props.mode) {
      case "project":
        return generateStepsToCompleteForProjectPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "skill-building":
        return generateStepsToCompleteForSkillBuildingProblemPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "style-guide-skill-building":
        return refineSkillBuildingWithStyleGuidePrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "style-guide-project":
        return refineProjectWithStyleGuidePrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "seo-description":
        return generateSeoDescriptionPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "youtube-title":
        return generateYoutubeTitlePrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "youtube-thumbnail":
        return generateYoutubeThumbnailPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "youtube-description":
        return generateYoutubeDescriptionPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          youtubeChapters: props.youtubeChapters || [],
          links,
        });
      case "newsletter":
        return generateNewsletterPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
          aiHeroUrl: props.aiHeroUrl,
        });
      case "interview-prep":
        return generateInterviewPrepPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "interview":
        return generateInterviewPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "brainstorming":
        return generateBrainstormingPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "scoping-discussion":
        return generateScopingDiscussionPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "scoping-document":
        return generateScopingDocumentPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "article-plan":
        return generateArticlePlanPrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          courseStructure: props.courseStructure,
          links,
        });
      case "article":
      // The document writer owns this mode; when it reaches the text writer
      // it gets the article prompt.
      case "seo-description-document":
        return generateArticlePrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          sectionNames: props.sectionNames,
          courseStructure: props.courseStructure,
          links,
          existingQuizIds: props.existingQuizIds,
        });
    }
  })();

  const memorySection = props.memory
    ? `\n\n## Course Memory\n\nThe following is course-level context provided by the author. Use it to inform your response:\n\n<memory>\n${props.memory}\n</memory>`
    : "";

  const beatsSection = getBeatsSection(props.beats ?? "");

  const scriptSection = getScriptSection(props.script ?? "");

  return new Agent({
    model: props.model,
    instructions:
      systemPrompt +
      memorySection +
      scriptSection +
      beatsSection +
      getAnimaticSection(props.animatic ?? ""),
  });
};

export const createModelMessagesForTextWritingAgent = async (props: {
  messages: UIMessage[];
  imageFiles: TextWritingAgentImageFile[];
  /**
   * Put an Anthropic cache breakpoint on the screenshots message.
   *
   * Off by default. Only the document writer holds a conversation, so only it
   * ever reads the cache back; the one-shot generation modes would pay the
   * write premium and never get a hit. A video carries up to eight
   * screenshots — roughly 13k tokens — so this earns a breakpoint wherever
   * there IS a second request.
   */
  cacheImages?: boolean;
}): Promise<ModelMessage[]> => {
  const modelMessages = await convertToModelMessages(
    repairToolPartsForModel(props.messages)
  );

  if (props.imageFiles.length > 0) {
    modelMessages.unshift({
      role: "user",
      content: props.imageFiles.flatMap((file) => {
        return [
          {
            type: "text",
            text: `The following image is at "${file.path}":`,
          },
          {
            type: "image",
            image: file.content,
          },
        ];
      }),
      ...(props.cacheImages ? { providerOptions: CACHE_BREAKPOINT_1H } : {}),
    });
  }

  return modelMessages;
};

/**
 * The Video Files a prompt is given: every file whose path is in
 * `enabledFiles` (all of them when it is `undefined`), the images as bytes and
 * the rest as text. The Article Writer and the Suggestions tab both pick files
 * with the same `FileTree` and read them here.
 */
export const readVideoFilesForPrompt = Effect.fn("readVideoFilesForPrompt")(
  function* (props: {
    lineageId: string;
    enabledFiles: readonly string[] | undefined;
  }) {
    const entries = yield* listVideoFiles(props.lineageId);

    // `enabledFiles` carries paths relative to the video's directory, so
    // nested files ("notes/snippet.md") match here rather than silently
    // falling out of the prompt.
    const filteredFiles = entries
      .map((entry) => entry.path)
      .filter(
        (filename) =>
          props.enabledFiles === undefined ||
          props.enabledFiles.includes(filename)
      );

    const allFiles = yield* Effect.forEach(filteredFiles, (filename) =>
      Effect.gen(function* () {
        if (isImageFilePath(filename)) {
          const content = yield* readVideoFile(props.lineageId, filename);
          return { type: "image" as const, path: filename, content };
        }
        const content = yield* readVideoFileString(props.lineageId, filename);
        return { type: "text" as const, path: filename, content };
      })
    );

    const textFiles: { path: string; content: string }[] = [];
    const imageFiles: TextWritingAgentImageFile[] = [];
    for (const file of allFiles) {
      if (file.type === "text") {
        textFiles.push({ path: file.path, content: file.content });
      } else {
        imageFiles.push({ path: file.path, content: file.content });
      }
    }
    return { textFiles, imageFiles };
  }
);

export const acquireTextWritingContext = Effect.fn("acquireVideoContext")(
  function* (props: {
    videoId: string;
    enabledFiles: string[] | undefined;
    includeTranscript?: boolean;
    enabledSections?: string[];
    /** Annotate each clip with the text of the diagram it pins. Off unless asked. */
    includeDiagramText?: boolean;
  }) {
    const videoOps = yield* VideoOperationsService;

    const video = yield* videoOps.getVideoWithClipsById(props.videoId);

    const lesson = video.lesson;

    const sectionPath = lesson ? lesson.section.title : undefined;
    const lessonPath = lesson ? lesson.title : undefined;

    const { textFiles, imageFiles } = yield* readVideoFilesForPrompt({
      lineageId: video.lineageId,
      enabledFiles: props.enabledFiles,
    });

    const includeTranscript = props.includeTranscript ?? true;

    const transcript = includeTranscript
      ? buildWriterTranscript({
          clips: video.clips,
          chapters: video.chapters,
          enabledSections: props.enabledSections,
          includeDiagramText: props.includeDiagramText,
        })
      : "";

    // The same chapter list the published course.json carries.
    const youtubeChapters = toYouTubeChapters(
      buildVideoChaptersFromRows(video.clips, video.chapters)
    );

    // Collect enabled section names for the prompt
    const enabledSectionIds = new Set(props.enabledSections ?? []);
    const allSectionsEnabled =
      enabledSectionIds.size === 0 ||
      (props.enabledSections?.length === 0 && video.chapters.length === 0);
    const sectionNames = allSectionsEnabled
      ? video.chapters.map((section) => section.name)
      : video.chapters
          .filter((section) => enabledSectionIds.has(section.id))
          .map((section) => section.name);

    // The ids already spoken for elsewhere in this course. The writer needs
    // them to invent a free one; without them a clash only surfaces at publish.
    const existingQuizIds = lesson
      ? yield* loadOtherVideosQuizIds({
          versionId: lesson.section.repoVersionId,
          videoId: props.videoId,
        })
      : [];

    return {
      textFiles,
      imageFiles,
      transcript,
      sectionPath,
      lessonPath,
      youtubeChapters,
      sectionNames,
      existingQuizIds,
    };
  }
);
