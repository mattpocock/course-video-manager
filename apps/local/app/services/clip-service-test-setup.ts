/**
 * Shared test setup for the clip-service-*.test.ts integration tests.
 * A PGlite-backed ClipService, reset before every test, plus the insertion-point and timeline helpers.
 */

import { beforeAll, beforeEach } from "vitest";
import { createDirectClipService } from "@/test-utils/direct-clip-service";
import type {
  ClipService,
  FrontendId,
  DatabaseId,
  FrontendTimelineItem,
  FrontendInsertionPoint,
} from "./clip-service";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";

export let testDb: TestDb;
export let clipService: ClipService;

/** The Storage Root these tests' Footage paths are under (never read from disk). */
export const TEST_STORAGE_ROOT = "/mnt/t";

export function setupClipServiceTests() {
  beforeAll(async () => {
    process.env.STORAGE_ROOTS = TEST_STORAGE_ROOT;
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);

    clipService = createDirectClipService(testDb as any);
  });
}

export const getItems = async (
  clipService: ClipService,
  videoId: string
): Promise<FrontendTimelineItem[]> => {
  const timeline = await clipService.getTimeline(videoId);
  return timeline.map((item): FrontendTimelineItem => {
    if (item.type === "clip") {
      return {
        type: "on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    } else {
      return {
        type: "chapter-on-database",
        frontendId: item.data.id as FrontendId,
        databaseId: item.data.id as DatabaseId,
      };
    }
  });
};

export const afterClip = (id: string): FrontendInsertionPoint => ({
  type: "after-clip",
  frontendClipId: id as FrontendId,
});

export const afterSection = (id: string): FrontendInsertionPoint => ({
  type: "after-chapter",
  frontendChapterId: id as FrontendId,
});

export const start: FrontendInsertionPoint = { type: "start" };
