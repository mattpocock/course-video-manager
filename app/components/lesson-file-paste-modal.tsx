import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ClipboardIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useEffect, useState, useRef } from "react";

export function LessonFilePasteModal(props: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFiles: Array<{ path: string }>;
  onFileCreated?: (filename: string) => void;
  defaultTextFilename?: string;
}) {
  const fetcher = useFetcher<{ success: boolean; filename: string }>();
  const [filename, setFilename] = useState("");
  const [pastedContent, setPastedContent] = useState<{
    type: "text" | "image";
    data: string;
  } | null>(null);
  const pasteAreaRef = useRef<HTMLDivElement>(null);
  const filenameInputRef = useRef<HTMLInputElement>(null);

  // Generate smart sequential filename based on existing files
  const generateFilename = (type: "text" | "image"): string => {
    const existingFilenames = props.existingFiles.map((f) => f.path);

    if (type === "image") {
      // For images: diagram-1.png, diagram-2.png, etc.
      let counter = 1;
      while (existingFilenames.includes(`diagram-${counter}.png`)) {
        counter++;
      }
      return `diagram-${counter}.png`;
    } else {
      const baseName = props.defaultTextFilename || "notes.md";
      const ext = baseName.endsWith(".md") ? ".md" : "";
      const stem = ext ? baseName.slice(0, -ext.length) : baseName;
      if (!existingFilenames.includes(baseName)) {
        return baseName;
      }
      let counter = 1;
      while (existingFilenames.includes(`${stem}-${counter}${ext}`)) {
        counter++;
      }
      return `${stem}-${counter}${ext}`;
    }
  };

  // Reset form when modal opens
  useEffect(() => {
    if (props.open) {
      setFilename("");
      setPastedContent(null);
      // Focus the paste area when modal opens
      setTimeout(() => {
        pasteAreaRef.current?.focus();
      }, 100);
    }
  }, [props.open]);

  // Auto-generate filename when content is pasted and focus filename input
  useEffect(() => {
    if (pastedContent) {
      const generatedFilename = generateFilename(pastedContent.type);
      setFilename(generatedFilename);
      // Focus the filename input after a short delay to ensure it's rendered
      setTimeout(() => {
        filenameInputRef.current?.focus();
        filenameInputRef.current?.select();
      }, 100);
    }
  }, [pastedContent]);

  // Handle successful file creation
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      const createdFilename = fetcher.data.filename;
      props.onOpenChange(false);
      props.onFileCreated?.(createdFilename);
    }
  }, [fetcher.state, fetcher.data]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault();

    const clipboardData = e.clipboardData;

    // Check for images first
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          // Convert blob to base64
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result as string;
            setPastedContent({
              type: "image",
              data: base64,
            });
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }

    // If no image, get text
    const text = clipboardData.getData("text/plain");
    if (text) {
      setPastedContent({
        type: "text",
        data: text,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pastedContent || !filename) {
      return;
    }

    const formData = new FormData();
    formData.append("videoId", props.videoId);
    formData.append("filename", filename);
    formData.append("content", pastedContent.data);

    fetcher.submit(formData, {
      method: "post",
      action: "/api/lesson-files/create",
      encType: "multipart/form-data",
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste from Clipboard</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {!pastedContent ? (
            <div
              ref={pasteAreaRef}
              tabIndex={0}
              onPaste={handlePaste}
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 flex flex-col items-center justify-center gap-4 hover:border-muted-foreground/50 focus:border-primary focus:outline-none transition-colors cursor-pointer"
            >
              <ClipboardIcon className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  Click here and paste (Ctrl+V or Cmd+V)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Paste text or an image from your clipboard
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Pasted Content</Label>
                <div className="border rounded-lg p-4 bg-muted/50 overflow-hidden">
                  {pastedContent.type === "text" ? (
                    <pre className="text-sm whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
                      {pastedContent.data}
                    </pre>
                  ) : (
                    <img
                      src={pastedContent.data}
                      alt="Pasted image preview"
                      className="max-h-96 max-w-full object-contain rounded"
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPastedContent(null)}
                  className="text-xs"
                >
                  Clear and paste again
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="filename">Filename</Label>
                <Input
                  ref={filenameInputRef}
                  id="filename"
                  name="filename"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  required
                />
              </div>
            </>
          )}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            {pastedContent && (
              <Button
                type="submit"
                disabled={!filename || fetcher.state === "submitting"}
              >
                {fetcher.state === "submitting" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Create File"
                )}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
