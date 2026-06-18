import { describe, it, expect } from "@effect/vitest";
import { Effect, Exit } from "effect";
import {
  makeDbCall,
  dbQueryFirst,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";

describe("makeDbCall", () => {
  it.effect("passes through resolved value", () =>
    Effect.gen(function* () {
      const result = yield* makeDbCall(() => Promise.resolve(42));
      expect(result).toBe(42);
    })
  );

  it.effect("wraps rejected promise in UnknownDBServiceError", () =>
    Effect.gen(function* () {
      const error = new Error("db connection failed");
      const exit = yield* makeDbCall(() => Promise.reject(error)).pipe(
        Effect.exit
      );
      expect(Exit.isFailure(exit)).toBe(true);
      const cause = (exit as Exit.Exit<never, UnknownDBServiceError>).pipe(
        Exit.match({
          onFailure: (cause) => cause,
          onSuccess: () => null,
        })
      );
      expect(cause).not.toBeNull();
    })
  );

  it.effect("produces UnknownDBServiceError with original error as cause", () =>
    Effect.gen(function* () {
      const originalError = new Error("connection timeout");
      const result = yield* makeDbCall(() =>
        Promise.reject(originalError)
      ).pipe(Effect.flip);
      expect(result).toBeInstanceOf(UnknownDBServiceError);
      expect(result.cause).toBe(originalError);
    })
  );
});

describe("dbQueryFirst", () => {
  it.effect("passes through non-null result", () =>
    Effect.gen(function* () {
      const row = { id: "abc", name: "test" };
      const result = yield* dbQueryFirst(() => Promise.resolve(row), {
        type: "getFoo",
        params: { id: "abc" },
      });
      expect(result).toEqual(row);
    })
  );

  it.effect("produces NotFoundError when result is undefined", () =>
    Effect.gen(function* () {
      const result = yield* dbQueryFirst(() => Promise.resolve(undefined), {
        type: "getFoo",
        params: { id: "missing" },
      }).pipe(Effect.flip);
      expect(result).toBeInstanceOf(NotFoundError);
      const err = result as NotFoundError;
      expect(err.type).toBe("getFoo");
      expect(err.params).toEqual({ id: "missing" });
    })
  );

  it.effect("produces NotFoundError when result is null", () =>
    Effect.gen(function* () {
      const result = yield* dbQueryFirst(
        () => Promise.resolve(null as unknown as undefined),
        {
          type: "getBar",
          params: { slug: "nope" },
        }
      ).pipe(Effect.flip);
      expect(result).toBeInstanceOf(NotFoundError);
      expect((result as NotFoundError).type).toBe("getBar");
    })
  );

  it.effect("produces UnknownDBServiceError on rejected promise", () =>
    Effect.gen(function* () {
      const dbError = new Error("query failed");
      const result = yield* dbQueryFirst(() => Promise.reject(dbError), {
        type: "getFoo",
        params: { id: "x" },
      }).pipe(Effect.flip);
      expect(result).toBeInstanceOf(UnknownDBServiceError);
      expect(result.cause).toBe(dbError);
    })
  );
});

describe("dbMutateReturning", () => {
  it.effect("returns first element from non-empty result array", () =>
    Effect.gen(function* () {
      const row = { id: "new-1", name: "created" };
      const result = yield* dbMutateReturning(() => Promise.resolve([row]));
      expect(result).toEqual(row);
    })
  );

  it.effect("returns first element when multiple rows are returned", () =>
    Effect.gen(function* () {
      const first = { id: "a", name: "first" };
      const second = { id: "b", name: "second" };
      const result = yield* dbMutateReturning(() =>
        Promise.resolve([first, second])
      );
      expect(result).toEqual(first);
    })
  );

  it.effect(
    "produces UnknownDBServiceError on empty array without errorContext",
    () =>
      Effect.gen(function* () {
        const result = yield* dbMutateReturning(() => Promise.resolve([])).pipe(
          Effect.flip
        );
        expect(result).toBeInstanceOf(UnknownDBServiceError);
        expect(result.cause).toBe("Mutation returned no rows");
      })
  );

  it.effect("produces NotFoundError on empty array with errorContext", () =>
    Effect.gen(function* () {
      const result = yield* dbMutateReturning(() => Promise.resolve([]), {
        type: "updateFoo",
        params: { id: "gone" },
      }).pipe(Effect.flip);
      expect(result).toBeInstanceOf(NotFoundError);
      const err = result as NotFoundError;
      expect(err.type).toBe("updateFoo");
      expect(err.params).toEqual({ id: "gone" });
    })
  );

  it.effect("produces UnknownDBServiceError on rejected promise", () =>
    Effect.gen(function* () {
      const dbError = new Error("insert failed");
      const result = yield* dbMutateReturning(() =>
        Promise.reject(dbError)
      ).pipe(Effect.flip);
      expect(result).toBeInstanceOf(UnknownDBServiceError);
      expect(result.cause).toBe(dbError);
    })
  );

  it.effect(
    "produces UnknownDBServiceError on rejected promise even with errorContext",
    () =>
      Effect.gen(function* () {
        const dbError = new Error("update failed");
        const result = yield* dbMutateReturning(() => Promise.reject(dbError), {
          type: "updateFoo",
          params: { id: "x" },
        }).pipe(Effect.flip);
        expect(result).toBeInstanceOf(UnknownDBServiceError);
        expect(result.cause).toBe(dbError);
      })
  );
});
