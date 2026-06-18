import { lookupPath, type VfsDirNode } from "./vfs-tree";

type LeafData = Record<string, unknown> | unknown[];

const isTimeline = (data: unknown[]): boolean =>
  data.length > 0 &&
  typeof data[0] === "object" &&
  data[0] !== null &&
  "type" in data[0] &&
  ((data[0] as Record<string, unknown>).type === "chapter" ||
    (data[0] as Record<string, unknown>).type === "clip");

const INDEX_RE = /^\.\[(\d+)\]$/;
const SLICE_RE = /^\.\[(\d+):(\d+)\]$/;
const FIELD_RE = /^\.([a-zA-Z_]\w*)$/;

export const applyFilter = (
  data: LeafData,
  filter: string
): unknown | string => {
  const indexMatch = filter.match(INDEX_RE);
  if (indexMatch) {
    if (!Array.isArray(data)) {
      return `cat: ${filter}: not an array file`;
    }
    const i = parseInt(indexMatch[1]!, 10);
    if (i < 0 || i >= data.length) {
      return `cat: ${filter}: index out of range`;
    }
    return data[i];
  }

  const negativeIndexMatch = filter.match(/^\.\[(-\d+)\]$/);
  if (negativeIndexMatch) {
    if (!Array.isArray(data)) {
      return `cat: ${filter}: not an array file`;
    }
    return `cat: ${filter}: index out of range`;
  }

  const sliceMatch = filter.match(SLICE_RE);
  if (sliceMatch) {
    if (!Array.isArray(data)) {
      return `cat: ${filter}: not an array file`;
    }
    const i = parseInt(sliceMatch[1]!, 10);
    const j = parseInt(sliceMatch[2]!, 10);
    return data.slice(i, j);
  }

  if (filter === "names") {
    if (!Array.isArray(data) || !isTimeline(data)) {
      return "cat: names: only applies to timeline.json";
    }
    return data
      .filter(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "chapter"
      )
      .map((item: unknown) => (item as Record<string, string>).name);
  }

  if (filter === "text") {
    if (!Array.isArray(data) || !isTimeline(data)) {
      return "cat: text: only applies to timeline.json";
    }
    return data
      .filter(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "clip"
      )
      .map((item: unknown) => (item as Record<string, string>).text);
  }

  if (filter === "count") {
    if (!Array.isArray(data)) {
      return "cat: count: not an array file";
    }
    if (isTimeline(data)) {
      let chapters = 0;
      let clips = 0;
      for (const item of data) {
        if (
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "chapter"
        ) {
          chapters++;
        } else {
          clips++;
        }
      }
      return { chapters, clips };
    }
    return { items: data.length };
  }

  const fieldMatch = filter.match(FIELD_RE);
  if (fieldMatch) {
    if (Array.isArray(data)) {
      return `cat: ${filter}: not an object file`;
    }
    const field = fieldMatch[1]!;
    if (!(field in data)) {
      return `cat: ${filter}: no such field`;
    }
    return data[field];
  }

  return `cat: bad filter: '${filter}'`;
};

export const vfsCat = (
  root: VfsDirNode,
  absolutePath: string,
  filter?: string
): string => {
  const result = lookupPath(root, absolutePath);

  if (result.type === "not-found") {
    return `cat: ${absolutePath}: No such file or directory`;
  }

  if (result.type === "dir" || result.type === "root") {
    return `cat: ${absolutePath}: Is a directory`;
  }

  const leafData = result.node.data;

  if (filter) {
    const filtered = applyFilter(leafData, filter);
    if (typeof filtered === "string") {
      return filtered;
    }
    return JSON.stringify(filtered, null, 2);
  }

  return JSON.stringify(leafData, null, 2);
};
