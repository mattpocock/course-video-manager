import { Console, Effect } from "effect";
import type { Route } from "./+types/api.links.$linkId.delete";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

export const action = async (args: Route.ActionArgs) => {
  const { linkId } = args.params;

  return Effect.gen(function* () {
    const linkAuthOps = yield* LinkAuthOperationsService;
    yield* linkAuthOps.deleteLink(linkId);

    return { success: true };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
