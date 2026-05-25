import { Console, Effect } from "effect";
import { data } from "react-router";
import { runtimeLive } from "./layer.server";
import { withDatabaseDump } from "./dump-service";

interface MakeActionConfig {
  input?: "json" | "formData" | "none";
  dump?: boolean;
  errors?: Record<string, number>;
  effect: (ctx: {
    params: Record<string, string | undefined>;
    payload: unknown;
  }) => Effect.Effect<any, any, any>;
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Invalid request";
    case 404:
      return "Not found";
    default:
      return "Internal server error";
  }
}

export function makeAction(
  config: MakeActionConfig,
  runtime: { runPromise: (...args: any[]) => Promise<any> } = runtimeLive
) {
  const errorMap: Record<string, number> = {
    ParseError: 400,
    ...config.errors,
  };

  return async (args: {
    request: Request;
    params: Record<string, string | undefined>;
  }) => {
    let payload: unknown;
    if (config.input === "json") {
      payload = await args.request.json();
    } else if (config.input === "formData") {
      const formData = await args.request.formData();
      payload = Object.fromEntries(formData);
    }

    let effect: Effect.Effect<any, any, any> = config.effect({
      params: args.params,
      payload,
    });

    if (config.dump !== false) {
      effect = effect.pipe(withDatabaseDump);
    }

    const pipeline = effect.pipe(
      Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
      Effect.catchAll((error: unknown) => {
        const tag =
          error != null &&
          typeof error === "object" &&
          "_tag" in error &&
          typeof (error as Record<string, unknown>)._tag === "string"
            ? ((error as Record<string, unknown>)._tag as string)
            : undefined;
        const status =
          tag !== undefined && tag in errorMap ? errorMap[tag]! : 500;
        return Effect.die(data(statusMessage(status), { status }));
      })
    );

    return runtime.runPromise(pipeline);
  };
}
