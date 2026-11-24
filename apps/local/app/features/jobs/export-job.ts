import path from "node:path";
import { Schema } from "effect";

export const EXPORT_JOB_KIND = "export";

export const EXPORT_EVENTS = {
  exported: "exported",
} as const;

export const ExportedEvent = Schema.Struct({ path: Schema.String });

export const exportJobLogPath = (repoRoot: string, jobId: string) =>
  path.join(repoRoot, ".data", "logs", "jobs", `${jobId}.jsonl`);
