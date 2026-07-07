import { Effect } from "effect";
import { DatabaseDumpService } from "@/services/dump-service";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  dump: false,
  effect: () =>
    Effect.gen(function* () {
      const svc = yield* DatabaseDumpService;
      yield* svc.requestDump;
      return { enqueued: true };
    }),
});
