import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import { SpacedeskService } from "@/services/spacedesk-service";

const SpacedeskOpenPayload = Schema.Struct({
  ip: Schema.String.pipe(
    Schema.filter((s) => {
      const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!m) return "Invalid IPv4 address";
      if (m[1] !== "192" || m[2] !== "168")
        return "IP must start with 192.168.";
      if ([m[3], m[4]].some((o) => Number(o) > 255))
        return "Each octet must be 0-255";
      return true;
    })
  ),
});

export const action = makeAction({
  input: "json",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { ip } = yield* Schema.decodeUnknown(SpacedeskOpenPayload)(payload);
      const spacedesk = yield* SpacedeskService;
      yield* spacedesk.wakeDisplay(ip);
      return { success: true as const };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({ success: false as const, message: error.message })
      )
    ),
});
