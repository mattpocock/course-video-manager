import { lookupPath, type VfsDirNode } from "./vfs-tree";

export const vfsLs = (root: VfsDirNode, absolutePath: string): string => {
  const result = lookupPath(root, absolutePath);

  if (result.type === "not-found") {
    return `ls: ${absolutePath}: No such file or directory`;
  }

  if (result.type === "file") {
    return `ls: ${absolutePath}: Not a directory`;
  }

  const dir = result.node;
  const entries: string[] = [];

  for (const [name, child] of dir.children) {
    if (child.kind === "dir") {
      const ghost = child.ghost ? "   [ghost]" : "";
      entries.push(`${name}/${ghost}`);
    } else {
      entries.push(name);
    }
  }

  return entries.join("\n");
};
