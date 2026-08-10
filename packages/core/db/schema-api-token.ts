import { sql } from "drizzle-orm";
import { text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createTable } from "./table-creator";

/**
 * The bearer tokens the deployed API authenticates against.
 *
 * Deliberately NOT in `schema-auth.ts`: that file holds the author's
 * credentials for third-party services (YouTube, Dropbox, AI Hero), which no
 * RPC endpoint may ever read. This table is the other direction — credentials
 * OTHER machines present to us.
 *
 * `id` is the token's public prefix (`cvm_a1b2c3d4`), so a presented token is
 * resolved with one primary-key lookup and never a scan on a user-supplied
 * hash. `tokenHash` is the SHA-256 of the whole token; the secret itself exists
 * only in the mint response and on the box the author put it on.
 */
export const apiTokens = createTable("api_token", {
  id: varchar("id", { length: 255 }).notNull().primaryKey(),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull(),
  expiresAt: timestamp("expires_at", {
    mode: "date",
    withTimezone: true,
  }).notNull(),
  revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
