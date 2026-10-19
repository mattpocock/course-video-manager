import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { makeAction } from "@/services/route-action.server";
import {
  acquireTextWritingContext,
  createModelMessagesForTextWritingAgent,
  createTextWritingAgent,
} from "@/services/text-writing-agent";
import { ARTICLE_WRITER_MODEL } from "@/services/article-writer-model";
import { type UIMessage } from "ai";
import { Effect, Schema } from "effect";
import { writerLanguageModel } from "@/services/fake-writer-model";
import { describeWriterStreamError } from "@/services/writer-stream-errors";

const modeSchema = Schema.Union(
  Schema.Literal("article"),
  Schema.Literal("article-plan"),
  Schema.Literal("project"),
  Schema.Literal("problem"),
  Schema.Literal("explainer"),
  Schema.Literal("solution"),
  Schema.Literal("style-guide-skill-building"),
  Schema.Literal("style-guide-project"),
  Schema.Literal("seo-description"),
  Schema.Literal("seo-description-document"),
  Schema.Literal("youtube-title"),
  Schema.Literal("youtube-thumbnail"),
  Schema.Literal("youtube-description"),
  Schema.Literal("newsletter"),
  Schema.Literal("interview-prep"),
  Schema.Literal("interview"),
  Schema.Literal("brainstorming"),
  Schema.Literal("scoping-discussion"),
  Schema.Literal("scoping-document")
);

export type TextWritingAgentMode = Schema.Schema.Type<typeof modeSchema>;

const courseStructureSchema = Schema.Struct({
  repoName: Schema.String,
  currentSectionPath: Schema.String,
  currentLessonPath: Schema.String,
  sections: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      lessons: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          description: Schema.optional(Schema.String),
        })
      ),
    })
  ),
});

const chatSchema = Schema.Struct({
  messages: Schema.Any,
  enabledFiles: Schema.Array(Schema.String),
  mode: modeSchema,
  // The Article Writer sends its selected model; with none, ARTICLE_WRITER_MODEL.
  model: Schema.optional(Schema.String),
  includeTranscript: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  enabledSections: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
  includeDiagramText: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  courseStructure: Schema.optional(courseStructureSchema),
  aiHeroUrl: Schema.optional(Schema.String),
  memory: Schema.optional(Schema.String),
  beats: Schema.optional(Schema.String),
  script: Schema.optional(Schema.String),
  animatic: Schema.optional(Schema.String),
});

export const action = makeAction({
  input: "json",
  effect: ({ params, payload: body }) => {
    const videoId = params.videoId!;

    return Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(chatSchema)(body);
      const messages: UIMessage[] = parsed.messages;
      const enabledFiles: string[] = [...parsed.enabledFiles];
      const mode = parsed.mode;
      const model: string =
        parsed.model === undefined
          ? ARTICLE_WRITER_MODEL
          : parsed.model === "auto"
            ? "claude-haiku-4-5"
            : parsed.model;
      const includeTranscript = parsed.includeTranscript;
      const enabledSections: string[] = [...parsed.enabledSections];

      const videoContext = yield* acquireTextWritingContext({
        videoId,
        enabledFiles,
        includeTranscript,
        enabledSections,
        includeDiagramText: parsed.includeDiagramText,
      });

      // Fetch global links for injection into prompts
      const linkAuthOps = yield* LinkAuthOperationsService;
      const links = yield* linkAuthOps.getLinks();

      // Format course structure as indented text tree
      let courseStructureText: string | undefined;
      if (parsed.courseStructure) {
        const cs = parsed.courseStructure;
        const lines: string[] = [`Course: ${cs.repoName}`];
        for (const section of cs.sections) {
          const isCurrent = section.path === cs.currentSectionPath;
          lines.push(
            `  ${section.path}/${isCurrent ? "  <-- current section" : ""}`
          );
          for (const lesson of section.lessons) {
            const isCurrentLesson =
              isCurrent && lesson.path === cs.currentLessonPath;
            const marker = isCurrentLesson ? "  <-- current lesson" : "";
            const desc = lesson.description ? ` - ${lesson.description}` : "";
            lines.push(`    ${lesson.path}/${marker}${desc}`);
          }
        }
        courseStructureText = lines.join("\n");
      }

      const modelMessages = yield* Effect.tryPromise(() =>
        createModelMessagesForTextWritingAgent({
          messages,
          imageFiles: videoContext.imageFiles,
        })
      );

      const agent = createTextWritingAgent({
        model: writerLanguageModel(model),
        mode: mode,
        transcript: videoContext.transcript,
        code: videoContext.textFiles,
        imageFiles: videoContext.imageFiles,
        youtubeChapters: videoContext.youtubeChapters,
        sectionNames: videoContext.sectionNames,
        existingQuizIds: videoContext.existingQuizIds,
        links,
        courseStructure: courseStructureText,
        aiHeroUrl: parsed.aiHeroUrl,
        memory: parsed.memory,
        beats: parsed.beats,
        script: parsed.script,
        animatic: parsed.animatic,
      });

      const result = yield* Effect.tryPromise(() =>
        agent.stream({ messages: modelMessages })
      );

      return result.toUIMessageStreamResponse({
        onError: describeWriterStreamError,
      });
    });
  },
});
