/**
 * Normalize a VFS path against an immutable per-thread anchor (the current course).
 *
 * - Bare / relative / `.` paths resolve against the anchor.
 * - `/` = catalogue root (lists courses).
 * - `..` from the anchor = `/courses` (sibling courses).
 * - `../` paths resolve relative to `/courses`.
 * - All output paths are absolute; no trailing slashes.
 */
export const normalizePath = (raw: string, anchor: string): string => {
  const trimmed = raw.trim();

  let segments: string[];

  if (trimmed === "" || trimmed === ".") {
    return anchor;
  }

  if (trimmed.startsWith("/")) {
    segments = trimmed.split("/");
  } else if (trimmed === ".." || trimmed.startsWith("../")) {
    const parent = anchor.split("/").slice(0, -1);
    const rest = trimmed === ".." ? [] : trimmed.slice(3).split("/");
    segments = [...parent, ...rest];
  } else if (trimmed.startsWith("./")) {
    segments = [...anchor.split("/"), ...trimmed.slice(2).split("/")];
  } else {
    segments = [...anchor.split("/"), ...trimmed.split("/")];
  }

  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  return resolved.length === 0 ? "/" : "/" + resolved.join("/");
};
