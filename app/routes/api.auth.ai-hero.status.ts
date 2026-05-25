import { Console, Effect } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

/**
 * Get AI Hero auth status. Returns whether connected and user ID if so.
 */
export const loader = async () => {
  return Effect.gen(function* () {
    const linkAuthOps = yield* LinkAuthOperationsService;
    const auth = yield* linkAuthOps.getAiHeroAuth();

    if (!auth) {
      return Response.json({ connected: false });
    }

    return Response.json({
      connected: true,
      userId: auth.userId,
    });
  }).pipe(
    Effect.tapErrorCause((e) => Console.log(e)),
    Effect.catchAll(() => {
      return Effect.succeed(
        Response.json({ error: "Internal server error" }, { status: 500 })
      );
    }),
    runtimeLive.runPromise
  );
};
