import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: TreeNode[];
};

const buildTree = (files: FileMetadata[]): TreeNode[] => {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === part);

      if (!node) {
        node = {
          name: part,
          path,
          type: isFile ? "file" : "directory",
          size: isFile ? file.size : undefined,
          children: isFile ? undefined : [],
        };
        current.push(node);
      }

      if (!isFile && node.children) {
        current = node.children;
      }
    }
  }

  return root;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getAllDescendantPaths = (node: TreeNode): string[] => {
  if (node.type === "file") {
    return [node.path];
  }

  const paths: string[] = [];
  if (node.children) {
    for (const child of node.children) {
      paths.push(...getAllDescendantPaths(child));
    }
  }
  return paths;
};

type FileTreeNodeProps = {
  node: TreeNode;
  enabledFiles: Set<string>;
  onToggle: (paths: string[], enabled: boolean) => void;
  depth: number;
};

const FileTreeNode = ({
  node,
  enabledFiles,
  onToggle,
  depth,
}: FileTreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(true);

  if (node.type === "file") {
    const isChecked = enabledFiles.has(node.path);

    return (
      <div
        className="flex items-center gap-2 py-1 hover:bg-accent/50 rounded px-2"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <Checkbox
          checked={isChecked}
          onCheckedChange={(checked) => {
            onToggle([node.path], !!checked);
          }}
        />
        <span className="text-sm flex-1 min-w-0 truncate">{node.name}</span>
        {node.size !== undefined && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            ({formatFileSize(node.size)})
          </span>
        )}
      </div>
    );
  }

  const descendantPaths = getAllDescendantPaths(node);
  const enabledDescendants = descendantPaths.filter((p) => enabledFiles.has(p));
  const allEnabled = enabledDescendants.length === descendantPaths.length;
  const someEnabled = enabledDescendants.length > 0;
  const checkboxState = allEnabled
    ? true
    : someEnabled
    ? "indeterminate"
    : false;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className="flex items-center gap-2 py-1 hover:bg-accent/50 rounded px-2"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <Checkbox
          checked={checkboxState}
          onCheckedChange={(checked) => {
            onToggle(descendantPaths, !!checked);
          }}
        />
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRightIcon
              className={`size-4 text-muted-foreground flex-shrink-0 transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
            />
            <span className="text-sm truncate">{node.name}</span>
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        {node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            enabledFiles={enabledFiles}
            onToggle={onToggle}
            depth={depth + 1}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

type FileTreeProps = {
  files: FileMetadata[];
  enabledFiles: Set<string>;
  onEnabledFilesChange: (enabledFiles: Set<string>) => void;
};

export const FileTree = ({
  files,
  enabledFiles,
  onEnabledFilesChange,
}: FileTreeProps) => {
  const tree = buildTree(files);

  const handleToggle = (paths: string[], enabled: boolean) => {
    const newEnabledFiles = new Set(enabledFiles);

    for (const path of paths) {
      if (enabled) {
        newEnabledFiles.add(path);
      } else {
        newEnabledFiles.delete(path);
      }
    }

    onEnabledFilesChange(newEnabledFiles);
  };

  return (
    <div className="border rounded-lg p-2 max-h-96 overflow-y-auto">
      <div className="text-sm font-medium mb-2 px-2">Files in Context</div>
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          enabledFiles={enabledFiles}
          onToggle={handleToggle}
          depth={0}
        />
      ))}
    </div>
  );
};
