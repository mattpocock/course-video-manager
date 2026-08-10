import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { useEffect, useState } from "react";
import { FileIcon, ClipboardIcon, CheckIcon } from "lucide-react";

type FilePreviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  videoId: string;
  filePath: string;
};

type FileContent =
  | { type: "text"; content: string }
  | { type: "image"; url: string }
  | { type: "binary"; message: string };

const TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
  ".sh",
  ".bash",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sql",
  ".graphql",
  ".vue",
  ".svelte",
];

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
];

function getFileType(filename: string): "text" | "image" | "binary" {
  const lowerFilename = filename.toLowerCase();

  if (IMAGE_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))) {
    return "image";
  }

  if (TEXT_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))) {
    return "text";
  }

  return "binary";
}

export function FilePreviewModal({
  isOpen,
  onClose,
  videoId,
  filePath,
}: FilePreviewModalProps) {
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFileContent(null);
      setError(null);
      return;
    }

    const fetchFileContent = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const fileType = getFileType(filePath);

        const response = await fetch(
          `/api/video-files/read?videoId=${encodeURIComponent(videoId)}&path=${encodeURIComponent(filePath)}`
        );

        if (!response.ok) {
          throw new Error("Failed to load file");
        }

        if (fileType === "text") {
          const text = await response.text();
          setFileContent({ type: "text", content: text });
        } else if (fileType === "image") {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setFileContent({ type: "image", url });
        } else {
          setFileContent({
            type: "binary",
            message: "Binary file cannot be previewed",
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load file content"
        );
      } finally {
        setIsLoading(false);
      }
    };

    fetchFileContent();
  }, [isOpen, videoId, filePath]);

  // Cleanup image URLs when modal closes or content changes
  useEffect(() => {
    return () => {
      if (fileContent?.type === "image") {
        URL.revokeObjectURL(fileContent.url);
      }
    };
  }, [fileContent]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 min-w-0">
              <FileIcon className="w-4 h-4 shrink-0" />
              <span className="truncate">{filePath}</span>
            </DialogTitle>
            {fileContent?.type === "text" && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground p-1 shrink-0"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fileContent.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    // Clipboard access denied
                  }
                }}
              >
                {copied ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  <ClipboardIcon className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-64">
              <p className="text-red-500">{error}</p>
            </div>
          )}

          {fileContent && !isLoading && !error && (
            <>
              {fileContent.type === "text" && (
                <pre className="text-xs font-mono bg-muted p-4 rounded-md overflow-auto max-h-[600px] whitespace-pre-wrap break-words">
                  {fileContent.content}
                </pre>
              )}

              {fileContent.type === "image" && (
                <div className="flex items-center justify-center p-4">
                  <img
                    src={fileContent.url}
                    alt={filePath}
                    className="max-w-full max-h-[600px] object-contain rounded-md"
                  />
                </div>
              )}

              {fileContent.type === "binary" && (
                <div className="flex flex-col items-center justify-center h-64 gap-2">
                  <FileIcon className="w-12 h-12 text-muted-foreground" />
                  <p className="text-muted-foreground">{fileContent.message}</p>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
