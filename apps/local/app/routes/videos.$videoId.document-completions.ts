import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { makeAction } from "@/services/route-action.server";
import {
  acquireTextWritingContext,
  createModelMessagesForTextWritingAgent,
} from "@/services/text-writing-agent";
import {
  createDocumentWritingAgent,
  formatRelatedFields,
} from "@/services/document-writing-agent";
import { CACHE_BREAKPOINT_5M } from "@/services/prompt-cache";
import { resolveArticleWriterModel } from "@/services/article-writer-model";
import type { DocumentWritingAgentMode } from "@/services/document-writing-agent";
import { type LanguageModelUsage, type ModelMessage, type UIMessage } from "ai";
import { Data, Effect, Schema } from "effect";
import { writerLanguageModel } from "@/services/fake-writer-model";
import { describeWriterStreamError } from "@/services/writer-stream-errors";
import type { WriterCacheStats } from "@/features/article-writer/types";

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

const documentModeSchema = Schema.Union(
  Schema.Literal("article"),
  Schema.Literal("problem"),
  Schema.Literal("explainer"),
  Schema.Literal("solution"),
  Schema.Literal("newsletter"),
  Schema.Literal("seo-description-document")
);

const chatSchema = Schema.Struct({
  messages: Schema.Any,
  enabledFiles: Schema.Array(Schema.String),
  mode: Schema.optionalWith(documentModeSchema, {
    default: () => "article" as const,
  }),
  document: Schema.optional(Schema.String),
  // The writer's model selector; anything not on offer runs the default.
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
  memory: Schema.optional(Schema.String),
  pageFields: Schema.optionalWith(
    Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
    { default: () => [] }
  ),
  beats: Schema.optional(Schema.String),
  script: Schema.optional(Schema.String),
  animatic: Schema.optional(Schema.String),
});

/** The model call that starts the Document Writer's stream rejected. */
class WriterStreamError extends Data.TaggedError("WriterStreamError")<{
  cause: unknown;
}> {}

export const action = makeAction({
  input: "json",
  effect: ({ params, payload: body }) => {
    const videoId = params.videoId!;

    return Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(chatSchema)(body);
      const messages: UIMessage[] = parsed.messages;
      const enabledFiles: string[] = [...parsed.enabledFiles];
      const includeTranscript = parsed.includeTranscript;
      const enabledSections: string[] = [...parsed.enabledSections];

      const videoContext = yield* acquireTextWritingContext({
        videoId,
        enabledFiles,
        includeTranscript,
        enabledSections,
        includeDiagramText: parsed.includeDiagramText,
      });

      const linkAuthOps = yield* LinkAuthOperationsService;
      const links = yield* linkAuthOps.getLinks();

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
          cacheImages: true,
        })
      );

      // The prompt is laid out stable-first so that each cache breakpoint only
      // ever covers content that outlives it:
      //
      //   system prompt        <- 1h breakpoint (in the agent)
      //   screenshots          <- 1h breakpoint (in the message builder)
      //   related page fields  <- no breakpoint; churns
      //   conversation         <- two 5m breakpoints, on the last two messages
      //   <current-document>   <- never cached; differs on every request
      //
      // Anything below a breakpoint can change freely without costing the
      // entries above it.
      const conversationStart = videoContext.imageFiles.length > 0 ? 1 : 0;
      const conversation = modelMessages.slice(conversationStart);

      // Two breakpoints, not one. Within a single user message the client
      // applies the edit and re-submits, so the conversation grows mid-turn;
      // marking the last two messages lets each request read the previous one's
      // write instead of leaning on Anthropic's 20-block lookback, which a
      // screenshots message of up to 16 blocks makes far too tight to trust.
      for (const message of conversation.slice(-2)) {
        message.providerOptions = CACHE_BREAKPOINT_5M;
      }

      // Sent as a message rather than folded into the system prompt. In the SEO
      // writer this field is the entire lesson body, which changes on every
      // keystroke in the other pane — in the system prompt it would invalidate
      // the transcript and screenshots along with itself.
      const relatedFields = formatRelatedFields(parsed.pageFields);
      if (relatedFields) {
        modelMessages.splice(conversationStart, 0, {
          role: "user",
          content: relatedFields,
        } satisfies ModelMessage);
      }

      // Always last, and never a breakpoint: the document changes on every
      // single request, including between the two requests of one user message.
      if (parsed.document) {
        const documentText = `\n\n<current-document>\n${parsed.document}\n</current-document>`;
        modelMessages.push({
          role: "user",
          content: documentText,
        });
      }

      const agent = createDocumentWritingAgent({
        model: writerLanguageModel(resolveArticleWriterModel(parsed.model)),
        mode: parsed.mode as DocumentWritingAgentMode,
        transcript: videoContext.transcript,
        code: videoContext.textFiles,
        imageFiles: videoContext.imageFiles,
        sectionNames: videoContext.sectionNames,
        existingQuizIds: videoContext.existingQuizIds,
        links,
        courseStructure: courseStructureText,
        memory: parsed.memory,
        beats: parsed.beats,
        script: parsed.script,
        animatic: parsed.animatic,
      });

      const result = yield* Effect.tryPromise({
        try: () =>
          agent.stream({
            messages: modelMessages,
          }) as Promise<{
            toUIMessageStreamResponse: (opts: {
              onError: (error: unknown) => string;
              messageMetadata: (options: {
                part: { type: string; totalUsage?: LanguageModelUsage };
              }) => WriterCacheStats | undefined;
            }) => Response;
          }>,
        catch: (cause) => new WriterStreamError({ cause }),
      });

      // A cache miss is silent — Anthropic returns no error when caching does
      // not apply, it simply bills the full prefix. Sending the counts to the
      // client is the only way the miss ever becomes visible.
      return result.toUIMessageStreamResponse({
        onError: describeWriterStreamError,
        messageMetadata: ({ part }) => {
          if (part.type !== "finish" || !part.totalUsage) return undefined;
          const details = part.totalUsage.inputTokenDetails;
          return {
            cacheReadTokens: details?.cacheReadTokens ?? 0,
            cacheWriteTokens: details?.cacheWriteTokens ?? 0,
            noCacheTokens: details?.noCacheTokens ?? 0,
          };
        },
      });
    });
  },
});
