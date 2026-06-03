import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import * as schema from "@/db/schema";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

let snapshotPath: string | undefined;

export default async function setup(project: TestProject) {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  const { apply } = await pushSchema(schema, db as any);
  await apply();

  const blob = await pglite.dumpDataDir("none");
  const buffer = Buffer.from(await blob.arrayBuffer());
  await pglite.close();

  snapshotPath = join(tmpdir(), `pglite-snapshot-${process.pid}.tar`);
  writeFileSync(snapshotPath, buffer);

  project.provide("pgliteSnapshotPath", snapshotPath);
}

export async function teardown() {
  if (snapshotPath) {
    try {
      unlinkSync(snapshotPath);
    } catch {}
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    pgliteSnapshotPath: string;
  }
}
