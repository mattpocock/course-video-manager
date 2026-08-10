import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Edit2Icon, Trash2Icon } from "lucide-react";
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

const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
  return nodes.sort((a, b) => {
    // Directories come before files
    if (a.type === "directory" && b.type === "file") return -1;
    if (a.type === "file" && b.type === "directory") return 1;
    // Within same type, sort alphabetically
    return a.name.localeCompare(b.name);
  });
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

  // Sort all levels of the tree
  const sortTree = (nodes: TreeNode[]): TreeNode[] => {
    const sorted = sortNodes(nodes);
    for (const node of sorted) {
      if (node.children) {
        node.children = sortTree(node.children);
      }
    }
    return sorted;
  };

  return sortTree(root);
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
  onFileClick?: (filePath: string) => void;
  onEditFile?: (filePath: string) => void;
  onDeleteFile?: (filePath: string) => void;
  depth: number;
  disabled?: boolean;
};

const FileTreeNode = ({
  node,
  enabledFiles,
  onToggle,
  onFileClick,
  onEditFile,
  onDeleteFile,
  depth,
  disabled,
}: FileTreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(true);

  if (node.type === "file") {
    const isChecked = enabledFiles.has(node.path);

    return (
      <div
        className="flex items-center gap-2 py-1 hover:bg-accent/50 rounded px-2 group"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <Checkbox
          checked={isChecked}
          disabled={disabled}
          onCheckedChange={(checked) => {
            onToggle([node.path], !!checked);
          }}
        />
        <button
          className="text-sm flex-1 min-w-0 truncate text-left hover:underline cursor-pointer"
          onClick={() => onFileClick?.(node.path)}
        >
          {node.name}
        </button>
        {node.size !== undefined && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            ({formatFileSize(node.size)})
          </span>
        )}
        {onEditFile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={() => onEditFile(node.path)}
          >
            <Edit2Icon className="h-3 w-3" />
          </Button>
        )}
        {onDeleteFile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={() => onDeleteFile(node.path)}
          >
            <Trash2Icon className="h-3 w-3" />
          </Button>
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
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <Checkbox
          checked={checkboxState}
          disabled={disabled}
          onCheckedChange={(checked) => {
            onToggle(descendantPaths, !!checked);
          }}
        />
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 flex-1 min-w-0">
            {/* <ChevronRightIcon
              className={`size-4 text-muted-foreground flex-shrink-0 transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
            /> */}
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
            onFileClick={onFileClick}
            onEditFile={onEditFile}
            onDeleteFile={onDeleteFile}
            depth={depth + 1}
            disabled={disabled}
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
  onFileClick?: (filePath: string) => void;
  onEditFile?: (filePath: string) => void;
  onDeleteFile?: (filePath: string) => void;
  disabled?: boolean;
};

export const FileTree = ({
  files,
  enabledFiles,
  onEnabledFilesChange,
  onFileClick,
  onEditFile,
  onDeleteFile,
  disabled,
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
    <div className="max-h-96 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          enabledFiles={enabledFiles}
          onToggle={handleToggle}
          onFileClick={onFileClick}
          onEditFile={onEditFile}
          onDeleteFile={onDeleteFile}
          depth={0}
          disabled={disabled}
        />
      ))}
    </div>
  );
};
