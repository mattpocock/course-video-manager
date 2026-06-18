import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { links, youtubeAuth, aiHeroAuth } from "@/db/schema";
import { NotFoundError } from "@/services/db-service-errors";
import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  makeDbCall,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";

export const createLinkAuthOperations = (db: DrizzleDB) => {
  const getLinks = Effect.fn("getLinks")(function* () {
    return yield* makeDbCall(() =>
      db.query.links.findMany({
        orderBy: desc(links.createdAt),
      })
    );
  });

  const createLink = Effect.fn("createLink")(function* (link: {
    title: string;
    url: string;
    description?: string | null;
  }) {
    return yield* dbMutateReturning(() =>
      db
        .insert(links)
        .values({
          title: link.title,
          url: link.url,
          description: link.description ?? null,
        })
        .returning()
    );
  });

  const deleteLink = Effect.fn("deleteLink")(function* (linkId: string) {
    yield* makeDbCall(() => db.delete(links).where(eq(links.id, linkId)));
    return { success: true };
  });

  const getYoutubeAuth = Effect.fn("getYoutubeAuth")(function* () {
    const auth = yield* makeDbCall(() => db.query.youtubeAuth.findFirst());
    return auth ?? null;
  });

  const upsertYoutubeAuth = Effect.fn("upsertYoutubeAuth")(function* (tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }) {
    yield* makeDbCall(() => db.delete(youtubeAuth));

    return yield* dbMutateReturning(() =>
      db
        .insert(youtubeAuth)
        .values({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        })
        .returning()
    );
  });

  const updateYoutubeAccessToken = Effect.fn("updateYoutubeAccessToken")(
    function* (tokens: { accessToken: string; expiresAt: Date }) {
      const existing = yield* makeDbCall(() =>
        db.query.youtubeAuth.findFirst()
      );

      if (!existing) {
        return yield* new NotFoundError({
          type: "updateYoutubeAccessToken",
          params: {},
          message: "No YouTube auth found to update",
        });
      }

      return yield* dbMutateReturning(
        () =>
          db
            .update(youtubeAuth)
            .set({
              accessToken: tokens.accessToken,
              expiresAt: tokens.expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(youtubeAuth.id, existing.id))
            .returning(),
        { type: "updateYoutubeAccessToken", params: {} }
      );
    }
  );

  const deleteYoutubeAuth = Effect.fn("deleteYoutubeAuth")(function* () {
    yield* makeDbCall(() => db.delete(youtubeAuth));
    return { success: true };
  });

  const getAiHeroAuth = Effect.fn("getAiHeroAuth")(function* () {
    const auth = yield* makeDbCall(() => db.query.aiHeroAuth.findFirst());
    return auth ?? null;
  });

  const upsertAiHeroAuth = Effect.fn("upsertAiHeroAuth")(function* (params: {
    accessToken: string;
    userId: string;
  }) {
    yield* makeDbCall(() => db.delete(aiHeroAuth));

    return yield* dbMutateReturning(() =>
      db
        .insert(aiHeroAuth)
        .values({
          accessToken: params.accessToken,
          userId: params.userId,
        })
        .returning()
    );
  });

  const deleteAiHeroAuth = Effect.fn("deleteAiHeroAuth")(function* () {
    yield* makeDbCall(() => db.delete(aiHeroAuth));
    return { success: true };
  });

  return {
    getLinks,
    createLink,
    deleteLink,
    getYoutubeAuth,
    upsertYoutubeAuth,
    updateYoutubeAccessToken,
    deleteYoutubeAuth,
    getAiHeroAuth,
    upsertAiHeroAuth,
    deleteAiHeroAuth,
  };
};

export class LinkAuthOperationsService extends Effect.Service<LinkAuthOperationsService>()(
  "LinkAuthOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createLinkAuthOperations(db);
    }),
  }
) {}
