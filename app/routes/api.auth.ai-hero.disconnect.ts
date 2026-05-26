import { Effect } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  dump: false,
  effect: () =>
    Effect.gen(function* () {
      const linkAuthOps = yield* LinkAuthOperationsService;
      yield* linkAuthOps.deleteAiHeroAuth();
      return { success: true };
    }),
});
