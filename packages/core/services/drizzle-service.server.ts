import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../db/schema.js";
import { resolveDatabaseUrl } from "../db/database-url.js";
import { Effect } from "effect";

export type DrizzleDB = NodePgDatabase<typeof schema>;

export type Database =
  | DrizzleDB
  | NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

export class DrizzleService extends Effect.Service<DrizzleService>()(
  "DrizzleService",
  {
    effect: Effect.gen(function* () {
      // The pooled connection string. Migrations use the direct one instead —
      // see @/db/database-url.
      const url = resolveDatabaseUrl();
      if (!url) {
        return yield* Effect.die(
          new Error("DATABASE_URL is not set in environment variables")
        );
      }
      return drizzle(new Pool({ connectionString: url }), {
        schema,
      }) as DrizzleDB;
    }),
  }
) {}
