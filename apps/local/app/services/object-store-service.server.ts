import { FileSystem } from "@effect/platform";
import { Data, Effect, Config } from "effect";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class ObjectStoreError extends Data.TaggedError("ObjectStoreError")<{
  message: string;
}> {}

const createObjectStoreOperations = (opts: {
  bucket: string;
  region: string;
}) => {
  const client = new S3Client({ region: opts.region });

  return {
    upload: (uploadOpts: {
      pathname: string;
      filePath: string;
      onProgress?: (percentage: number) => void;
    }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        yield* fs.stat(uploadOpts.filePath).pipe(
          Effect.mapError(
            () =>
              new ObjectStoreError({
                message: `File not found: ${uploadOpts.filePath}`,
              })
          )
        );

        uploadOpts.onProgress?.(0);

        const fileContent = yield* fs.readFile(uploadOpts.filePath).pipe(
          Effect.mapError(
            () =>
              new ObjectStoreError({
                message: `Failed to read file: ${uploadOpts.filePath}`,
              })
          )
        );

        yield* Effect.tryPromise({
          try: () =>
            client.send(
              new PutObjectCommand({
                Bucket: opts.bucket,
                Key: uploadOpts.pathname,
                Body: fileContent,
                ContentType: "video/mp4",
              })
            ),
          catch: (e) =>
            new ObjectStoreError({
              message: e instanceof Error ? e.message : String(e),
            }),
        });

        uploadOpts.onProgress?.(100);

        const url = `https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${uploadOpts.pathname}`;
        return { url };
      }),
  };
};

export class ObjectStoreService extends Effect.Service<ObjectStoreService>()(
  "ObjectStoreService",
  {
    effect: Effect.gen(function* () {
      const bucket = yield* Config.string("S3_BUCKET");
      const region = yield* Config.string("AWS_REGION");
      return createObjectStoreOperations({ bucket, region });
    }),
    dependencies: [],
  }
) {}
