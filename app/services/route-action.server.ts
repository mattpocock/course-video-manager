import { Console, Effect, type ManagedRuntime } from "effect";
import { data } from "react-router";
import { runtimeLive } from "./layer.server";
import { withDatabaseDump } from "./dump-service";

type ErrorTags<E> = E extends { readonly _tag: infer T extends string }
  ? T
  : never;

interface MakeActionConfig<A, E, R> {
  input?: "json" | "formData" | "none";
  dump?: boolean;
  errors?: { [K in ErrorTags<E>]?: number };
  effect: (ctx: {
    params: Record<string, string | undefined>;
    payload: unknown;
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

export function makeAction<A, E, R>(
  config: MakeActionConfig<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<any, any> = runtimeLive
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
    if (config.input === "json") {
      payload = await args.request.json();
    } else if (config.input === "formData") {
      const formData = await args.request.formData();
      payload = Object.fromEntries(formData);
    }

    let effect: Effect.Effect<A, E, R> = config.effect({
      params: args.params,
      payload,
    });

    if (config.dump !== false) {
      effect = effect.pipe(withDatabaseDump) as typeof effect;
    }

    const pipeline = effect.pipe(
      Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
      Effect.catchAll((error: NoInfer<E>) => {
        const tag =
          error != null &&
          typeof error === "object" &&
          "_tag" in error &&
          typeof (error as Record<string, unknown>)._tag === "string"
            ? ((error as Record<string, unknown>)._tag as string)
            : undefined;
        const isCustomMapped =
          tag !== undefined && config.errors != null && tag in config.errors;
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

    return runtime.runPromise(pipeline as Effect.Effect<A, never, R>);
  };
}
