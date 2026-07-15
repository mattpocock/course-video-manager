import { Effect } from "effect";
import { makeAction } from "@/services/route-action.server";
import { SpacedeskService } from "@/services/spacedesk-service";

export const action = makeAction({
  dump: false,
  effect: () =>
    Effect.gen(function* () {
      const spacedesk = yield* SpacedeskService;
      yield* spacedesk.wakeDisplay();
      return { success: true as const };
    }).pipe(
      // Return failures as data so the button can surface a toast instead of
      // tripping the route error boundary.
      Effect.catchAll((error) =>
        Effect.succeed({ success: false as const, message: error.message })
      )
    ),
});
