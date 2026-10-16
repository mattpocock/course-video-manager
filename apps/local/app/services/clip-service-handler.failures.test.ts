import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";
import { handleClipServiceEvent } from "./clip-service-handler";
import type { Database } from "@/services/drizzle-service.server";

// A database whose insert rejects, the way a dropped connection does.
const rejectingDb = (cause: Error) =>
  ({
    insert: () => ({
      values: () => ({ returning: () => Promise.reject(cause) }),
    }),
  }) as unknown as Database;

const failureTag = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? Option.map(
        Cause.failureOption(exit.cause),
        (e) => (e as { _tag: string })._tag
      )
    : Option.none();

describe("handleClipServiceEvent: a rejected promise is a typed failure", () => {
  it("fails with UnknownDBServiceError, not a defect, when a query rejects", async () => {
    const cause = new Error("connection reset");
    const exit = await Effect.runPromiseExit(
      handleClipServiceEvent(rejectingDb(cause), {
        type: "create-video",
        title: "A video",
      })
    );
    expect(failureTag(exit)).toEqual(Option.some("UnknownDBServiceError"));
  });
});
