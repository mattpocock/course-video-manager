import { lookupPath, type VfsDirNode, type VfsLeafNode } from "./vfs-tree";
import type {
  CourseLeaf,
  LessonLeaf,
  SectionLeaf,
  SegmentsLeaf,
  TimelineLeaf,
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
  const sorted = [...node.children.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  for (const [name, child] of sorted) {
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
  switch (fileName) {
    case "course.json":
      matchCourse(filePath, data as CourseLeaf, re, hits);
      break;
    case "section.json":
      matchSection(filePath, data as SectionLeaf, re, hits);
      break;
    case "lesson.json":
      matchLesson(filePath, data as LessonLeaf, re, hits);
      break;
    case "video.json":
      matchVideo(filePath, data as VideoLeaf, re, hits);
      break;
    case "segments.json":
      matchSegments(filePath, data as SegmentsLeaf, re, hits);
      break;
    case "timeline.json":
      matchTimeline(filePath, data as TimelineLeaf, re, hits);
      break;
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

const matchSegments = (
  filePath: string,
  leaf: SegmentsLeaf,
  re: RegExp,
  hits: GrepHit[]
): void => {
  for (let i = 0; i < leaf.length; i++) {
    const seg = leaf[i]!;
    if (re.test(seg.title)) {
      hits.push({ path: filePath, locator: `[${i}]`, text: seg.title });
    } else if (re.test(seg.description)) {
      hits.push({ path: filePath, locator: `[${i}]`, text: seg.description });
    }
  }
};

const matchTimeline = (
  filePath: string,
  leaf: TimelineLeaf,
  re: RegExp,
  hits: GrepHit[]
): void => {
  for (let i = 0; i < leaf.length; i++) {
    const item = leaf[i]!;
    if (item.type === "chapter") {
      if (re.test(item.name)) {
        hits.push({ path: filePath, locator: `[${i}]`, text: item.name });
      }
    } else {
      if (re.test(item.text)) {
        hits.push({ path: filePath, locator: `[${i}]`, text: item.text });
      }
    }
  }
};
