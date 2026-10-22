import { Cause, Console, Effect, Exit, type ManagedRuntime } from "effect";
import { data } from "react-router";
import { type LayerLive, runtimeLive } from "./layer.server";
import { withRequestTally } from "./slow-request-log.server";
import { asStorageRootOffline } from "./storage-root-availability.server";

type ErrorTags<E> = E extends { readonly _tag: infer T extends string }
  ? T
  : never;

interface MakeActionConfig<A, E, R> {
  input?: "json" | "formData" | "none";
  errors?: { [K in ErrorTags<E>]?: number };
  effect: (ctx: {
    params: Record<string, string | undefined>;
    payload: unknown;
    /** For headers; the body has already been read into `payload`. */
    request: Request;
  }) => Effect.Effect<A, E, R>;
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Invalid request";
    case 404:
      return "Not found";
    case 409:
      return "Conflict";
    default:
      return "Internal server error";
  }
}

/**
 * An Offline Storage Root is expected, not a bug: the route answers 503 with
 * the message naming the drive, and the log gets the one line the root's
 * change of state prints instead of a stack per request.
 */
const logUnlessRootOffline = (cause: Cause.Cause<unknown>) =>
  asStorageRootOffline(Cause.squash(cause)) === undefined
    ? Console.dir(cause, { depth: null })
    : Effect.void;

const answerRootOffline = <E>(error: E): Effect.Effect<never, E> => {
  const offline = asStorageRootOffline(error);
  return offline === undefined
    ? Effect.fail(error)
    : Effect.die(data(offline.message, { status: 503 }));
};

function buildErrorPipeline<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  errorMap: Record<string, number>,
  customErrors?: Partial<Record<string, number>>
): Effect.Effect<A, never, R> {
  return effect.pipe(
    Effect.tapErrorCause(logUnlessRootOffline),
    Effect.catchAll(answerRootOffline),
    Effect.catchAll((error: NoInfer<E>) => {
      const tag =
        error != null &&
        typeof error === "object" &&
        "_tag" in error &&
        typeof (error as Record<string, unknown>)._tag === "string"
          ? ((error as Record<string, unknown>)._tag as string)
          : undefined;
      const isCustomMapped =
        tag !== undefined && customErrors != null && tag in customErrors;
      const status =
        tag !== undefined && tag in errorMap ? errorMap[tag]! : 500;
      const message =
        isCustomMapped &&
        error != null &&
        typeof error === "object" &&
        "message" in error &&
        typeof (error as Record<string, unknown>).message === "string" &&
        (error as Record<string, unknown>).message !== ""
          ? ((error as Record<string, unknown>).message as string)
          : statusMessage(status);
      return Effect.die(data(message, { status }));
    })
  );
}

/**
 * Run a route's Effect and answer React Router the way it understands.
 *
 * A route answers with a status only when the loader or action throws the
 * `data(…, { status })` (or `Response`, or `redirect`) ITSELF. `runPromise`
 * rejects with a `FiberFailure` wrapping the defect instead, which React
 * Router treats as an unknown error and answers 500 — so a 409 "would post it
 * twice" reached the browser as "Unexpected Server Error". Run to an `Exit` and
 * throw what the Effect died (or failed) with, unwrapped.
 */
export async function runRouteEffect<A, R>(
  runtime: ManagedRuntime.ManagedRuntime<R, unknown>,
  effect: Effect.Effect<A, unknown, R>
): Promise<A> {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

interface MakeLoaderConfig<A, E, R> {
  errors?: { [K in ErrorTags<E>]?: number };
  effect: (ctx: {
    request: Request;
    params: Record<string, string | undefined>;
  }) => Effect.Effect<A, E, R>;
}

export function makeLoader<A, E, R extends LayerLive>(
  config: MakeLoaderConfig<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, unknown> = runtimeLive
): (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => Promise<A> {
  const errorMap: Record<string, number> = {
    ParseError: 400,
    NotFoundError: 404,
    ...config.errors,
  };

  return (args) => {
    const effect = config.effect({
      request: args.request,
      params: args.params,
    });
    return runRouteEffect(
      runtime,
      withRequestTally(buildErrorPipeline(effect, errorMap, config.errors))
    );
  };
}

export function makeAction<A, E, R extends LayerLive>(
  config: MakeActionConfig<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, unknown> = runtimeLive
): (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => Promise<A> {
  const errorMap: Record<string, number> = {
    ParseError: 400,
    ...config.errors,
  };

  return async (args) => {
    let payload: unknown;
    try {
      if (config.input === "json") {
        payload = await args.request.json();
      } else if (config.input === "formData") {
        const formData = await args.request.formData();
        payload = Object.fromEntries(formData);
      }
    } catch {
      // A body that is not the JSON or form it claims to be is the caller's
      // mistake, as a body that fails its Schema is (ParseError → 400).
      throw data(statusMessage(400), { status: 400 });
    }

    const effect: Effect.Effect<A, E, R> = config.effect({
      params: args.params,
      payload,
      request: args.request,
    });

    return runRouteEffect(
      runtime,
      withRequestTally(buildErrorPipeline(effect, errorMap, config.errors))
    );
  };
}
