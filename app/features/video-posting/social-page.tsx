"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2Icon, SparklesIcon, CopyIcon, LinkIcon } from "lucide-react";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import type { CourseStructure } from "@/components/video-context-panel";

const SOCIAL_CAPTION_STORAGE_KEY = (videoId: string) =>
  `social-caption-${videoId}`;

export interface SocialPagePanelProps {
  videoId: string;
  chapters: SectionWithWordCount[];
  enabledSections: Set<string>;
  enabledFiles: Set<string>;
  includeTranscript: boolean;
  includeCourseStructure: boolean;
  courseStructure: CourseStructure | null;
  showSocialShareButtons: boolean;
}

export const SocialPagePanel = (props: SocialPagePanelProps) => {
  const {
    videoId,
    chapters,
    enabledSections,
    enabledFiles,
    includeTranscript,
    includeCourseStructure,
    courseStructure,
    showSocialShareButtons,
  } = props;

  // Social caption state with localStorage persistence
  const [socialCaption, setSocialCaption] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(SOCIAL_CAPTION_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // Auto-save social caption to localStorage
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SOCIAL_CAPTION_STORAGE_KEY(videoId), socialCaption);
    }
  }, [socialCaption, videoId]);

  // Social AI generation state
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [confirmOverwriteCaption, setConfirmOverwriteCaption] = useState(false);
  const [pendingGeneratedCaption, setPendingGeneratedCaption] = useState("");

  const handleGenerateCaption = async () => {
    setIsGeneratingCaption(true);
    try {
      const transcriptEnabled =
        chapters.length > 0 ? enabledSections.size > 0 : includeTranscript;

      const response = await fetch(`/api/videos/${videoId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "social-caption",
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
        throw new Error("Failed to generate caption");
      }

      const result = await response.json();
      const generatedText = result.text as string;

      if (socialCaption.trim()) {
        setPendingGeneratedCaption(generatedText);
        setConfirmOverwriteCaption(true);
      } else {
        setSocialCaption(generatedText);
      }
    } catch (error) {
      console.error("Failed to generate caption:", error);
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const handleConfirmOverwriteCaption = () => {
    setSocialCaption(pendingGeneratedCaption);
    setConfirmOverwriteCaption(false);
    setPendingGeneratedCaption("");
  };

  const handleCancelOverwriteCaption = () => {
    setConfirmOverwriteCaption(false);
    setPendingGeneratedCaption("");
  };

  // Read the video title from localStorage (set by the YouTube tab)
  const [videoTitle, setVideoTitle] = useState("");
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      setVideoTitle(
        localStorage.getItem(`post-title-${videoId}`) || "Untitled"
      );
    }
  }, [videoId]);

  // Short link creation state
  const [creatingShortLink, setCreatingShortLink] = useState<string | null>(
    null
  );

  const handleCreateShortLink = async (
    platform: "Newsletter" | "X" | "LinkedIn"
  ) => {
    setCreatingShortLink(platform);
    try {
      const response = await fetch("/api/shortlinks/find-or-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://aihero.dev/skills/subscribe",
          description: `${platform} (${videoTitle})`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create short link");
      }

      const { shortLinkUrl } = await response.json();
      await navigator.clipboard.writeText(shortLinkUrl);
      toast("Short link copied", {
        description: `${platform} short link copied to clipboard: ${shortLinkUrl}`,
      });
    } catch (error) {
      console.error("Failed to create short link:", error);
      toast.error("Failed to create short link", {
        description:
          error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setCreatingShortLink(null);
    }
  };

  const copyAndNavigate = async (url: string, platform: string) => {
    if (!socialCaption.trim()) return;
    await navigator.clipboard.writeText(socialCaption);
    toast(`Caption copied to clipboard`, {
      description: `Opening ${platform}...`,
    });
    window.open(url, "_blank");
  };

  const handlePostToX = () => {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(socialCaption)}`;
    copyAndNavigate(url, "X");
  };

  const handlePostToLinkedIn = () => {
    copyAndNavigate("https://www.linkedin.com/feed/", "LinkedIn");
  };

  return (
    <>
      {/* Right panel: Social posting interface */}
      <div className="w-3/4 flex flex-col p-6 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground">
        <div className="max-w-2xl mx-auto w-full space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="social-caption">Caption</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateCaption}
                disabled={isGeneratingCaption}
              >
                {isGeneratingCaption ? (
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
              id="social-caption"
              value={socialCaption}
              onChange={(e) => setSocialCaption(e.target.value)}
              placeholder="Enter caption for X and LinkedIn..."
              className="min-h-[200px] resize-y"
            />
          </div>

          {/* Post buttons */}
          {showSocialShareButtons && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <Button
                  onClick={handlePostToX}
                  disabled={!socialCaption.trim()}
                  className="flex-1"
                  size="lg"
                >
                  <CopyIcon className="h-4 w-4" />
                  Post to X
                </Button>
                <Button
                  onClick={handlePostToLinkedIn}
                  disabled={!socialCaption.trim()}
                  className="flex-1"
                  size="lg"
                  variant="outline"
                >
                  <CopyIcon className="h-4 w-4" />
                  Post to LinkedIn
                </Button>
              </div>

              {!socialCaption.trim() && (
                <p className="text-sm text-muted-foreground text-center">
                  Write or generate a caption before posting.
                </p>
              )}

              <p className="text-xs text-muted-foreground text-center">
                Caption will be copied to clipboard. X will pre-fill the text;
                for LinkedIn, paste from clipboard.
              </p>
            </div>
          )}

          {/* Short link buttons */}
          <div className="space-y-3 pt-2 border-t border-border">
            <Label>Short Links</Label>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleCreateShortLink("X")}
                disabled={creatingShortLink !== null}
              >
                {creatingShortLink === "X" ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <LinkIcon className="h-4 w-4" />
                )}
                X
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => handleCreateShortLink("LinkedIn")}
                disabled={creatingShortLink !== null}
              >
                {creatingShortLink === "LinkedIn" ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <LinkIcon className="h-4 w-4" />
                )}
                LinkedIn
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Creates a tracked short link and copies it to clipboard.
            </p>
          </div>
        </div>
      </div>

      {/* Overwrite confirmation dialog (Social caption) */}
      <Dialog
        open={confirmOverwriteCaption}
        onOpenChange={(open) => {
          if (!open) handleCancelOverwriteCaption();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace existing caption?</DialogTitle>
            <DialogDescription>
              The caption field already has content. Do you want to replace it
              with the generated text?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelOverwriteCaption}>
              Cancel
            </Button>
            <Button onClick={handleConfirmOverwriteCaption}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
