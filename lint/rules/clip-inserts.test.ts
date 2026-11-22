/* oxlint-disable local/clip-inserts */
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import clipInserts from "./clip-inserts.js";

RuleTester.describe = describe;
RuleTester.it = it;

const insert = { messageId: "insert" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
}).run("clip-inserts", clipInserts, {
  valid: [
    "await copyClipsOntoVideo(tx, { from, to });",
    "await db.insert(videos).values(rows);",
    "await db.insert(schema.videos).values(rows);",
    "await db.insert(clipsArchive).values(rows);",
    "await db.insert(other.clips).values(rows);",
    "await db.update(clips).set({ text });",
    "await db.select().from(clips);",
    "await db.delete(schema.overlays);",
    "await insertInChunks(tx, videos, rows);",
    "await insertInChunks(clips, videos, rows);",
    "await sql`INSERT INTO video (id) VALUES (${id})`;",
    "const q = 'INSERT INTO clips (id) VALUES (1)';",
    "const q = 'INSERT INTO clip_layer (id) VALUES (1)';",
    "const q = 'INSERT INTO \"course-video-manager_clip_layer\" (id) VALUES (1)';",
    "const q = 'SELECT * FROM clip WHERE id = 1';",
    "// db.insert(clips)\nconst x = 1;",
    "/* INSERT INTO clip (id) */\nconst x = 1;",
  ],
  invalid: [
    { code: "await db.insert(clips).values(rows);", errors: [insert] },
    { code: "await db.insert(schema.clips).values(rows);", errors: [insert] },
    { code: "await tx.insert(clipWebLinks).values(rows);", errors: [insert] },
    {
      code: "await tx.insert(schema.clipTranscriptWords).values(rows);",
      errors: [insert],
    },
    { code: "await db.insert(overlays).values(rows);", errors: [insert] },
    {
      code: "await db\n  .insert(\n    schema.clips\n  )\n  .values(rows);",
      errors: [insert],
    },
    { code: "await insertInChunks(tx, clips, rows);", errors: [insert] },
    {
      code: "await insertInChunks(tx, schema.overlays, rows);",
      errors: [insert],
    },
    { code: "const q = 'INSERT INTO clip (id) VALUES (1)';", errors: [insert] },
    {
      code: "const q = 'insert into clip_web_link(id) values (1)';",
      errors: [insert],
    },
    {
      code: "const q = 'INSERT INTO \"course-video-manager_clip_transcript_word\" (id) VALUES (1)';",
      errors: [insert],
    },
    {
      code: "await sql`insert into course-video-manager_overlay (id) values (${id})`;",
      errors: [insert],
    },
    {
      code: 'const q = `Insert Into "clip"(id) VALUES (1)`;',
      errors: [insert],
    },
  ],
});
