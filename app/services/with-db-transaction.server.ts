import type { DrizzleDB, Database } from "@/services/drizzle-service.server";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { Cause, Effect, Exit } from "effect";

export const withDbTransaction = <A, E>(
  db: DrizzleDB,
  fn: (tx: Database) => Effect.Effect<A, E>
): Effect.Effect<A, E | UnknownDBServiceError> =>
  Effect.async<A, E | UnknownDBServiceError>((resume) => {
    let failureCause: Cause.Cause<E> | null = null;

    db.transaction(async (tx) => {
      const exit = await Effect.runPromiseExit(fn(tx));
      if (Exit.isFailure(exit)) {
        failureCause = exit.cause;
        throw exit;
      }
      return exit.value;
    })
      .then((value) => resume(Effect.succeed(value)))
      .catch((err) => {
        if (failureCause) {
          resume(Effect.failCause(failureCause));
        } else {
          resume(Effect.fail(new UnknownDBServiceError({ cause: err })));
        }
      });
  });
