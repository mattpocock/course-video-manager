import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { makeAction } from "@/services/route-action.server";
import { CloudinaryMarkdownService } from "@/services/cloudinary-markdown-service";
import { FileSystem } from "@effect/platform";
import { Effect, Schema } from "effect";
import path from "node:path";

const writeReadmeSchema = Schema.Struct({
  lessonId: Schema.String,
  content: Schema.String,
  mode: Schema.optional(Schema.Literal("write", "append")),
  targetFolder: Schema.optional(
    Schema.Literal("explainer", "problem", "solution")
  ),
});

export const action = makeAction({
  input: "json",
  dump: false,
  errors: { NotFoundError: 404 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const fs = yield* FileSystem.FileSystem;
      const cloudinaryMarkdown = yield* CloudinaryMarkdownService;

      const parsed = yield* Schema.decodeUnknown(writeReadmeSchema)(payload);
      const { lessonId, mode, targetFolder } = parsed;

      const lesson =
        yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);
      const lessonFullPath = path.join(
        lesson.section.repoVersion.repo.filePath!,
        lesson.section.path,
        lesson.path
      );

      const uploadResult = yield* cloudinaryMarkdown
        .uploadImagesInMarkdown(parsed.content, lessonFullPath)
        .pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              body: parsed.content,
              uploadedFilePaths: [] as string[],
            })
          )
        );
      const content = uploadResult.body;

      for (const uploadedPath of uploadResult.uploadedFilePaths) {
        yield* fs.remove(uploadedPath).pipe(Effect.catchAll(() => Effect.void));
      }

      let targetPath: string;
      if (targetFolder) {
        const folderPath = path.join(lessonFullPath, targetFolder);
        const folderExists = yield* fs.exists(folderPath);
        if (!folderExists) {
          yield* fs.makeDirectory(folderPath, { recursive: true });
        }
        targetPath = path.join(folderPath, "readme.md");
      } else {
        const explainerPath = path.join(lessonFullPath, "explainer");
        const problemPath = path.join(lessonFullPath, "problem");

        const explainerExists = yield* fs.exists(explainerPath);
        const problemExists = yield* fs.exists(problemPath);

        if (explainerExists) {
          targetPath = path.join(explainerPath, "readme.md");
        } else if (problemExists) {
          targetPath = path.join(problemPath, "readme.md");
        } else {
          return Response.json(
            { success: false, error: "No explainer or problem folder found" },
            { status: 400 }
          );
        }
      }

      if (mode === "append") {
        const fileExists = yield* fs.exists(targetPath);
        if (fileExists) {
          const existingContent = yield* fs.readFileString(targetPath);
          yield* fs.writeFileString(
            targetPath,
            existingContent + "\n\n" + content
          );
        } else {
          yield* fs.writeFileString(targetPath, content);
        }
      } else {
        yield* fs.writeFileString(targetPath, content);
      }

      return Response.json({ success: true, body: content });
    }),
});
