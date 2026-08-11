import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { apiTokens } from "../db/schema-api-token";
import {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  generateApiToken,
  parseApiToken,
  tokenHashesMatch,
} from "../lib/api-token.server";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors";
import { DrizzleService, type Database } from "./drizzle-service.server";

const tryDb = <A>(fn: () => Promise<A>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/** A token as the author sees it in the list: everything except the secret. */
export interface ApiTokenSummary {
  readonly id: string;
  readonly name: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

/** The mint response — the ONE moment the secret exists outside the author's box. */
export interface MintedApiToken extends ApiTokenSummary {
  readonly secret: string;
}

/** Who a presented token belongs to. Deliberately carries no privileges: v1 tokens are unscoped. */
export interface AuthenticatedApiToken {
  readonly id: string;
  readonly name: string;
}

export interface MintApiTokenParams {
  readonly name: string;
  /** Defaults to 90 days out. */
  readonly expiresAt?: Date;
  /** Test seam: pin the creation timestamp so list ordering is assertable. */
  readonly createdAt?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toSummary = (row: typeof apiTokens.$inferSelect): ApiTokenSummary => ({
  id: row.id,
  name: row.name,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  lastUsedAt: row.lastUsedAt,
  createdAt: row.createdAt,
});

export const createApiTokenOperations = (db: Database) => {
  /**
   * Mint a token. The returned `secret` is the only copy that will ever exist:
   * the row holds its SHA-256 and nothing more.
   */
  const mint = (params: MintApiTokenParams) =>
    Effect.gen(function* () {
      const generated = generateApiToken();
      const now = params.createdAt ?? new Date();
      const expiresAt =
        params.expiresAt ??
        new Date(now.getTime() + API_TOKEN_DEFAULT_EXPIRY_DAYS * DAY_MS);

      const [row] = yield* tryDb(() =>
        db
          .insert(apiTokens)
          .values({
            id: generated.id,
            tokenHash: generated.tokenHash,
            name: params.name,
            expiresAt,
            createdAt: now,
          })
          .returning()
      );

      return { ...toSummary(row!), secret: generated.secret } as MintedApiToken;
    });

  /** Every token ever minted, newest first. Revoked and expired ones stay listed. */
  const list = () =>
    tryDb(() =>
      db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt))
    ).pipe(Effect.map((rows) => rows.map(toSummary)));

  /**
   * Cut a box off. Idempotent: a token already revoked keeps its first
   * timestamp, so the list still says when trust ended.
   */
  const revoke = (id: string) =>
    Effect.gen(function* () {
      const [existing] = yield* tryDb(() =>
        db.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1)
      );
      if (!existing) {
        return yield* new NotFoundError({ type: "apiToken", params: { id } });
      }
      if (existing.revokedAt !== null) return toSummary(existing);

      const [row] = yield* tryDb(() =>
        db
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(eq(apiTokens.id, id))
          .returning()
      );
      return toSummary(row!);
    });

  /**
   * Resolve a presented token, or answer `null`.
   *
   * `null` covers malformed, unknown, mismatched, expired and revoked alike —
   * one answer for every failure, so the caller CANNOT accidentally leak which
   * one it was. On success `lastUsedAt` advances; on failure nothing is
   * written, so a rejected token leaves no trace that it was tried.
   */
  const authenticate = (raw: string) =>
    Effect.gen(function* () {
      const parsed = parseApiToken(raw);
      if (parsed === null) return null;

      const [row] = yield* tryDb(() =>
        db.select().from(apiTokens).where(eq(apiTokens.id, parsed.id)).limit(1)
      );
      if (!row) return null;
      if (!tokenHashesMatch(row.tokenHash, parsed.tokenHash)) return null;
      if (row.revokedAt !== null) return null;

      const now = new Date();
      if (row.expiresAt.getTime() <= now.getTime()) return null;

      yield* tryDb(() =>
        db
          .update(apiTokens)
          .set({ lastUsedAt: now })
          .where(eq(apiTokens.id, row.id))
      );

      return { id: row.id, name: row.name } satisfies AuthenticatedApiToken;
    });

  return { mint, list, revoke, authenticate };
};

export class ApiTokenOperationsService extends Effect.Service<ApiTokenOperationsService>()(
  "ApiTokenOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createApiTokenOperations(db);
    }),
  }
) {}
