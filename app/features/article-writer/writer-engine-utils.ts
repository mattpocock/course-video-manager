import type { Mode } from "./types";

export type WriterFieldId =
  | "ai-hero-body"
  | "skills-changelog-body"
  | "newsletter-copy"
  | "video-body"
  | "video-description";

export const FIELD_MODES: Record<WriterFieldId, Mode[]> = {
  "ai-hero-body": ["article", "article-plan"],
  "skills-changelog-body": ["article", "article-plan"],
  "newsletter-copy": ["newsletter"],
  "video-body": ["article", "article-plan"],
  "video-description": ["seo-description-document"],
};

export const FIELD_LABELS: Record<WriterFieldId, string> = {
  "ai-hero-body": "AI Hero Body",
  "skills-changelog-body": "Skills Changelog Body",
  "newsletter-copy": "Newsletter Copy",
  "video-body": "Lesson Body",
  "video-description": "SEO Description",
};

export function getFieldMessagesStorageKey(
  videoId: string,
  fieldId: WriterFieldId,
  mode: Mode
): string {
  return `writer-field-messages-${videoId}-${fieldId}-${mode}`;
}

export function getFieldDocumentStorageKey(
  videoId: string,
  fieldId: WriterFieldId,
  mode: Mode
): string {
  return `writer-field-document-${videoId}-${fieldId}-${mode}`;
}

export function loadFieldMessages(
  videoId: string,
  fieldId: WriterFieldId,
  mode: Mode
): unknown[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const saved = localStorage.getItem(
      getFieldMessagesStorageKey(videoId, fieldId, mode)
    );
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveFieldMessages(
  videoId: string,
  fieldId: WriterFieldId,
  mode: Mode,
  messages: unknown[]
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getFieldMessagesStorageKey(videoId, fieldId, mode),
      JSON.stringify(messages)
    );
  } catch {
    // ignore
  }
}

export function loadFieldDocument(
  videoId: string,
  fieldId: WriterFieldId,
  mode: Mode
): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const saved = localStorage.getItem(
      getFieldDocumentStorageKey(videoId, fieldId, mode)
    );
    return saved ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveFieldDocument(
  videoId: string,
  fieldId: WriterFieldId,
  mode: Mode,
  document: string | undefined
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const key = getFieldDocumentStorageKey(videoId, fieldId, mode);
    if (document === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, document);
    }
  } catch {
    // ignore
  }
}

export function constrainModes(
  modes: Mode[],
  currentMode: Mode
): { mode: Mode; isConstrained: boolean } {
  if (modes.length === 0) return { mode: currentMode, isConstrained: false };
  if (modes.includes(currentMode))
    return { mode: currentMode, isConstrained: true };
  return { mode: modes[0]!, isConstrained: true };
}
