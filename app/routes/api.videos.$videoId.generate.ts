import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { acquireTextWritingContext } from "@/services/text-writing-agent";
import { generateYoutubeTitlePrompt } from "@/prompts/generate-youtube-title";
import { generateSingleYoutubeTitlePrompt } from "@/prompts/generate-single-youtube-title";
import { generateYoutubeDescriptionPrompt } from "@/prompts/generate-youtube-description";
import { generateSocialCaptionPrompt } from "@/prompts/generate-social-caption";
import { generateSeoDescriptionPrompt } from "@/prompts/generate-seo-description";
import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const generateModeSchema = Schema.Union(
  Schema.Literal("youtube-title"),
  Schema.Literal("youtube-title-single"),
  Schema.Literal("youtube-description"),
  Schema.Literal("social-caption"),
  Schema.Literal("seo-description")
);

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

const requestSchema = Schema.Struct({
  mode: generateModeSchema,
  enabledFiles: Schema.Array(Schema.String),
  includeTranscript: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  enabledSections: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
  courseStructure: Schema.optional(courseStructureSchema),
});

export const action = makeAction({
  input: "json",
  dump: false,
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(requestSchema)(payload);
      const videoId = params.videoId!;
      const mode = parsed.mode;
      const enabledFiles: string[] = [...parsed.enabledFiles];
      const includeTranscript = parsed.includeTranscript;
      const enabledSections: string[] = [...parsed.enabledSections];

      const videoContext = yield* acquireTextWritingContext({
        videoId,
        enabledFiles,
        includeTranscript,
        enabledSections,
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

      const commonOpts = {
        code: videoContext.textFiles,
        transcript: videoContext.transcript,
        images: videoContext.imageFiles.map((file) => file.path),
        courseStructure: courseStructureText,
        links,
      };

      const systemPrompt =
        mode === "youtube-title"
          ? generateYoutubeTitlePrompt(commonOpts)
          : mode === "youtube-title-single"
            ? generateSingleYoutubeTitlePrompt(commonOpts)
            : mode === "social-caption"
              ? generateSocialCaptionPrompt(commonOpts)
              : mode === "seo-description"
                ? generateSeoDescriptionPrompt(commonOpts)
                : generateYoutubeDescriptionPrompt({
                    ...commonOpts,
                    youtubeChapters: videoContext.youtubeChapters,
                  });

      const result = yield* Effect.tryPromise(() =>
        generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          system: systemPrompt,
          messages: [{ role: "user", content: "Go" }],
        })
      );

      return Response.json({ text: result.text });
    }),
});
