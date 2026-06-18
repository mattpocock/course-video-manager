import { Effect } from "effect";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";

export const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const dbQueryFirst = <T>(
  fn: () => Promise<T | undefined | null>,
  errorContext: { type: string; params: object }
) => {
  return Effect.gen(function* () {
    const result = yield* makeDbCall(fn);
    if (result == null) {
      return yield* new NotFoundError(errorContext);
    }
    return result as NonNullable<T>;
  });
};

export const dbMutateReturning = <T>(
  fn: () => Promise<T[]>,
  errorContext?: { type: string; params: object }
) => {
  return Effect.gen(function* () {
    const results = yield* makeDbCall(fn);
    const result = results[0];
    if (!result) {
      if (errorContext) {
        return yield* new NotFoundError(errorContext);
      }
      return yield* new UnknownDBServiceError({
        cause: "Mutation returned no rows",
      });
    }
    return result;
  });
};
