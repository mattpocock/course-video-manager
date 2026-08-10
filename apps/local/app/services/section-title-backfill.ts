import { sections } from "@/db/schema";
import type { DrizzleDB } from "@/services/drizzle-service.server";

export async function assertNoBlankSectionTitles(db: DrizzleDB) {
  const allSections = await db
    .select({ id: sections.id, title: sections.title })
    .from(sections);

  const blanks = allSections.filter((s) => s.title === "");

  if (blanks.length > 0) {
    throw new Error(
      `Post-condition failed: ${blanks.length} section(s) have blank title: ${blanks.map((s) => s.id).join(", ")}`
    );
  }
}
