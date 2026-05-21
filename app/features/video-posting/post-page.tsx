"use client";

import { useContext, useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { toast } from "sonner";
import { useFetcher } from "react-router";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2Icon,
  CopyIcon,
  LinkIcon,
  Loader2Icon,
  SparklesIcon,
  UploadIcon,
  XCircleIcon,
  YoutubeIcon,
  UnplugIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CourseStructure } from "@/components/video-context-panel";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import { PostPageOverwriteDialog } from "./post-page-overwrite-dialog";
import { ThumbnailSelector } from "./post-page-thumbnail-selector";
import { validateYoutubeTitle } from "./post-page-validation";
import { getAutoSelectThumbnailId } from "./auto-select-thumbnail";

const POST_TITLE_STORAGE_KEY = (videoId: string) => `post-title-${videoId}`;
const POST_DESCRIPTION_STORAGE_KEY = (videoId: string) =>
  `post-description-${videoId}`;
const YOUTUBE_VIDEO_ID_STORAGE_KEY = (videoId: string) =>
  `youtube-video-id-${videoId}`;

export function PostPage({
  videoId,
  isYoutubeAuthenticated,
  thumbnails,
  enabledFiles,
  enabledSections,
  includeTranscript,
  courseStructure,
  includeCourseStructure,
  chapters,
  pitchYoutubeTitle,
}: {
  videoId: string;
  isYoutubeAuthenticated: boolean;
  thumbnails: Array<{ id: string }>;
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  includeTranscript: boolean;
  courseStructure: CourseStructure | null;
  includeCourseStructure: boolean;
  chapters: SectionWithWordCount[];
  pitchYoutubeTitle: string | null;
}) {
  const [title, setTitle] = useLocalStorage(
    POST_TITLE_STORAGE_KEY(videoId),
    pitchYoutubeTitle ?? ""
  );
  const [description, setDescription] = useLocalStorage(
    POST_DESCRIPTION_STORAGE_KEY(videoId)
  );

  // AI generation state
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);

  // Confirmation dialog state
  const [confirmOverwriteField, setConfirmOverwriteField] = useState<
    "title" | "description" | null
  >(null);
  const [pendingGeneratedText, setPendingGeneratedText] = useState<string>("");
  const [currentFieldText, setCurrentFieldText] = useState<string>("");

  // Visibility state
  const [privacyStatus, setPrivacyStatus] = useState<"public" | "unlisted">(
    "unlisted"
  );

  // Upload state from global context
  const {
    uploads,
    startUpload: globalStartUpload,
    startExportUpload,
  } = useContext(UploadContext);

  // Find active upload for this video in global context
  const activeUpload = Object.values(uploads).find(
    (u) => u.videoId === videoId
  );

  // Historical youtubeVideoId from localStorage (hydration-safe: read in useEffect)
  const [storedYoutubeVideoId, setStoredYoutubeVideoId] = useState("");

  // Load storedYoutubeVideoId from localStorage on mount
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(
        YOUTUBE_VIDEO_ID_STORAGE_KEY(videoId)
      );
      if (stored) {
        setStoredYoutubeVideoId(stored);
      }
    }
  }, [videoId]);

  // Save youtubeVideoId to localStorage when upload succeeds in global context
  useEffect(() => {
    if (
      activeUpload?.status === "success" &&
      activeUpload.uploadType === "youtube" &&
      activeUpload.youtubeVideoId
    ) {
      localStorage.setItem(
        YOUTUBE_VIDEO_ID_STORAGE_KEY(videoId),
        activeUpload.youtubeVideoId
      );
      setStoredYoutubeVideoId(activeUpload.youtubeVideoId);
    }
  }, [activeUpload, videoId]);

  // Derive upload display state
  const uploadStatus: "idle" | "uploading" | "success" | "error" = activeUpload
    ? activeUpload.status === "retrying" || activeUpload.status === "waiting"
      ? "uploading"
      : activeUpload.status
    : storedYoutubeVideoId
      ? "success"
      : "idle";
  const uploadProgress = activeUpload?.progress ?? 0;
  const uploadError = activeUpload?.errorMessage ?? "";
  const youtubeVideoId =
    activeUpload?.uploadType === "youtube"
      ? (activeUpload.youtubeVideoId ?? storedYoutubeVideoId)
      : storedYoutubeVideoId;

  const generateContent = async (
    mode: "youtube-title" | "youtube-title-single" | "youtube-description"
  ) => {
    const transcriptEnabled =
      chapters.length > 0 ? enabledSections.size > 0 : includeTranscript;

    const response = await fetch(`/api/videos/${videoId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        enabledFiles: Array.from(enabledFiles),
        includeTranscript: transcriptEnabled,
        enabledSections: Array.from(enabledSections),
        courseStructure:
          includeCourseStructure && courseStructure
            ? courseStructure
            : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate content");
    }

    const result = await response.json();
    return result.text as string;
  };

  const handleGenerateTitle = async () => {
    setIsGeneratingTitle(true);
    try {
      const generatedText = await generateContent("youtube-title-single");
      if (title.trim()) {
        setCurrentFieldText(title);
        setPendingGeneratedText(generatedText);
        setConfirmOverwriteField("title");
      } else {
        setTitle(generatedText);
      }
    } catch (error) {
      console.error("Failed to generate title:", error);
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const handleGenerateDescription = async () => {
    setIsGeneratingDescription(true);
    try {
      const generatedText = await generateContent("youtube-description");
      if (description.trim()) {
        setCurrentFieldText(description);
        setPendingGeneratedText(generatedText);
        setConfirmOverwriteField("description");
      } else {
        setDescription(generatedText);
      }
    } catch (error) {
      console.error("Failed to generate description:", error);
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  const handleConfirmOverwrite = () => {
    if (confirmOverwriteField === "title") {
      setTitle(pendingGeneratedText);
    } else if (confirmOverwriteField === "description") {
      setDescription(pendingGeneratedText);
    }
    setConfirmOverwriteField(null);
    setPendingGeneratedText("");
    setCurrentFieldText("");
  };

  const handleCancelOverwrite = () => {
    setConfirmOverwriteField(null);
    setPendingGeneratedText("");
    setCurrentFieldText("");
  };

  const handleCopyFromPitch = () => {
    if (!pitchYoutubeTitle) return;

    if (title.trim()) {
      setCurrentFieldText(title);
      setPendingGeneratedText(pitchYoutubeTitle);
      setConfirmOverwriteField("title");
    } else {
      setTitle(pitchYoutubeTitle);
    }
  };

  const titleValidationError = validateYoutubeTitle(title);

  const [selectedThumbnailId, setSelectedThumbnailId] = useState<string | null>(
    () => getAutoSelectThumbnailId(thumbnails)
  );

  const deleteThumbnailFetcher = useFetcher();

  const handleDeleteThumbnail = (thumbnailId: string) => {
    if (!confirm("Delete this thumbnail?")) return;
    if (thumbnailId === selectedThumbnailId) {
      setSelectedThumbnailId(null);
    }
    deleteThumbnailFetcher.submit(null, {
      method: "post",
      action: `/api/thumbnails/${thumbnailId}/delete`,
    });
  };

  const [isCheckingExport, setIsCheckingExport] = useState(false);

  const handleUpload = async () => {
    if (
      !title.trim() ||
      !description.trim() ||
      !selectedThumbnailId ||
      titleValidationError
    )
      return;

    setIsCheckingExport(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/export-file-exists`);
      const { exists } = await res.json();

      if (exists) {
        globalStartUpload(
          videoId,
          title,
          description,
          privacyStatus,
          selectedThumbnailId
        );
        toast("Upload started", {
          description: `"${title}" is uploading to YouTube`,
        });
      } else {
        const exportId = startExportUpload(videoId, title);
        globalStartUpload(
          videoId,
          title,
          description,
          privacyStatus,
          selectedThumbnailId,
          exportId
        );
        toast("Export + upload started", {
          description: `"${title}" will export first, then upload to YouTube`,
        });
      }
    } catch {
      toast.error("Failed to check export status");
    } finally {
      setIsCheckingExport(false);
    }
  };

  const handleDisconnect = async () => {
    const response = await fetch("/api/auth/google/disconnect", {
      method: "POST",
    });
    if (response.ok) {
      window.location.reload();
    }
  };

  // Short link conversion state
  const [isConvertingShortLinks, setIsConvertingShortLinks] = useState(false);

  const handleConvertToShortLinks = async () => {
    const urlRegex = /https?:\/\/(?:www\.)?aihero\.dev[^\s)>]*/g;
    const shortLinkRegex = /^https?:\/\/(?:www\.)?aihero\.dev\/s\//;
    const matches = description.match(urlRegex);
    if (!matches || matches.length === 0) {
      toast("No aihero.dev links found", {
        description: "The description doesn't contain any aihero.dev URLs.",
      });
      return;
    }

    const uniqueUrls = [...new Set(matches)].filter(
      (url) => !shortLinkRegex.test(url)
    );

    if (uniqueUrls.length === 0) {
      toast("All links already converted", {
        description: "All aihero.dev links are already short links.",
      });
      return;
    }

    setIsConvertingShortLinks(true);
    try {
      let updatedDescription = description;
      for (const url of uniqueUrls) {
        const response = await fetch("/api/shortlinks/find-or-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            description: `YouTube (${title || "Untitled"})`,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create short link");
        }

        const { shortLinkUrl } = await response.json();
        updatedDescription = updatedDescription.replaceAll(url, shortLinkUrl);
      }

      setDescription(updatedDescription);
      toast("Links converted", {
        description: `Converted ${uniqueUrls.length} aihero.dev URL${uniqueUrls.length > 1 ? "s" : ""} to short links.`,
      });
    } catch (error) {
      console.error("Failed to convert short links:", error);
      toast.error("Failed to convert links", {
        description:
          error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsConvertingShortLinks(false);
    }
  };

  if (!isYoutubeAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <YoutubeIcon className="h-12 w-12 mx-auto mb-2 text-red-500" />
            <CardTitle>Connect YouTube Account</CardTitle>
            <CardDescription>
              Connect your YouTube account to upload videos directly from this
              app.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild>
              <a
                href={`/api/auth/google/initiate?returnTo=/videos/${videoId}/post`}
              >
                Connect YouTube Account
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="title">Title</Label>
            <div className="flex items-center gap-2">
              {pitchYoutubeTitle && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyFromPitch}
                >
                  <CopyIcon className="h-4 w-4" />
                  Copy from Pitch
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateTitle}
                disabled={isGeneratingTitle || isGeneratingDescription}
              >
                {isGeneratingTitle ? (
                  <>
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>
          <Textarea
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter video title..."
            className="text-lg min-h-[60px] resize-y"
          />
          {titleValidationError && (
            <p className="text-sm text-destructive">{titleValidationError}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="description">Description</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateDescription}
              disabled={isGeneratingTitle || isGeneratingDescription}
            >
              {isGeneratingDescription ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4" />
                  Generate
                </>
              )}
            </Button>
          </div>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter video description..."
            className="min-h-[300px] resize-y"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleConvertToShortLinks}
            disabled={isConvertingShortLinks || !description.trim()}
          >
            {isConvertingShortLinks ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <LinkIcon className="h-4 w-4" />
                Convert to short links
              </>
            )}
          </Button>
        </div>

        {/* Visibility */}
        <div className="flex items-center gap-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            value={privacyStatus}
            onValueChange={(value: "public" | "unlisted") =>
              setPrivacyStatus(value)
            }
          >
            <SelectTrigger id="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unlisted">Unlisted</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Thumbnail selection */}
        <ThumbnailSelector
          videoId={videoId}
          thumbnails={thumbnails}
          selectedThumbnailId={selectedThumbnailId}
          onSelectThumbnail={setSelectedThumbnailId}
          onDeleteThumbnail={handleDeleteThumbnail}
        />

        {/* Upload section */}
        <div className="space-y-3">
          <Button
            onClick={handleUpload}
            disabled={
              !!activeUpload ||
              isCheckingExport ||
              !title.trim() ||
              !description.trim() ||
              !selectedThumbnailId ||
              !!titleValidationError
            }
            className="w-full"
            size="lg"
          >
            {isCheckingExport ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Checking export...
              </>
            ) : uploadStatus === "uploading" ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <UploadIcon className="h-4 w-4" />
                Post to YouTube
              </>
            )}
          </Button>

          {!selectedThumbnailId && uploadStatus !== "uploading" && (
            <p className="text-sm text-muted-foreground text-center">
              {thumbnails.length === 0
                ? "Create and select a thumbnail before uploading."
                : "Select a thumbnail above before uploading."}
            </p>
          )}

          {/* Progress bar */}
          {uploadStatus === "uploading" && (
            <div className="space-y-1">
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {uploadProgress}%
              </p>
            </div>
          )}

          {/* Success state */}
          {uploadStatus === "success" && (
            <div className="flex flex-col items-center gap-2 text-green-500">
              <div className="flex items-center gap-2">
                <CheckCircle2Icon className="h-4 w-4" />
                <span className="text-sm">
                  Video uploaded successfully as {privacyStatus}
                </span>
              </div>
              {youtubeVideoId && (
                <a
                  href={`https://studio.youtube.com/video/${youtubeVideoId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-500 hover:underline"
                >
                  Open in YouTube Studio
                </a>
              )}
            </div>
          )}

          {/* Error state */}
          {uploadStatus === "error" && (
            <div className="flex items-center gap-2 text-destructive justify-center">
              <XCircleIcon className="h-4 w-4" />
              <span className="text-sm">{uploadError}</span>
            </div>
          )}
        </div>

        {/* Disconnect YouTube account */}
        <div className="pt-4 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleDisconnect}
          >
            <UnplugIcon className="h-4 w-4" />
            Disconnect YouTube Account
          </Button>
        </div>
      </div>

      <PostPageOverwriteDialog
        field={confirmOverwriteField}
        currentText={currentFieldText}
        pendingText={pendingGeneratedText}
        onConfirm={handleConfirmOverwrite}
        onCancel={handleCancelOverwrite}
      />
    </>
  );
}
