import type { CourseAgentUIMessage } from "./types";

export type StoredThread = {
  id: string;
  updatedAt: number;
  contextTokens: number;
  messages: CourseAgentUIMessage[];
  versionId?: string;
};

const THREADS_KEY = "course-agent-threads";
const ARCHIVED_KEY = "course-agent-archived-threads";

export function loadThreads(courseId: string): StoredThread[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${THREADS_KEY}:${courseId}`);
    if (raw) return JSON.parse(raw) as StoredThread[];
  } catch {
    // ignore
  }
  return [];
}

export function saveThreads(courseId: string, threads: StoredThread[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${THREADS_KEY}:${courseId}`, JSON.stringify(threads));
  } catch {
    // ignore
  }
}

export function loadArchived(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return [];
}

export function saveArchived(ids: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}
