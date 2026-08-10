import { Effect } from "effect";
import { CloudinaryService, ImageUploadError } from "./cloudinary-service";
import fs from "node:fs";
import path from "node:path";

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

export class CloudinaryMarkdownService extends Effect.Service<CloudinaryMarkdownService>()(
  "CloudinaryMarkdownService",
  {
    effect: Effect.gen(function* () {
      const cloudinary = yield* CloudinaryService;

      const uploadImagesInMarkdown = Effect.fn("uploadImagesInMarkdown")(
        function* (body: string, baseDir: string) {
          const matches = Array.from(body.matchAll(IMAGE_REGEX));

          if (matches.length === 0) {
            return { body, uploadedFilePaths: [] as string[] };
          }

          let updatedBody = body;
          const uploadedFilePaths: string[] = [];

          for (const match of matches) {
            const [fullMatch, altText, imagePath] = match;

            // Skip URLs — already hosted
            if (
              imagePath!.startsWith("http://") ||
              imagePath!.startsWith("https://")
            ) {
              continue;
            }

            // Resolve to absolute path
            const resolvedPath = path.isAbsolute(imagePath!)
              ? imagePath!
              : path.resolve(baseDir, imagePath!);

            // Check file exists
            if (!fs.existsSync(resolvedPath)) {
              return yield* new ImageUploadError({
                cause: null,
                message: `Image file not found: ${resolvedPath} (referenced as ${imagePath})`,
                filePath: resolvedPath,
              });
            }

            // Upload to Cloudinary
            const secureUrl = yield* cloudinary.upload(resolvedPath);

            // Replace in body (replace just this occurrence)
            updatedBody = updatedBody.replace(
              fullMatch!,
              `![${altText}](${secureUrl})`
            );

            uploadedFilePaths.push(resolvedPath);
          }

          return { body: updatedBody, uploadedFilePaths };
        }
      );

      return { uploadImagesInMarkdown };
    }),
  }
) {}
