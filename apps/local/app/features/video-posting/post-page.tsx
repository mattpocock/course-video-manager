"use client";

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
import {
  selectCanPost,
  selectGenerateRequest,
  selectMetadataProblem,
  selectUploadDisplay,
  selectYoutubeDraftStatus,
  type postPageReducer,
} from "./post-page-reducer";
import { usePostPageReducer } from "./use-post-page-reducer";

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
  youtubeDraft,
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
  youtubeDraft: { title: string | null; description: string | null };
}) {
  const { state, dispatch, activeUpload } = usePostPageReducer({
    videoId,
    thumbnails,
    pitchYoutubeTitle,
    youtubeDraft,
  });
  const { title, description } = state;
  const draftStatus = selectYoutubeDraftStatus(state);

  const upload = selectUploadDisplay(state, activeUpload);
  const metadataProblem = selectMetadataProblem(title, description);
  const { generating, pendingOverwrite } = state.fields;
  const isGeneratingTitle = generating?.field === "title";
  const isGeneratingDescription = generating?.field === "description";
  const { selectedThumbnailId, privacyStatus } = state;
  const isCheckingExport = state.checkingExport !== null;

  const generate = (field: postPageReducer.Field) =>
    dispatch({
      type: "generate-clicked",
      field,
      currentText: field === "title" ? title : description,
      askToReplace: true,
      request: selectGenerateRequest(field, {
        videoId,
        enabledFiles,
        enabledSections,
        includeTranscript,
        hasChapters: chapters.length > 0,
        courseStructure,
        includeCourseStructure,
      }),
    });

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
                  onClick={() =>
                    pitchYoutubeTitle &&
                    dispatch({
                      type: "copy-from-pitch-clicked",
                      pitchTitle: pitchYoutubeTitle,
                    })
                  }
                >
                  <CopyIcon className="h-4 w-4" />
                  Copy from Pitch
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => generate("title")}
                disabled={generating !== null}
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
            onChange={(e) =>
              dispatch({ type: "title-edited", title: e.target.value })
            }
            placeholder="Enter video title..."
            className="text-lg min-h-[60px] resize-y"
          />
          {metadataProblem?.field === "title" && (
            <p className="text-sm text-destructive">
              {metadataProblem.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="description">Description</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => generate("description")}
              disabled={generating !== null}
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
            onChange={(e) =>
              dispatch({
                type: "description-edited",
                description: e.target.value,
              })
            }
            placeholder="Enter video description..."
            className="min-h-[300px] resize-y"
          />
          {metadataProblem?.field === "description" && (
            <p className="text-sm text-destructive">
              {metadataProblem.message}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: "convert-short-links-clicked" })}
            disabled={!!state.convertingShortLinks || !description.trim()}
          >
            {state.convertingShortLinks ? (
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

        {draftStatus === "failed" ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-md border border-destructive p-3 text-sm text-destructive"
          >
            <span>
              The title and description are not saved: {state.draftSaveError}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: "youtube-draft-retry-clicked" })}
            >
              Retry
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {draftStatus === "saving" ? "Saving…" : "Saved"}
          </p>
        )}

        {/* Visibility */}
        <div className="flex items-center gap-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            value={privacyStatus}
            onValueChange={(value: postPageReducer.PrivacyStatus) =>
              dispatch({
                type: "privacy-status-selected",
                privacyStatus: value,
              })
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
          onSelectThumbnail={(thumbnailId) =>
            dispatch({ type: "thumbnail-selected", thumbnailId })
          }
          onDeleteThumbnail={(thumbnailId) =>
            dispatch({ type: "thumbnail-delete-clicked", thumbnailId })
          }
        />

        {/* Upload section */}
        <div className="space-y-3">
          <Button
            onClick={() => dispatch({ type: "post-clicked" })}
            disabled={
              !!activeUpload || isCheckingExport || !selectCanPost(state)
            }
            className="w-full"
            size="lg"
          >
            {isCheckingExport ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Checking export...
              </>
            ) : upload.status === "uploading" ? (
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

          {!selectedThumbnailId && upload.status !== "uploading" && (
            <p className="text-sm text-muted-foreground text-center">
              {thumbnails.length === 0
                ? "Create and select a thumbnail before uploading."
                : "Select a thumbnail above before uploading."}
            </p>
          )}

          {/* Progress bar */}
          {upload.status === "uploading" && (
            <div className="space-y-1">
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-300"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {upload.progress}%
              </p>
            </div>
          )}

          {/* Success state */}
          {upload.status === "success" && (
            <div className="flex flex-col items-center gap-2 text-green-500">
              <div className="flex items-center gap-2">
                <CheckCircle2Icon className="h-4 w-4" />
                <span className="text-sm">
                  Video uploaded successfully as {privacyStatus}
                </span>
              </div>
              {upload.youtubeVideoId && (
                <a
                  href={`https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`}
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
          {upload.status === "error" && (
            <div className="flex items-center gap-2 text-destructive justify-center">
              <XCircleIcon className="h-4 w-4" />
              <span className="text-sm">{upload.error}</span>
            </div>
          )}
        </div>

        {/* Disconnect YouTube account */}
        <div className="pt-4 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => dispatch({ type: "disconnect-clicked" })}
          >
            <UnplugIcon className="h-4 w-4" />
            Disconnect YouTube Account
          </Button>
        </div>
      </div>

      <PostPageOverwriteDialog
        field={pendingOverwrite?.field ?? null}
        currentText={pendingOverwrite?.currentText ?? ""}
        pendingText={pendingOverwrite?.pendingText ?? ""}
        onConfirm={() => dispatch({ type: "overwrite-confirmed" })}
        onCancel={() => dispatch({ type: "overwrite-cancelled" })}
      />
    </>
  );
}
