"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  ImageIcon,
  Loader2Icon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import type { CourseStructure } from "@/components/video-context-panel";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import {
  AiHeroConnectCard,
  AiHeroConnectionStatus,
} from "./ai-hero-components";

const AI_HERO_TITLE_STORAGE_KEY = (videoId: string) =>
  `ai-hero-title-${videoId}`;
const AI_HERO_BODY_STORAGE_KEY = (videoId: string) => `ai-hero-body-${videoId}`;
const AI_HERO_SEO_DESCRIPTION_STORAGE_KEY = (videoId: string) =>
  `ai-hero-seo-description-${videoId}`;
const AI_HERO_SLUG_STORAGE_KEY = (videoId: string) => `ai-hero-slug-${videoId}`;
const AI_HERO_FORM_SLUG_STORAGE_KEY = (videoId: string) =>
  `ai-hero-form-slug-${videoId}`;

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export function AiHeroPage({
  videoId,
  aiHero,
  enabledFiles,
  enabledSections,
  includeTranscript,
  courseStructure,
  includeCourseStructure,
  chapters,
}: {
  videoId: string;
  aiHero: { connected: true; userId: string } | { connected: false };
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  includeTranscript: boolean;
  courseStructure: CourseStructure | null;
  includeCourseStructure: boolean;
  chapters: SectionWithWordCount[];
}) {
  // Title with localStorage persistence
  const [title, setTitle] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(AI_HERO_TITLE_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // Body with localStorage persistence
  const [body, setBody] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(AI_HERO_BODY_STORAGE_KEY(videoId)) ?? "";
    }
    return "";
  });

  // SEO description with localStorage persistence
  const [seoDescription, setSeoDescription] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return (
        localStorage.getItem(AI_HERO_SEO_DESCRIPTION_STORAGE_KEY(videoId)) ?? ""
      );
    }
    return "";
  });

  // Editable slug with localStorage persistence
  const slugInputTouched = useRef(false);
  const [slug, setSlug] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(
        AI_HERO_FORM_SLUG_STORAGE_KEY(videoId)
      );
      if (stored) {
        slugInputTouched.current = true;
        return stored;
      }
    }
    return slugify(title);
  });

  // Auto-derive slug from title when user hasn't manually edited it
  useEffect(() => {
    if (!slugInputTouched.current) {
      setSlug(slugify(title));
    }
  }, [title]);

  // Auto-save to localStorage
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AI_HERO_TITLE_STORAGE_KEY(videoId), title);
    }
  }, [title, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AI_HERO_BODY_STORAGE_KEY(videoId), body);
    }
  }, [body, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        AI_HERO_SEO_DESCRIPTION_STORAGE_KEY(videoId),
        seoDescription
      );
    }
  }, [seoDescription, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AI_HERO_FORM_SLUG_STORAGE_KEY(videoId), slug);
    }
  }, [slug, videoId]);

  // Upload context
  const { uploads, startAiHeroUpload, startExportUpload } =
    useContext(UploadContext);

  // Check if there's an active AI Hero upload for this video
  const activeAiHeroUpload = Object.values(uploads).find(
    (u) =>
      u.uploadType === "ai-hero" &&
      u.videoId === videoId &&
      (u.status === "uploading" ||
        u.status === "retrying" ||
        u.status === "waiting")
  );

  // Stored slug from successful upload
  const [storedSlug, setStoredSlug] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      setStoredSlug(
        localStorage.getItem(AI_HERO_SLUG_STORAGE_KEY(videoId)) ?? null
      );
    }
  }, [videoId]);

  // Watch for successful AI Hero uploads and store the slug
  useEffect(() => {
    for (const upload of Object.values(uploads)) {
      if (
        upload.uploadType === "ai-hero" &&
        upload.videoId === videoId &&
        upload.status === "success" &&
        upload.aiHeroSlug
      ) {
        localStorage.setItem(
          AI_HERO_SLUG_STORAGE_KEY(videoId),
          upload.aiHeroSlug
        );
        setStoredSlug(upload.aiHeroSlug);
      }
    }
  }, [uploads, videoId]);

  const isSeoDescriptionTooLong = seoDescription.length > 160;

  const [isCheckingExport, setIsCheckingExport] = useState(false);

  const handlePostToAiHero = async () => {
    if (!title.trim() || isSeoDescriptionTooLong) return;

    setIsCheckingExport(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/export-file-exists`);
      const { exists } = await res.json();

      if (exists) {
        startAiHeroUpload(videoId, title, body, seoDescription, slug);
        toast("Post started", {
          description: `"${title}" is posting to AI Hero`,
        });
      } else {
        const exportId = startExportUpload(videoId, title);
        startAiHeroUpload(videoId, title, body, seoDescription, slug, exportId);
        toast("Export + post started", {
          description: `"${title}" will export first, then post to AI Hero`,
        });
      }
    } catch {
      toast.error("Failed to check export status");
    } finally {
      setIsCheckingExport(false);
    }
  };

  // Cloudinary image upload state
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const hasLocalImages = useMemo(() => {
    const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
    const matches = Array.from(body.matchAll(imageRegex));
    return matches.some(
      (m) => !m[1]!.startsWith("http://") && !m[1]!.startsWith("https://")
    );
  }, [body]);

  const handleUploadImages = async (deleteLocalFiles: boolean) => {
    if (!body.trim()) return;
    setIsUploadingImages(true);
    try {
      const response = await fetch(`/api/videos/${videoId}/upload-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, deleteLocalFiles }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to upload images");
      }
      const result = await response.json();
      if (result.body !== body) {
        setBody(result.body);
        toast.success(
          deleteLocalFiles
            ? "Images uploaded to Cloudinary and local files deleted"
            : "Images uploaded to Cloudinary"
        );
      } else {
        toast("No local images found to upload");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload images"
      );
    } finally {
      setIsUploadingImages(false);
    }
  };

  // SEO description generation state
  const [isGeneratingSeo, setIsGeneratingSeo] = useState(false);
  const hasAutoGenerated = useRef(false);

  // Confirmation dialog for regenerating SEO description
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [pendingGeneratedSeo, setPendingGeneratedSeo] = useState("");

  const generateSeoDescription = async () => {
    setIsGeneratingSeo(true);
    try {
      const transcriptEnabled =
        chapters.length > 0 ? enabledSections.size > 0 : includeTranscript;

      const response = await fetch(`/api/videos/${videoId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "seo-description",
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
        throw new Error("Failed to generate SEO description");
      }

      const result = await response.json();
      return result.text as string;
    } finally {
      setIsGeneratingSeo(false);
    }
  };

  // Auto-generate SEO description on first load if empty
  useEffect(() => {
    if (
      !hasAutoGenerated.current &&
      !seoDescription.trim() &&
      aiHero.connected
    ) {
      hasAutoGenerated.current = true;
      generateSeoDescription()
        .then((text) => {
          if (text) setSeoDescription(text);
        })
        .catch(console.error);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegenerate = async () => {
    const text = await generateSeoDescription();
    if (!text) return;

    if (seoDescription.trim()) {
      setPendingGeneratedSeo(text);
      setConfirmRegenerate(true);
    } else {
      setSeoDescription(text);
    }
  };

  const handleConfirmRegenerate = () => {
    setSeoDescription(pendingGeneratedSeo);
    setConfirmRegenerate(false);
    setPendingGeneratedSeo("");
  };

  const handleCancelRegenerate = () => {
    setConfirmRegenerate(false);
    setPendingGeneratedSeo("");
  };

  if (!aiHero.connected) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <AiHeroConnectCard />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-2xl mx-auto w-full space-y-6">
        {/* Connection status */}
        <AiHeroConnectionStatus userId={aiHero.userId} />

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="ai-hero-title">Title</Label>
          <Input
            id="ai-hero-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter post title..."
            className="text-lg"
          />
        </div>

        {/* Slug */}
        <div className="space-y-2">
          <Label htmlFor="ai-hero-slug">Slug</Label>
          <Input
            id="ai-hero-slug"
            value={slug}
            onChange={(e) => {
              slugInputTouched.current = true;
              setSlug(e.target.value);
            }}
            placeholder="post-slug"
            className="font-mono text-sm"
          />
        </div>

        {/* Body */}
        <div className="space-y-2">
          <Label htmlFor="ai-hero-body">Body (Markdown)</Label>
          <Textarea
            id="ai-hero-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your post body in markdown..."
            className="min-h-[300px] resize-y font-mono"
          />
        </div>

        {/* Upload Images to Cloudinary — only shown when body has local image references */}
        {(hasLocalImages || isUploadingImages) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isUploadingImages}>
                {isUploadingImages ? (
                  <>
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    Uploading images...
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" />
                    Upload Images to Cloudinary
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleUploadImages(false)}>
                <ImageIcon className="h-4 w-4" />
                <div>
                  <div>Upload</div>
                  <p className="text-muted-foreground text-xs">
                    Upload local images to Cloudinary and update references
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => handleUploadImages(true)}
              >
                <Trash2Icon className="h-4 w-4" />
                <div>
                  <div>Upload and delete local files</div>
                  <p className="text-xs opacity-70">
                    Upload to Cloudinary, then remove the local image files
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* SEO Description */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="ai-hero-seo">SEO Description</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isGeneratingSeo}
            >
              {isGeneratingSeo ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4" />
                  Regenerate
                </>
              )}
            </Button>
          </div>
          <Textarea
            id="ai-hero-seo"
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            placeholder={
              isGeneratingSeo
                ? "Generating SEO description..."
                : "SEO description (160 characters max)..."
            }
            className={`min-h-[80px] resize-y ${isSeoDescriptionTooLong ? "border-red-500 focus-visible:ring-red-500" : ""}`}
          />
          <p
            className={`text-xs text-right ${isSeoDescriptionTooLong ? "text-red-500" : "text-muted-foreground"}`}
          >
            {seoDescription.length}/160
          </p>
        </div>

        {/* Post to AI Hero button */}
        {storedSlug ? (
          <div className="flex items-center gap-3 p-3 rounded-md bg-green-500/10 border border-green-500/20">
            <CheckCircle2Icon className="h-5 w-5 text-green-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-500">
                Posted to AI Hero
              </p>
              <a
                href={`https://aihero.dev/${storedSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 truncate"
              >
                View on AI Hero
                <ExternalLinkIcon className="h-3 w-3 shrink-0" />
              </a>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePostToAiHero}
              disabled={
                !title.trim() ||
                !!activeAiHeroUpload ||
                isCheckingExport ||
                isSeoDescriptionTooLong
              }
            >
              {isCheckingExport ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Checking export...
                </>
              ) : (
                "Repost"
              )}
            </Button>
          </div>
        ) : (
          <Button
            onClick={handlePostToAiHero}
            disabled={
              !title.trim() ||
              !!activeAiHeroUpload ||
              isCheckingExport ||
              isSeoDescriptionTooLong
            }
            className="w-full"
            size="lg"
          >
            {isCheckingExport ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Checking export...
              </>
            ) : activeAiHeroUpload ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Posting to AI Hero...
              </>
            ) : (
              <>
                <SendIcon className="h-4 w-4" />
                Post to AI Hero
              </>
            )}
          </Button>
        )}
      </div>

      {/* Regenerate confirmation dialog */}
      <Dialog
        open={confirmRegenerate}
        onOpenChange={(open) => {
          if (!open) handleCancelRegenerate();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace SEO description?</DialogTitle>
            <DialogDescription>
              The SEO description field already has content. Do you want to
              replace it with the newly generated text?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelRegenerate}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRegenerate}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
