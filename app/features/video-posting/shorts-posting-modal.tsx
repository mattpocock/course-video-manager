"use client";

import { useContext, useState } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkIcon, Loader2Icon, SendIcon, SparklesIcon } from "lucide-react";
import { UploadContext } from "@/features/upload-manager/upload-context";

type PostState = "idle" | "checking-export";

const SHORTS_TITLE_KEY = (videoId: string) => `shorts-post-title-${videoId}`;
const SHORTS_DESC_KEY = (videoId: string) =>
  `shorts-post-description-${videoId}`;
const SHORTS_CAPTION_KEY = (videoId: string) =>
  `shorts-post-caption-${videoId}`;

export function ShortsPostingModal({
  open,
  onOpenChange,
  videoId,
  videoTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  videoTitle: string;
}) {
  const [title, setTitle] = useLocalStorage(
    SHORTS_TITLE_KEY(videoId),
    videoTitle
  );
  const [description, setDescription] = useLocalStorage(
    SHORTS_DESC_KEY(videoId),
    ""
  );
  const [caption, setCaption] = useLocalStorage(
    SHORTS_CAPTION_KEY(videoId),
    ""
  );

  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [shortLinkUrl, setShortLinkUrl] = useState<string | null>(null);
  const [isCreatingShortLink, setIsCreatingShortLink] = useState(false);

  const {
    startYoutubeShortsUpload,
    startSocialUpload,
    startRenderVerticalUpload,
  } = useContext(UploadContext);

  const [postState, setPostState] = useState<PostState>("idle");

  const handleGenerate = async (
    mode: "youtube-title-single" | "youtube-description" | "social-caption",
    setter: (text: string) => void,
    setLoading: (loading: boolean) => void
  ) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          enabledFiles: [],
          includeTranscript: true,
          enabledSections: [],
        }),
      });

      if (!response.ok) throw new Error("Generation failed");

      const result = await response.json();
      setter(result.text as string);
    } catch {
      toast.error("Failed to generate text");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShortLink = async () => {
    setIsCreatingShortLink(true);
    try {
      const response = await fetch("/api/shortlinks/find-or-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://aihero.dev/skills/subscribe",
          description: `TikTok (${videoTitle})`,
        }),
      });

      if (!response.ok) throw new Error("Failed to create short link");

      const { shortLinkUrl } = await response.json();
      setShortLinkUrl(shortLinkUrl);
      await navigator.clipboard.writeText(shortLinkUrl);
      toast("Short link copied to clipboard");
    } catch {
      toast.error("Failed to create short link");
    } finally {
      setIsCreatingShortLink(false);
    }
  };

  const handlePost = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error("Title and description are required");
      return;
    }

    setPostState("checking-export");
    try {
      const res = await fetch(`/api/videos/${videoId}/vertical-export-exists`);
      if (!res.ok) throw new Error("Failed to check export status");
      const { exists } = (await res.json()) as { exists: boolean };

      let exportId: string | undefined;
      if (!exists) {
        exportId = startRenderVerticalUpload(videoId, title.trim());
      }

      startYoutubeShortsUpload(
        videoId,
        title.trim(),
        description.trim(),
        exportId
      );

      if (caption.trim()) {
        startSocialUpload(videoId, title.trim(), caption.trim(), exportId);
      }

      onOpenChange(false);
      if (exportId) {
        toast("Export + post started", {
          description: `"${title.trim()}" will export first, then post`,
        });
      } else {
        toast(
          caption.trim()
            ? "YouTube Shorts + Buffer posting started"
            : "YouTube Shorts upload started"
        );
      }
    } catch {
      toast.error("Failed to check export status");
    } finally {
      setPostState("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post Short</DialogTitle>
          <DialogDescription>
            Post to YouTube Shorts and Buffer (TikTok / X / Bluesky). The
            exported vertical video will be used.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="shorts-title">Title</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleGenerate(
                    "youtube-title-single",
                    setTitle,
                    setIsGeneratingTitle
                  )
                }
                disabled={isGeneratingTitle}
              >
                {isGeneratingTitle ? (
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                ) : (
                  <SparklesIcon className="h-3 w-3" />
                )}
              </Button>
            </div>
            <Input
              id="shorts-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Video title..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="shorts-description">YouTube Description</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleGenerate(
                    "youtube-description",
                    setDescription,
                    setIsGeneratingDescription
                  )
                }
                disabled={isGeneratingDescription}
              >
                {isGeneratingDescription ? (
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                ) : (
                  <SparklesIcon className="h-3 w-3" />
                )}
              </Button>
            </div>
            <Textarea
              id="shorts-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="YouTube description..."
              className="min-h-[80px] resize-y"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="shorts-caption">Caption / Hashtags</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  handleGenerate(
                    "social-caption",
                    setCaption,
                    setIsGeneratingCaption
                  )
                }
                disabled={isGeneratingCaption}
              >
                {isGeneratingCaption ? (
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                ) : (
                  <SparklesIcon className="h-3 w-3" />
                )}
              </Button>
            </div>
            <Textarea
              id="shorts-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Short-form caption with #hashtags..."
              className="min-h-[80px] resize-y"
            />
            <p className="text-xs text-muted-foreground">
              Posted to TikTok / X / Bluesky via Buffer. Leave empty to skip
              Buffer posting.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateShortLink}
              disabled={isCreatingShortLink}
            >
              {isCreatingShortLink ? (
                <Loader2Icon className="h-3 w-3 animate-spin" />
              ) : (
                <LinkIcon className="h-3 w-3" />
              )}
              AI Hero Short Link
            </Button>
            {shortLinkUrl && (
              <span className="text-xs text-muted-foreground truncate">
                {shortLinkUrl}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handlePost}
            disabled={
              !title.trim() ||
              !description.trim() ||
              postState === "checking-export"
            }
          >
            {postState === "checking-export" ? (
              <>
                <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                Checking export...
              </>
            ) : (
              <>
                <SendIcon className="w-4 h-4 mr-2" />
                Post Short
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
