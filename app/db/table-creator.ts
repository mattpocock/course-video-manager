import { pgTableCreator } from "drizzle-orm/pg-core";

export const createTable = pgTableCreator(
  (name) => `course-video-manager_${name}`
);
