import { Data, Effect } from "effect";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export class CloudinaryUrlNotSetError extends Data.TaggedError(
  "CloudinaryUrlNotSetError"
)<{
  message: string;
}> {}

export class CouldNotParseCloudinaryUrlError extends Data.TaggedError(
  "CouldNotParseCloudinaryUrlError"
)<{
  message: string;
  url: string;
}> {}

export class ImageUploadError extends Data.TaggedError("ImageUploadError")<{
  cause: unknown;
  message: string;
  filePath: string;
}> {}

export class CloudinaryService extends Effect.Service<CloudinaryService>()(
  "CloudinaryService",
  {
    effect: Effect.gen(function* () {
      const configure = Effect.gen(function* () {
        const cloudinaryUrl = process.env.CLOUDINARY_URL;
        if (!cloudinaryUrl) {
          return yield* new CloudinaryUrlNotSetError({
            message:
              "CLOUDINARY_URL is not set in environment variables. Format: cloudinary://<api-key>:<api-secret>@<cloud-name>",
          });
        }

        const match = cloudinaryUrl.match(
          /cloudinary:\/\/([^:]+):([^@]+)@(.+)/
        );
        if (!match) {
          return yield* new CouldNotParseCloudinaryUrlError({
            message: `Could not parse CLOUDINARY_URL. Expected format: cloudinary://<api-key>:<api-secret>@<cloud-name>`,
            url: cloudinaryUrl,
          });
        }

        const [, apiKey, apiSecret, cloudName] = match;

        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
        });
      });

      const upload = Effect.fn("upload")(function* (filePath: string) {
        yield* configure;

        const result = yield* Effect.tryPromise({
          try: () =>
            cloudinary.uploader.upload(filePath, {
              resource_type: "auto",
              folder: "ai-hero-images",
            }) as Promise<UploadApiResponse>,
          catch: (e) =>
            new ImageUploadError({
              cause: e,
              message: `Failed to upload ${filePath} to Cloudinary: ${e}`,
              filePath,
            }),
        });

        return result.secure_url;
      });

      return { upload };
    }),
  }
) {}
