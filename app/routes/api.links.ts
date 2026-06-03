import { Effect, Schema } from "effect";
import { data } from "react-router";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { makeAction, makeLoader } from "@/services/route-action.server";

function normalizePayload(payload: unknown): unknown {
  const obj = payload as Record<string, unknown>;
  return { ...obj, description: obj.description || null };
}

const CreateLinkSchema = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const linkAuthOps = yield* LinkAuthOperationsService;
      const links = yield* linkAuthOps.getLinks();

      return { links };
    }),
});

export const action = makeAction({
  input: "formData",
  dump: false,
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(CreateLinkSchema)(
        normalizePayload(payload)
      );

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
      Effect.catchAll((e: any) => {
        if (e?.cause?.code === "23505") {
          return Effect.die(
            data("A link with this URL already exists", { status: 409 })
          );
        }
        return Effect.fail(e);
      })
    ),
});
