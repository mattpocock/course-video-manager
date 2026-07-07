import { sortByOrder } from "@/lib/sort-by-order";
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
import {
  ToolLoopAgent as Agent,
  convertToModelMessages,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { Array, Effect } from "effect";
import { VideoOperationsService } from "./db-video-operations.server";
import { FileSystem } from "@effect/platform";
import { calculateYouTubeChapters, type YouTubeChaptersItem } from "./utils";
import { getVideoFilePath } from "./video-files";
import type { TextWritingAgentMode } from "@/routes/videos.$videoId.completions";

const NOT_A_FILE = Symbol("NOT_A_FILE");

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
  links?: GlobalLink[];
  courseStructure?: string;
  aiHeroUrl?: string;
  memory?: string;
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
      default:
        return generateArticlePrompt({
          code: props.code,
          transcript: props.transcript,
          images: props.imageFiles.map((file) => file.path),
          sectionNames: props.sectionNames,
          courseStructure: props.courseStructure,
          links,
        });
    }
  })();

  const memorySection = props.memory
    ? `\n\n## Course Memory\n\nThe following is course-level context provided by the author. Use it to inform your response:\n\n<memory>\n${props.memory}\n</memory>`
    : "";

  return new Agent({
    model: props.model,
    instructions: systemPrompt + memorySection,
  });
};

export const createModelMessagesForTextWritingAgent = async (props: {
  messages: UIMessage[];
  imageFiles: TextWritingAgentImageFile[];
}): Promise<ModelMessage[]> => {
  const modelMessages = await convertToModelMessages(props.messages);

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
    });
  }

  return modelMessages;
};

export const DEFAULT_CHECKED_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "mdx",
  "txt",
  "csv",
];

export const ALWAYS_EXCLUDED_DIRECTORIES = ["node_modules", ".vite"];

export const DEFAULT_UNCHECKED_PATHS = ["readme.md", "speaker-notes.md"];

export const acquireTextWritingContext = Effect.fn("acquireVideoContext")(
  function* (props: {
    videoId: string;
    enabledFiles: string[] | undefined;
    includeTranscript?: boolean;
    enabledSections?: string[];
  }) {
    const videoOps = yield* VideoOperationsService;
    const fs = yield* FileSystem.FileSystem;

    const video = yield* videoOps.getVideoWithClipsById(props.videoId);

    const lesson = video.lesson;

    // Initialize file arrays
    let textFiles: { path: string; content: string }[] = [];
    let imageFiles: { path: string; content: Uint8Array<ArrayBufferLike> }[] =
      [];
    const sectionPath = lesson ? lesson.section.title : undefined;
    const lessonPath = lesson ? lesson.title : undefined;

    const videoDir = getVideoFilePath(video.lineageId);
    const dirExists = yield* fs.exists(videoDir);

    if (dirExists) {
      const filesInDirectory = yield* fs.readDirectory(videoDir);

      const filteredFiles = filesInDirectory.filter((filename) => {
        return (
          props.enabledFiles === undefined ||
          props.enabledFiles.includes(filename)
        );
      });

      const allFiles = yield* Effect.forEach(filteredFiles, (filename) => {
        return Effect.gen(function* () {
          const filePath = getVideoFilePath(video.lineageId, filename);
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return NOT_A_FILE;
          }

          const imageExtensions = [
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".svg",
            ".webp",
            ".bmp",
          ];
          const isImage = imageExtensions.some((ext) =>
            filename.toLowerCase().endsWith(ext)
          );

          if (isImage) {
            const fileContent = yield* fs.readFile(filePath);
            return {
              type: "image" as const,
              path: filename,
              content: fileContent,
            };
          } else {
            const fileContent = yield* fs.readFileString(filePath);
            return {
              type: "text" as const,
              filePath: filename,
              fileContent,
            };
          }
        });
      }).pipe(Effect.map(Array.filter((r) => r !== NOT_A_FILE)));

      textFiles = allFiles
        .filter((f) => f.type === "text")
        .map((f) => ({
          path: f.filePath,
          content: f.fileContent,
        }));

      imageFiles = allFiles
        .filter((f) => f.type === "image")
        .map((f) => ({
          path: f.path,
          content: f.content,
        }));
    }

    const includeTranscript = props.includeTranscript ?? true;

    // Build transcript with section filtering
    let transcript = "";
    if (includeTranscript) {
      const enabledSectionIds = new Set(props.enabledSections ?? []);
      const allSectionsEnabled =
        enabledSectionIds.size === 0 ||
        (props.enabledSections?.length === 0 && video.chapters.length === 0);

      // Combine clips and chapters, sort by order (ASCII ordering to match PostgreSQL COLLATE "C")
      const allItems = [
        ...video.clips.map((clip) => ({
          type: "clip" as const,
          order: clip.order,
          clip,
        })),
        ...video.chapters.map((section) => ({
          type: "chapter" as const,
          order: section.order,
          section,
        })),
      ];

      const sortedAllItems = sortByOrder(allItems);

      // Build formatted transcript with sections as H2 headers
      // Annotate clips with sequential 1-based indices for AI screenshot placement
      const transcriptParts: string[] = [];
      let currentParagraph: string[] = [];
      let currentSectionEnabled = allSectionsEnabled; // If no sections exist, include clips before first section
      let clipIndex = 0;

      for (const item of sortedAllItems) {
        if (item.type === "chapter") {
          // Flush current paragraph before starting a new section
          if (currentParagraph.length > 0 && currentSectionEnabled) {
            transcriptParts.push(currentParagraph.join(" "));
            currentParagraph = [];
          } else {
            currentParagraph = [];
          }

          // Check if this section is enabled
          currentSectionEnabled =
            allSectionsEnabled || enabledSectionIds.has(item.section.id);
        } else {
          clipIndex++;
          if (item.clip.text && currentSectionEnabled) {
            currentParagraph.push(`[${clipIndex}] ${item.clip.text}`);
          }
        }
      }

      // Flush remaining paragraph
      if (currentParagraph.length > 0 && currentSectionEnabled) {
        transcriptParts.push(currentParagraph.join(" "));
      }

      transcript = transcriptParts.join("\n\n").trim();
    }

    // Calculate YouTube chapters from chapters
    // Combine clips and chapters, sort by order (ASCII ordering to match PostgreSQL COLLATE "C")
    const chaptersAllItems = [
      ...video.clips.map((clip) => ({
        type: "clip" as const,
        order: clip.order,
        clip,
      })),
      ...video.chapters.map((section) => ({
        type: "chapter" as const,
        order: section.order,
        section,
      })),
    ];

    const sortedChaptersItems = sortByOrder(chaptersAllItems);

    const chaptersInput: YouTubeChaptersItem[] = sortedChaptersItems.map(
      (item): YouTubeChaptersItem => {
        if (item.type === "chapter") {
          return { type: "section", name: item.section.name };
        } else {
          return {
            type: "clip",
            durationSeconds:
              item.clip.sourceEndTime - item.clip.sourceStartTime,
          };
        }
      }
    );

    const youtubeChapters = calculateYouTubeChapters(chaptersInput);

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

    return {
      textFiles,
      imageFiles,
      transcript,
      sectionPath,
      lessonPath,
      youtubeChapters,
      sectionNames,
    };
  }
);
