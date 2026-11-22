import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { extractSceneText } from "@cvm/core/lib/extract-scene-text";
import { scriptDrizzle } from "./script-database-url";
import { log } from "@/packages/log";

const { db } = scriptDrizzle();

let snapshotCount = 0;
const snapshots = await db
  .select({
    id: schema.diagramSnapshots.id,
    scene: schema.diagramSnapshots.scene,
  })
  .from(schema.diagramSnapshots);

for (const snap of snapshots) {
  const searchText = extractSceneText(snap.scene);
  await db
    .update(schema.diagramSnapshots)
    .set({ searchText })
    .where(eq(schema.diagramSnapshots.id, snap.id));
  snapshotCount++;
}
log.info(`Backfilled ${snapshotCount} snapshot(s).`);

let diagramCount = 0;
const allDiagrams = await db
  .select({
    id: schema.diagrams.id,
    headScene: schema.diagrams.headScene,
  })
  .from(schema.diagrams);

for (const diag of allDiagrams) {
  const searchText = extractSceneText(diag.headScene);
  await db
    .update(schema.diagrams)
    .set({ searchText })
    .where(eq(schema.diagrams.id, diag.id));
  diagramCount++;
}
log.info(`Backfilled ${diagramCount} diagram(s).`);

process.exit(0);
