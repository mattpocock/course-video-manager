import { Config, Effect } from "effect";
import { VersionOperationsService } from "./db-version-operations.server";
import { download } from "./dropbox-http-client";
import { getValidDropboxAccessToken } from "./dropbox-auth-service";

export type PendingRecovery = {
  versionId: string;
  versionName: string;
  receiptState: "committed" | "absent" | "unreadable";
};

export const classifyPendingRecovery = Effect.fn("classifyPendingRecovery")(
  function* (input: { courseId: string; courseName: string }) {
    const versionOps = yield* VersionOperationsService;
    const pending = yield* versionOps.getPendingVersion(input.courseId);
    if (!pending) return null;

    const dropboxRemotePath = yield* Config.string("DROPBOX_REMOTE_PATH");
    const courseJsonPath = `${dropboxRemotePath}/${input.courseName}/course.json`;

    // Attempt to get a valid access token. If Dropbox is not authenticated,
    // refuse to classify — same as "mount unreachable" in the old FS world.
    const accessToken = yield* getValidDropboxAccessToken.pipe(
      Effect.catchAll(() => Effect.succeed(null as string | null))
    );

    if (!accessToken) {
      return {
        versionId: pending.id,
        versionName: pending.name,
        receiptState: "unreadable" as const,
      } satisfies PendingRecovery;
    }

    const receiptState: PendingRecovery["receiptState"] = yield* download({
      accessToken,
      path: courseJsonPath,
    }).pipe(
      Effect.map((buffer): PendingRecovery["receiptState"] => {
        try {
          const doc = JSON.parse(buffer.toString("utf-8")) as {
            courseVersionId?: unknown;
          };
          return doc.courseVersionId === pending.id ? "committed" : "absent";
        } catch {
          return "unreadable";
        }
      }),
      Effect.catchTag("DropboxApiError", (error) =>
        Effect.succeed<PendingRecovery["receiptState"]>(
          error.status === 409 ? "absent" : "unreadable"
        )
      )
    );

    return {
      versionId: pending.id,
      versionName: pending.name,
      receiptState,
    } satisfies PendingRecovery;
  }
);
