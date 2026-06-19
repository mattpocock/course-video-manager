import { lookupPath, type VfsDirNode, type VfsLeafNode } from "./vfs-tree";
import type {
  CourseLeaf,
  LessonLeaf,
  SectionLeaf,
  VideoLeaf,
} from "./vfs-schemas";

type GrepMode = "content" | "files";

type GrepHit = {
  path: string;
  locator: string;
  text: string;
};

export const vfsGrep = (
  root: VfsDirNode,
  pattern: string,
  scopePath: string,
  mode: GrepMode = "content"
): string => {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return `grep: invalid regex: '${pattern}'`;
  }

  const lookup = lookupPath(root, scopePath);
  if (lookup.type === "not-found") {
    return `grep: ${scopePath}: No such file or directory`;
  }

  const hits: GrepHit[] = [];
  const startNode =
    lookup.type === "root" || lookup.type === "dir" ? lookup.node : null;

  if (lookup.type === "file") {
    const filePath = scopePath;
    collectFileHits(filePath, lookup.node.name, lookup.node.data, re, hits);
  } else if (startNode) {
    walkTree(startNode, scopePath === "/" ? "" : scopePath, re, hits);
  }

  if (mode === "files") {
    const paths = [...new Set(hits.map((h) => h.path))];
    return paths.join("\n");
  }

  return hits.map((h) => `${h.path}${h.locator}: ${h.text}`).join("\n");
};

const walkTree = (
  node: VfsDirNode,
  currentPath: string,
  re: RegExp,
  hits: GrepHit[]
): void => {
  for (const [name, child] of node.children) {
    const childPath = `${currentPath}/${name}`;
    if (child.kind === "dir") {
      walkTree(child, childPath, re, hits);
    } else {
      collectFileHits(childPath, child.name, child.data, re, hits);
    }
  }
};

const collectFileHits = (
  filePath: string,
  fileName: string,
  data: VfsLeafNode["data"],
  re: RegExp,
  hits: GrepHit[]
): void => {
  if (fileName === "course.json") {
    matchCourse(filePath, data as CourseLeaf, re, hits);
  } else if (fileName === "section.json") {
    matchSection(filePath, data as SectionLeaf, re, hits);
  } else if (fileName === "lesson.json") {
    matchLesson(filePath, data as LessonLeaf, re, hits);
  } else if (fileName === "video.json") {
    matchVideo(filePath, data as VideoLeaf, re, hits);
  } else if (fileName === "_members.json") {
    matchMembers(filePath, data as unknown[], re, hits);
  } else if (fileName.endsWith(".clip.json")) {
    matchClipFile(filePath, data as Record<string, unknown>, re, hits);
  } else if (fileName.endsWith(".chapter.json")) {
    matchChapterFile(filePath, data as Record<string, unknown>, re, hits);
  } else {
    matchSegmentFile(filePath, data as Record<string, unknown>, re, hits);
  }
};

const matchCourse = (
  filePath: string,
  leaf: CourseLeaf,
  re: RegExp,
  hits: GrepHit[]
): void => {
  if (re.test(leaf.name)) {
    hits.push({ path: filePath, locator: ":name", text: leaf.name });
  }
};

const matchSection = (
  filePath: string,
  leaf: SectionLeaf,
  re: RegExp,
  hits: GrepHit[]
): void => {
  const dirPath = filePath
    .replace(/\/section\.json$/, "")
    .split("/")
    .pop()!;
  if (re.test(dirPath)) {
    hits.push({ path: filePath, locator: " [path]", text: dirPath });
  }
  if (re.test(leaf.description)) {
    hits.push({
      path: filePath,
      locator: ":description",
      text: leaf.description,
    });
  }
};

const matchLesson = (
  filePath: string,
  leaf: LessonLeaf,
  re: RegExp,
  hits: GrepHit[]
): void => {
  const dirPath = filePath
    .replace(/\/lesson\.json$/, "")
    .split("/")
    .pop()!;
  if (re.test(dirPath)) {
    hits.push({ path: filePath, locator: " [path]", text: dirPath });
  }
  if (re.test(leaf.title)) {
    hits.push({ path: filePath, locator: ":title", text: leaf.title });
  }
  if (re.test(leaf.description)) {
    hits.push({
      path: filePath,
      locator: ":description",
      text: leaf.description,
    });
  }
};

const matchVideo = (
  filePath: string,
  _leaf: VideoLeaf,
  re: RegExp,
  hits: GrepHit[]
): void => {
  const dirPath = filePath
    .replace(/\/video\.json$/, "")
    .split("/")
    .pop()!;
  if (re.test(dirPath)) {
    hits.push({ path: filePath, locator: " [path]", text: dirPath });
  }
};

const matchMembers = (
  filePath: string,
  data: unknown[],
  re: RegExp,
  hits: GrepHit[]
): void => {
  for (let i = 0; i < data.length; i++) {
    const member = data[i] as Record<string, unknown>;
    for (const [key, value] of Object.entries(member)) {
      if (key === "id" || key === "type") continue;
      if (typeof value === "string" && re.test(value)) {
        hits.push({ path: filePath, locator: `[${i}]`, text: value });
        break;
      }
    }
  }
};

const matchClipFile = (
  filePath: string,
  data: Record<string, unknown>,
  re: RegExp,
  hits: GrepHit[]
): void => {
  if (typeof data.text === "string" && re.test(data.text)) {
    hits.push({ path: filePath, locator: ":text", text: data.text });
  }
};

const matchChapterFile = (
  filePath: string,
  data: Record<string, unknown>,
  re: RegExp,
  hits: GrepHit[]
): void => {
  if (typeof data.name === "string" && re.test(data.name)) {
    hits.push({ path: filePath, locator: ":name", text: data.name });
  }
};

const matchSegmentFile = (
  filePath: string,
  data: Record<string, unknown>,
  re: RegExp,
  hits: GrepHit[]
): void => {
  if (typeof data.title === "string" && re.test(data.title)) {
    hits.push({ path: filePath, locator: ":title", text: data.title });
  } else if (
    typeof data.description === "string" &&
    re.test(data.description)
  ) {
    hits.push({
      path: filePath,
      locator: ":description",
      text: data.description,
    });
  }
};
