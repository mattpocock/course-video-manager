import type { Database } from "./drizzle-service.server";
import { UnknownDBServiceError } from "./db-service-errors";
import { Cause, Effect, Exit } from "effect";

export const withDbTransaction = <A, E>(
  db: Database,
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

/**
 * Wraps the named write methods of an ops factory so that each call runs in
 * its own transaction: the factory is re-instantiated with the transaction
 * handle, so the method's draft-guard (SELECT … FOR UPDATE on the owning
 * CourseVersion row) and its writes commit atomically. This closes the
 * clips-during-publish race (issue #1403): a write serializes against
 * Submit's version-row lock instead of check-then-writing around it.
 * Read methods are returned untouched, bound to the original handle.
 */
export const transactionalizeWrites = <T extends object>(
  db: Database,
  factory: (db: Database) => T,
  writeMethods: readonly (keyof T & string)[]
): T => {
  const ops = factory(db);
  for (const name of writeMethods) {
    const wrapped = (...args: unknown[]) =>
      withDbTransaction(db, (tx) =>
        (
          factory(tx)[name] as unknown as (
            ...a: unknown[]
          ) => Effect.Effect<unknown, UnknownDBServiceError>
        )(...args)
      );
    (ops as Record<string, unknown>)[name] = wrapped;
  }
  return ops;
};
