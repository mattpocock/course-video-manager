"use client";

import { useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  SendIcon,
} from "lucide-react";
import type { CourseStructure } from "@/components/video-context-panel";
import type { SectionWithWordCount } from "@/features/article-writer/types";
import type { WriterContext } from "@/features/article-writer/writer-engine";
import { WritableField } from "@/features/article-writer/writable-field";
import {
  AiHeroConnectCard,
  AiHeroConnectionStatus,
} from "./ai-hero-components";
import {
  NEWSLETTER_HEADER,
  SLUG_PREFIX,
  SLUG_STORAGE_KEY,
  buildFullNewsletter,
  buildSkillsChangelogPayload,
  stripPrefix,
  useSkillsChangelogForm,
} from "./skills-changelog-form-state";
import {
  ImageUploadDropdown,
  SeoDescriptionField,
} from "./skills-changelog-helpers";

export function SkillsChangelogPage({
  videoId,
  aiHero,
  enabledFiles,
  enabledSections,
  includeTranscript,
  courseStructure,
  includeCourseStructure,
  chapters,
  writerContext,
}: {
  videoId: string;
  aiHero: { connected: true; userId: string } | { connected: false };
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  includeTranscript: boolean;
  courseStructure: CourseStructure | null;
  includeCourseStructure: boolean;
  chapters: SectionWithWordCount[];
  writerContext: WriterContext | null;
}) {
  const {
    title,
    setTitle,
    body,
    setBody,
    description,
    setDescription,
    slugSuffix,
    setSlugSuffix,
    newsletterSubject,
    setNewsletterSubject,
    newsletterPreviewText,
    setNewsletterPreviewText,
    newsletterCopy,
    setNewsletterCopy,
  } = useSkillsChangelogForm(videoId);

  const { uploads, startSkillsChangelogUpload, startExportUpload } =
    useContext(UploadContext);

  const activeUpload = Object.values(uploads).find(
    (u) =>
      u.uploadType === "skills-changelog" &&
      u.videoId === videoId &&
      (u.status === "uploading" ||
        u.status === "retrying" ||
        u.status === "waiting")
  );

  const [storedSlug, setStoredSlug] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      setStoredSlug(localStorage.getItem(SLUG_STORAGE_KEY(videoId)) ?? null);
    }
  }, [videoId]);

  useEffect(() => {
    for (const upload of Object.values(uploads)) {
      if (
        upload.uploadType === "skills-changelog" &&
        upload.videoId === videoId &&
        upload.status === "success" &&
        upload.skillsChangelogSlug
      ) {
        localStorage.setItem(
          SLUG_STORAGE_KEY(videoId),
          upload.skillsChangelogSlug
        );
        setStoredSlug(upload.skillsChangelogSlug);
      }
    }
  }, [uploads, videoId]);

  const isDescriptionTooLong = description.length > 160;

  const [isCheckingExport, setIsCheckingExport] = useState(false);

  const handlePost = async () => {
    if (
      !title.trim() ||
      !slugSuffix.trim() ||
      !newsletterSubject.trim() ||
      !newsletterCopy.trim() ||
      isDescriptionTooLong
    ) {
      return;
    }

    const fullSlug = `${SLUG_PREFIX}${stripPrefix(slugSuffix.trim())}`;
    const newsletterCopyWithFooter = buildFullNewsletter(
      newsletterCopy,
      fullSlug
    );

    setIsCheckingExport(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/export-file-exists`);
      const { exists } = await res.json();

      if (exists) {
        startSkillsChangelogUpload(
          videoId,
          title,
          fullSlug,
          body,
          description,
          newsletterSubject,
          newsletterPreviewText,
          newsletterCopyWithFooter
        );
        toast("Post started", {
          description: `"${title}" is posting as a Skills Changelog`,
        });
      } else {
        const exportId = startExportUpload(videoId, title);
        startSkillsChangelogUpload(
          videoId,
          title,
          fullSlug,
          body,
          description,
          newsletterSubject,
          newsletterPreviewText,
          newsletterCopyWithFooter,
          exportId
        );
        toast("Export + post started", {
          description: `"${title}" will export first, then publish as a Skills Changelog`,
        });
      }
    } catch {
      toast.error("Failed to check export status");
    } finally {
      setIsCheckingExport(false);
    }
  };

  const [justCopied, setJustCopied] = useState(false);
  const [justCopiedAll, setJustCopiedAll] = useState(false);

  const handleCopyFullNewsletter = async () => {
    const fullSlug = `${SLUG_PREFIX}${stripPrefix(slugSuffix.trim()) || "<slug>"}`;
    const text = buildFullNewsletter(newsletterCopy, fullSlug);
    try {
      await navigator.clipboard.writeText(text);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleCopyEverything = async () => {
    const fullSlug = `${SLUG_PREFIX}${stripPrefix(slugSuffix.trim()) || "<slug>"}`;
    const text = buildSkillsChangelogPayload({
      title,
      fullSlug,
      body,
      description,
      newsletterSubject,
      newsletterPreviewText,
      newsletterCopy,
    });
    try {
      await navigator.clipboard.writeText(text);
      setJustCopiedAll(true);
      setTimeout(() => setJustCopiedAll(false), 1500);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  if (!aiHero.connected) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <AiHeroConnectCard />
      </div>
    );
  }

  const canSubmit =
    title.trim() &&
    slugSuffix.trim() &&
    newsletterSubject.trim() &&
    newsletterCopy.trim() &&
    !isDescriptionTooLong &&
    !activeUpload &&
    !isCheckingExport;

  return (
    <div className="max-w-2xl mx-auto w-full space-y-8">
      <AiHeroConnectionStatus userId={aiHero.userId} />

      {/* Article section */}
      <section className="space-y-6">
        <div className="border-b pb-2">
          <h2 className="text-lg font-semibold">Article</h2>
          <p className="text-sm text-muted-foreground">
            Public page at aihero.dev/skills/&lt;slug&gt;
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sc-title">Title</Label>
          <Input
            id="sc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter changelog title..."
            className="text-lg"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sc-slug">Slug</Label>
          <div className="flex items-stretch rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden">
            <span className="px-3 inline-flex items-center text-sm font-mono text-muted-foreground bg-muted border-r border-input shrink-0">
              {SLUG_PREFIX}
            </span>
            <Input
              id="sc-slug"
              value={slugSuffix}
              onChange={(e) => setSlugSuffix(e.target.value)}
              placeholder="my-changelog-entry"
              className="font-mono text-sm border-0 focus-visible:ring-0 rounded-none"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sc-body">Body (Markdown)</Label>
          {writerContext ? (
            <WritableField
              videoId={videoId}
              fieldId="skills-changelog-body"
              value={body}
              onApply={setBody}
              context={writerContext}
              placeholder="Click to open writer..."
            />
          ) : (
            <Textarea
              id="sc-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your changelog body in markdown..."
              className="min-h-[300px] resize-y font-mono"
            />
          )}
        </div>

        <ImageUploadDropdown
          videoId={videoId}
          body={body}
          onBodyChange={setBody}
        />

        <SeoDescriptionField
          videoId={videoId}
          description={description}
          onDescriptionChange={setDescription}
          autoGenerate={aiHero.connected}
          enabledFiles={enabledFiles}
          enabledSections={enabledSections}
          includeTranscript={includeTranscript}
          courseStructure={courseStructure}
          includeCourseStructure={includeCourseStructure}
          chapters={chapters}
        />
      </section>

      {/* Newsletter section */}
      <section className="space-y-6">
        <div className="border-b pb-2">
          <h2 className="text-lg font-semibold">Newsletter</h2>
          <p className="text-sm text-muted-foreground">
            Creates a Kit draft (not a send). A footer linking back to the
            changelog page is appended automatically.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sc-nl-subject">Subject</Label>
          <Input
            id="sc-nl-subject"
            value={newsletterSubject}
            onChange={(e) => setNewsletterSubject(e.target.value)}
            placeholder="Newsletter subject line..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sc-nl-preview">Preview text</Label>
          <Input
            id="sc-nl-preview"
            value={newsletterPreviewText}
            onChange={(e) => setNewsletterPreviewText(e.target.value)}
            placeholder="Preview text shown in inbox..."
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="sc-nl-copy">Copy (Markdown)</Label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopyFullNewsletter}
              disabled={!newsletterCopy.trim()}
              aria-label="Copy full newsletter"
              title="Copy full newsletter"
            >
              {justCopied ? (
                <CheckIcon className="h-4 w-4" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="rounded-md border border-input overflow-hidden focus-within:ring-1 focus-within:ring-ring">
            <div className="border-b border-input bg-muted/50 px-3 py-2">
              <pre className="text-base md:text-sm font-mono text-foreground whitespace-pre-wrap break-all">
                {NEWSLETTER_HEADER}
              </pre>
            </div>
            {writerContext ? (
              <WritableField
                videoId={videoId}
                fieldId="newsletter-copy"
                value={newsletterCopy}
                onApply={setNewsletterCopy}
                context={writerContext}
                placeholder="Click to open writer..."
              />
            ) : (
              <Textarea
                id="sc-nl-copy"
                value={newsletterCopy}
                onChange={(e) => setNewsletterCopy(e.target.value)}
                placeholder="Newsletter body in markdown..."
                className="min-h-[240px] resize-y font-mono border-0 rounded-none focus-visible:ring-0 shadow-none"
              />
            )}
            <div className="border-t border-input bg-muted/50 px-3 py-2">
              <pre className="text-base md:text-sm font-mono text-foreground whitespace-pre-wrap break-all">
                {`[Watch the video →](https://www.aihero.dev/skills/${SLUG_PREFIX}${stripPrefix(slugSuffix.trim()) || "<slug>"})\n\nMatt`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Submit */}
      {storedSlug ? (
        <div className="flex items-center gap-3 p-3 rounded-md bg-green-500/10 border border-green-500/20">
          <CheckCircle2Icon className="h-5 w-5 text-green-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-500">
              Published as Skills Changelog
            </p>
            <a
              href={`https://www.aihero.dev/skills/${storedSlug}`}
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
            onClick={handleCopyEverything}
            aria-label="Copy article + newsletter"
            title="Copy article + newsletter"
          >
            {justCopiedAll ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePost}
            disabled={!canSubmit}
          >
            {isCheckingExport ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Checking export...
              </>
            ) : (
              "Republish"
            )}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            onClick={handlePost}
            disabled={!canSubmit}
            className="flex-1"
            size="lg"
          >
            {isCheckingExport ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Checking export...
              </>
            ) : activeUpload ? (
              <>
                <Loader2Icon className="h-4 w-4 animate-spin" />
                Publishing Skills Changelog...
              </>
            ) : (
              <>
                <SendIcon className="h-4 w-4" />
                Publish Skills Changelog
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={handleCopyEverything}
            aria-label="Copy article + newsletter"
            title="Copy article + newsletter"
          >
            {justCopiedAll ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
