import { Console, Effect } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

/**
 * Disconnect YouTube account by deleting stored OAuth tokens.
 */
export const action = async () => {
  return Effect.gen(function* () {
    const db = yield* LinkAuthOperationsService;
    yield* db.deleteYoutubeAuth();
    return Response.json({ success: true });
  }).pipe(
    Effect.tapErrorCause((e) => Console.log(e)),
    Effect.catchAll(() => {
      return Effect.succeed(
        Response.json({ error: "Failed to disconnect" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
