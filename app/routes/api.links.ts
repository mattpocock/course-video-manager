import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/api.links";
import { runtimeLive } from "@/services/layer.server";
import { data } from "react-router";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";

const CreateLinkSchema = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export const loader = async (_args: Route.LoaderArgs) => {
  return Effect.gen(function* () {
    const linkAuthOps = yield* LinkAuthOperationsService;
    const links = yield* linkAuthOps.getLinks();

    return { links };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export const action = async (args: Route.ActionArgs) => {
  const formData = await args.request.formData();
  const title = formData.get("title");
  const url = formData.get("url");
  const description = formData.get("description");

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(CreateLinkSchema)({
      title,
      url,
      description: description || null,
    });

    // Basic URL validation
    try {
      new URL(parsed.url);
    } catch {
      return yield* Effect.die(data("Invalid URL format", { status: 400 }));
    }

    const linkAuthOps = yield* LinkAuthOperationsService;

    const link = yield* linkAuthOps.createLink({
      title: parsed.title.trim(),
      url: parsed.url.trim(),
      description: parsed.description?.trim() ?? parsed.description,
    });

    return { link };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", (e) => {
      return Effect.die(data("Invalid request: " + e.message, { status: 400 }));
    }),
    Effect.catchAll((e) => {
      // Check for unique constraint violation (duplicate URL)
      if (
        e &&
        typeof e === "object" &&
        "cause" in e &&
        e.cause &&
        typeof e.cause === "object" &&
        "code" in e.cause &&
        e.cause.code === "23505"
      ) {
        return Effect.die(
          data("A link with this URL already exists", { status: 409 })
        );
      }
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
