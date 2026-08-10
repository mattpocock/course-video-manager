/**
 * Pure-function document editing engine for applying incremental edits
 * to a markdown document string. Used by client-side tool execution
 * in the edit document flow.
 */

export type ReplaceEdit = {
  type: "replace";
  old_text: string;
  new_text: string;
};

export type InsertAfterEdit = {
  type: "insert_after";
  anchor: string;
  new_text: string;
};

export type RewriteEdit = {
  type: "rewrite";
  new_text: string;
};

export type DocumentEdit = ReplaceEdit | InsertAfterEdit | RewriteEdit;

export type ApplyEditsSuccess = { document: string };
export type ApplyEditsError = { error: string };
export type ApplyEditsResult = ApplyEditsSuccess | ApplyEditsError;

/**
 * Apply a sequence of edits to a document string.
 * Each edit is applied against the document as modified by prior edits.
 * Returns either the updated document or an error.
 */
export function applyEdits(
  document: string,
  edits: DocumentEdit[]
): ApplyEditsResult {
  let current = document;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    const result = applySingleEdit(current, edit, i);
    if ("error" in result) {
      return result;
    }
    current = result.document;
  }

  return { document: current };
}

function applySingleEdit(
  document: string,
  edit: DocumentEdit,
  editIndex: number
): ApplyEditsResult {
  switch (edit.type) {
    case "replace":
      return applyReplace(document, edit, editIndex);
    case "insert_after":
      return applyInsertAfter(document, edit, editIndex);
    case "rewrite":
      return { document: edit.new_text };
  }
}

function applyReplace(
  document: string,
  edit: ReplaceEdit,
  editIndex: number
): ApplyEditsResult {
  // Try exact match first
  const exactResult = findUniqueMatch(document, edit.old_text);

  if (exactResult.type === "found") {
    return {
      document:
        document.slice(0, exactResult.index) +
        edit.new_text +
        document.slice(exactResult.index + edit.old_text.length),
    };
  }

  if (exactResult.type === "multiple") {
    return {
      error: `Edit ${editIndex}: replace failed — old_text matched ${exactResult.count} locations (must be unique). Text: "${truncate(edit.old_text, 80)}"`,
    };
  }

  // Whitespace-insensitive fallback
  const wsResult = findUniqueWhitespaceInsensitiveMatch(
    document,
    edit.old_text
  );

  if (wsResult.type === "found") {
    return {
      document:
        document.slice(0, wsResult.index) +
        edit.new_text +
        document.slice(wsResult.index + wsResult.matchLength),
    };
  }

  if (wsResult.type === "multiple") {
    return {
      error: `Edit ${editIndex}: replace failed — old_text matched ${wsResult.count} locations with whitespace-insensitive matching (must be unique). Text: "${truncate(edit.old_text, 80)}"`,
    };
  }

  return {
    error: `Edit ${editIndex}: replace failed — old_text not found in document. Text: "${truncate(edit.old_text, 80)}"`,
  };
}

function applyInsertAfter(
  document: string,
  edit: InsertAfterEdit,
  editIndex: number
): ApplyEditsResult {
  // Try exact match first
  const exactResult = findUniqueMatch(document, edit.anchor);

  if (exactResult.type === "found") {
    const insertPos = exactResult.index + edit.anchor.length;
    return {
      document:
        document.slice(0, insertPos) +
        edit.new_text +
        document.slice(insertPos),
    };
  }

  if (exactResult.type === "multiple") {
    return {
      error: `Edit ${editIndex}: insert_after failed — anchor matched ${exactResult.count} locations (must be unique). Anchor: "${truncate(edit.anchor, 80)}"`,
    };
  }

  // Whitespace-insensitive fallback
  const wsResult = findUniqueWhitespaceInsensitiveMatch(document, edit.anchor);

  if (wsResult.type === "found") {
    const insertPos = wsResult.index + wsResult.matchLength;
    return {
      document:
        document.slice(0, insertPos) +
        edit.new_text +
        document.slice(insertPos),
    };
  }

  if (wsResult.type === "multiple") {
    return {
      error: `Edit ${editIndex}: insert_after failed — anchor matched ${wsResult.count} locations with whitespace-insensitive matching (must be unique). Anchor: "${truncate(edit.anchor, 80)}"`,
    };
  }

  return {
    error: `Edit ${editIndex}: insert_after failed — anchor not found in document. Anchor: "${truncate(edit.anchor, 80)}"`,
  };
}

type MatchResult =
  | { type: "found"; index: number }
  | { type: "not_found" }
  | { type: "multiple"; count: number };

function findUniqueMatch(document: string, search: string): MatchResult {
  const firstIndex = document.indexOf(search);
  if (firstIndex === -1) {
    return { type: "not_found" };
  }

  const secondIndex = document.indexOf(search, firstIndex + 1);
  if (secondIndex !== -1) {
    // Count all matches
    let count = 2;
    let pos = secondIndex + 1;
    while ((pos = document.indexOf(search, pos)) !== -1) {
      count++;
      pos++;
    }
    return { type: "multiple", count };
  }

  return { type: "found", index: firstIndex };
}

type WhitespaceMatchResult =
  | { type: "found"; index: number; matchLength: number }
  | { type: "not_found" }
  | { type: "multiple"; count: number };

function findUniqueWhitespaceInsensitiveMatch(
  document: string,
  search: string
): WhitespaceMatchResult {
  const pattern = buildWhitespaceInsensitivePattern(search);
  const regex = new RegExp(pattern, "g");

  const matches: { index: number; length: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(document)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }

  if (matches.length === 0) {
    return { type: "not_found" };
  }

  if (matches.length > 1) {
    return { type: "multiple", count: matches.length };
  }

  return {
    type: "found",
    index: matches[0]!.index,
    matchLength: matches[0]!.length,
  };
}

/**
 * Build a regex pattern that matches the search string with flexible whitespace.
 * Non-whitespace characters are matched literally; whitespace runs match any whitespace.
 */
function buildWhitespaceInsensitivePattern(search: string): string {
  // Split on whitespace boundaries, escape each non-whitespace part
  const parts = search.split(/(\s+)/);
  return parts
    .map((part) => {
      if (/^\s+$/.test(part)) {
        return "\\s+";
      }
      return escapeRegex(part);
    })
    .join("");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}
