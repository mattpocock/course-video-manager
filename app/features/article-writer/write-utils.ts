import type { DocumentAgentMessage, Mode } from "./types";

export const partsToText = (parts: DocumentAgentMessage["parts"]) => {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      return "";
    })
    .join("");
};

export const modeToLabel: Record<Mode, string> = {
  article: "Article",
  "article-plan": "Article Plan",
  project: "Project Steps",
  "skill-building": "Skill Building Steps",
  "style-guide-skill-building": "Style Guide Pass - Skill Building",
  "style-guide-project": "Style Guide Pass - Project",
  "seo-description": "SEO Description",
  "seo-description-document": "SEO Description",
  "youtube-title": "YouTube Title",
  "youtube-thumbnail": "YouTube Thumbnail",
  "youtube-description": "YouTube Description",
  newsletter: "Newsletter",
  "interview-prep": "Interview Me (Pre-Interview)",
  interview: "Interview Me (Live)",
  brainstorming: "Brainstorming",
  "scoping-discussion": "Scoping Discussion",
  "scoping-document": "Scoping Document",
};

export const MODE_STORAGE_KEY = "article-writer-mode";
export const RECENT_MODES_STORAGE_KEY = "article-writer-recent-modes";

export const MAX_RECENT_MODES = 3;

export const loadRecentModes = (): Mode[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const saved = localStorage.getItem(RECENT_MODES_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as Mode[];
    }
  } catch {
    // ignore
  }
  return [];
};

export const saveRecentMode = (mode: Mode): void => {
  if (typeof localStorage === "undefined") return;
  try {
    const recent = loadRecentModes().filter((m) => m !== mode);
    recent.unshift(mode);
    localStorage.setItem(
      RECENT_MODES_STORAGE_KEY,
      JSON.stringify(recent.slice(0, MAX_RECENT_MODES))
    );
  } catch {
    // ignore
  }
};
export const MODEL_STORAGE_KEY = "article-writer-model";
export const COURSE_STRUCTURE_STORAGE_KEY =
  "article-writer-include-course-structure";
export const MEMORY_ENABLED_STORAGE_KEY = "article-writer-memory-enabled";
export const BEATS_ENABLED_STORAGE_KEY = "article-writer-beats-enabled";

export const getMessagesStorageKey = (videoId: string, mode: Mode) =>
  `article-writer-messages-${videoId}-${mode}`;

export const loadMessagesFromStorage = (
  videoId: string,
  mode: Mode
): DocumentAgentMessage[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const saved = localStorage.getItem(getMessagesStorageKey(videoId, mode));
    if (saved) {
      return JSON.parse(saved) as DocumentAgentMessage[];
    }
  } catch (e) {
    console.error("Failed to load messages from localStorage:", e);
  }
  return [];
};

export const saveMessagesToStorage = (
  videoId: string,
  mode: Mode,
  messages: DocumentAgentMessage[]
) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getMessagesStorageKey(videoId, mode),
      JSON.stringify(messages)
    );
  } catch (e) {
    console.error("Failed to save messages to localStorage:", e);
  }
};

export const getDocumentStorageKey = (videoId: string, mode: Mode) =>
  `article-writer-document-${videoId}-${mode}`;

export const loadDocumentFromStorage = (
  videoId: string,
  mode: Mode
): string | undefined => {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const saved = localStorage.getItem(getDocumentStorageKey(videoId, mode));
    return saved ?? undefined;
  } catch {
    return undefined;
  }
};

export const saveDocumentToStorage = (
  videoId: string,
  mode: Mode,
  document: string | undefined
) => {
  if (typeof localStorage === "undefined") return;
  try {
    const key = getDocumentStorageKey(videoId, mode);
    if (document === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, document);
    }
  } catch {
    // ignore
  }
};

export const formatConversationAsQA = (messages: DocumentAgentMessage[]) => {
  const qaMessages: string[] = [];

  for (const message of messages) {
    const text = partsToText(message.parts);
    if (!text) continue;

    if (message.role === "assistant") {
      qaMessages.push(`Q: ${text}`);
    } else if (message.role === "user") {
      qaMessages.push(`A: ${text}`);
    }
  }

  return qaMessages.join("\n\n");
};
