"use client";

import { useState } from "react";
import { ArrowLeft, ClipboardPaste, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FileTree } from "@/components/FileTree";
import { cn } from "@/lib/utils";
import type { SourceView } from "./inline-context-strip";
import { fmtTok } from "./inline-context-strip";

// ─── FullCover ──────────────────────────────────────────────────────────────

export function FullCover({
  title,
  onBack,
  children,
  widthClassName = "max-w-2xl",
}: {
  title: React.ReactNode;
  onBack: () => void;
  children: React.ReactNode;
  /** Max width of the centered content column. */
  widthClassName?: string;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex h-11 flex-none items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex-1" />
      </div>
      <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted min-h-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto p-4", widthClassName)}>{children}</div>
      </div>
    </div>
  );
}

// ─── ContextView ────────────────────────────────────────────────────────────

export interface ContextViewProps {
  sources: SourceView[];
  totalTokens: number;
  activeKey: string;
  onTab: (key: string) => void;
  onBack: () => void;
  // Mutation callbacks
  onToggleItem: (itemId: string) => void;
  onToggleSource: (sourceKey: string) => void;
  onSetSourceEnabled: (sourceKey: string, enabledIds: Set<string>) => void;
  // Memory editing
  memoryText: string;
  onMemoryChange: (text: string) => void;
  // Link editing
  links: Array<{
    id: string;
    url: string;
    title: string;
    description?: string;
  }>;
  onAddLink: (link: {
    url: string;
    title: string;
    description?: string;
  }) => void;
  onRemoveLink: (id: string) => void;
  // Repo files
  onAddFileFromClipboard?: () => void;
}

export function ContextView({
  sources,
  totalTokens,
  activeKey,
  onTab,
  onBack,
  onToggleItem,
  onToggleSource,
  onSetSourceEnabled,
  memoryText,
  onMemoryChange,
  links,
  onAddLink,
  onRemoveLink,
  onAddFileFromClipboard,
}: ContextViewProps) {
  const activeSource = sources.find((s) => s.key === activeKey);

  return (
    <FullCover
      title={
        <span>
          Context{" "}
          <span className="font-normal text-muted-foreground">
            {fmtTok(totalTokens)} tokens
          </span>
        </span>
      }
      onBack={onBack}
      widthClassName="max-w-4xl"
    >
      {/* Tab row */}
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {sources.map((source) => (
          <button
            key={source.key}
            onClick={() => onTab(source.key)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              source.key === activeKey
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {source.label}
            <span className="text-xs text-muted-foreground">
              {fmtTok(source.tokens)}
            </span>
          </button>
        ))}
      </div>

      {/* Active tab body */}
      {activeSource && (
        <TabBody
          source={activeSource}
          onToggleItem={onToggleItem}
          onToggleSource={onToggleSource}
          onSetSourceEnabled={onSetSourceEnabled}
          memoryText={memoryText}
          onMemoryChange={onMemoryChange}
          links={links}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
          onAddFileFromClipboard={onAddFileFromClipboard}
        />
      )}
    </FullCover>
  );
}

// ─── Tab body router ────────────────────────────────────────────────────────

function TabBody({
  source,
  onToggleItem,
  onToggleSource,
  onSetSourceEnabled,
  memoryText,
  onMemoryChange,
  links,
  onAddLink,
  onRemoveLink,
  onAddFileFromClipboard,
}: {
  source: SourceView;
  onToggleItem: (itemId: string) => void;
  onToggleSource: (sourceKey: string) => void;
  onSetSourceEnabled: (sourceKey: string, enabledIds: Set<string>) => void;
  memoryText: string;
  onMemoryChange: (text: string) => void;
  links: ContextViewProps["links"];
  onAddLink: ContextViewProps["onAddLink"];
  onRemoveLink: ContextViewProps["onRemoveLink"];
  onAddFileFromClipboard?: () => void;
}) {
  switch (source.key) {
    case "transcript":
      return (
        <TranscriptTab
          source={source}
          onToggleItem={onToggleItem}
          onToggleSource={onToggleSource}
        />
      );
    case "files":
      return (
        <FilesTab
          source={source}
          onSetSourceEnabled={onSetSourceEnabled}
          onAddFileFromClipboard={onAddFileFromClipboard}
        />
      );
    case "links":
      return (
        <LinksTab
          source={source}
          links={links}
          onToggleItem={onToggleItem}
          onToggleSource={onToggleSource}
          onAddLink={onAddLink}
          onRemoveLink={onRemoveLink}
        />
      );
    case "fields":
      return (
        <FieldsTab
          source={source}
          onToggleItem={onToggleItem}
          onToggleSource={onToggleSource}
        />
      );
    case "beats":
      return <BeatsTab source={source} onToggleSource={onToggleSource} />;
    case "courseStructure":
      return (
        <CourseStructureTab source={source} onToggleSource={onToggleSource} />
      );
    case "memory":
      return (
        <MemoryTab
          source={source}
          memoryText={memoryText}
          onMemoryChange={onMemoryChange}
          onToggleSource={onToggleSource}
        />
      );
    default:
      return null;
  }
}

// ─── Transcript tab ─────────────────────────────────────────────────────────

function TranscriptTab({
  source,
  onToggleItem,
  onToggleSource,
}: {
  source: SourceView;
  onToggleItem: (itemId: string) => void;
  onToggleSource: (sourceKey: string) => void;
}) {
  return (
    <div className="space-y-3">
      <MasterToggle source={source} onToggleSource={onToggleSource} />
      {source.items.map((item) => (
        <label key={item.id} className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={item.on}
            onCheckedChange={() => onToggleItem(item.id)}
          />
          <span className="flex-1 text-sm">{item.label}</span>
          <span className="text-xs text-muted-foreground">
            {fmtTok(item.tokens)}
          </span>
        </label>
      ))}
    </div>
  );
}

// ─── Files tab ──────────────────────────────────────────────────────────────

function FilesTab({
  source,
  onSetSourceEnabled,
  onAddFileFromClipboard,
}: {
  source: SourceView;
  onSetSourceEnabled: (sourceKey: string, enabledIds: Set<string>) => void;
  onAddFileFromClipboard?: () => void;
}) {
  const files = source.items.map((item) => ({
    path: item.id,
    size: item.tokens * 4,
    defaultEnabled: item.on,
  }));

  const enabledFiles = new Set(
    source.items.filter((i) => i.on).map((i) => i.id)
  );

  return (
    <div className="space-y-3">
      {onAddFileFromClipboard && (
        <Button variant="outline" size="sm" onClick={onAddFileFromClipboard}>
          <ClipboardPaste className="mr-1.5 size-3.5" />
          Add from clipboard
        </Button>
      )}
      <FileTree
        files={files}
        enabledFiles={enabledFiles}
        onEnabledFilesChange={(next) => onSetSourceEnabled(source.key, next)}
      />
    </div>
  );
}

// ─── Links tab ──────────────────────────────────────────────────────────────

function LinksTab({
  source,
  links,
  onToggleItem,
  onToggleSource,
  onAddLink,
  onRemoveLink,
}: {
  source: SourceView;
  links: ContextViewProps["links"];
  onToggleItem: (itemId: string) => void;
  onToggleSource: (sourceKey: string) => void;
  onAddLink: ContextViewProps["onAddLink"];
  onRemoveLink: ContextViewProps["onRemoveLink"];
}) {
  const [adding, setAdding] = useState(false);

  const itemById = new Map(source.items.map((i) => [i.id, i]));

  return (
    <div className="space-y-3">
      <MasterToggle source={source} onToggleSource={onToggleSource} />

      {links.map((link) => {
        const item = itemById.get(link.id);
        return (
          <div
            key={link.id}
            className="flex items-start gap-2 rounded-md border p-3"
          >
            <Checkbox
              checked={item?.on ?? false}
              onCheckedChange={() => onToggleItem(link.id)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-sm font-medium">{link.title}</div>
              {link.description && (
                <div className="text-xs text-muted-foreground">
                  {link.description}
                </div>
              )}
              <div className="truncate text-xs text-muted-foreground">
                {link.url}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              onClick={() => onRemoveLink(link.id)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        );
      })}

      {adding ? (
        <AddLinkForm
          onAdd={(link) => {
            onAddLink(link);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 size-3.5" />
          Add link
        </Button>
      )}
    </div>
  );
}

function AddLinkForm({
  onAdd,
  onCancel,
}: {
  onAdd: (link: { url: string; title: string; description?: string }) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const isValidUrl = (() => {
    if (!url.trim()) return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  })();

  const canSubmit = url.trim() !== "" && title.trim() !== "" && isValidUrl;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onAdd({
      url: url.trim(),
      title: title.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="add-link-url" className="text-xs">
          URL
        </Label>
        <Input
          id="add-link-url"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-link-title" className="text-xs">
          Title
        </Label>
        <Input
          id="add-link-title"
          placeholder="Page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-link-desc" className="text-xs">
          Description (optional)
        </Label>
        <Input
          id="add-link-desc"
          placeholder="Brief description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          Add
        </Button>
      </div>
    </form>
  );
}

// ─── Page fields tab ────────────────────────────────────────────────────────

function FieldsTab({
  source,
  onToggleItem,
  onToggleSource,
}: {
  source: SourceView;
  onToggleItem: (itemId: string) => void;
  onToggleSource: (sourceKey: string) => void;
}) {
  return (
    <div className="space-y-3">
      <MasterToggle source={source} onToggleSource={onToggleSource} />
      {source.items.map((item) => (
        <div key={item.id} className="rounded-md border p-3">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={item.on}
              onCheckedChange={() => onToggleItem(item.id)}
            />
            <span className="flex-1 text-sm font-medium">{item.label}</span>
            <span className="text-xs text-muted-foreground">
              {fmtTok(item.tokens)}
            </span>
          </label>
          {item.text && (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {item.text}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Beats tab ─────────────────────────────────────────────────────────────

function BeatsTab({
  source,
  onToggleSource,
}: {
  source: SourceView;
  onToggleSource: (sourceKey: string) => void;
}) {
  const previewText = source.items.map((item) => item.text).join("\n");

  return (
    <div className="space-y-3">
      <MasterToggle source={source} onToggleSource={onToggleSource} />
      {previewText && (
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">
          {previewText}
        </pre>
      )}
    </div>
  );
}

// ─── Course structure tab ───────────────────────────────────────────────────

function CourseStructureTab({
  source,
  onToggleSource,
}: {
  source: SourceView;
  onToggleSource: (sourceKey: string) => void;
}) {
  const previewText = source.items.map((item) => item.text).join("\n");

  return (
    <div className="space-y-3">
      <MasterToggle source={source} onToggleSource={onToggleSource} />
      {previewText && (
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">
          {previewText}
        </pre>
      )}
    </div>
  );
}

// ─── Memory tab ─────────────────────────────────────────────────────────────

function MemoryTab({
  source,
  memoryText,
  onMemoryChange,
  onToggleSource,
}: {
  source: SourceView;
  memoryText: string;
  onMemoryChange: (text: string) => void;
  onToggleSource: (sourceKey: string) => void;
}) {
  return (
    <div className="space-y-3">
      <MasterToggle source={source} onToggleSource={onToggleSource} />
      <Textarea
        value={memoryText}
        onChange={(e) => onMemoryChange(e.target.value)}
        placeholder="Persistent notes for the AI..."
        className="min-h-[200px] text-sm"
      />
    </div>
  );
}

// ─── Shared: master toggle ──────────────────────────────────────────────────

function MasterToggle({
  source,
  onToggleSource,
}: {
  source: SourceView;
  onToggleSource: (sourceKey: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 border-b pb-2">
      <Checkbox
        checked={
          source.check === "indeterminate" ? "indeterminate" : source.check
        }
        onCheckedChange={() => onToggleSource(source.key)}
      />
      <span className="text-sm font-medium">Include all</span>
    </label>
  );
}
