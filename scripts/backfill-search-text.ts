import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../app/db/schema";
import { extractSceneText } from "../app/packages/extract-scene-text";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const db = drizzle(url, { schema });

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
console.log(`Backfilled ${snapshotCount} snapshot(s).`);

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
console.log(`Backfilled ${diagramCount} diagram(s).`);

process.exit(0);
