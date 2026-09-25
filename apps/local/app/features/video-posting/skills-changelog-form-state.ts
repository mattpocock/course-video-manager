import { useEffect, useRef } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";

const SLUG_PREFIX = "skills-changelog-";

const TITLE_KEY = (videoId: string) => `skills-changelog-title-${videoId}`;
const BODY_KEY = (videoId: string) => `skills-changelog-body-${videoId}`;
const DESCRIPTION_KEY = (videoId: string) =>
  `skills-changelog-description-${videoId}`;
const FORM_SLUG_KEY = (videoId: string) =>
  `skills-changelog-form-slug-${videoId}`;
const NL_SUBJECT_KEY = (videoId: string) =>
  `skills-changelog-newsletter-subject-${videoId}`;
const NL_PREVIEW_KEY = (videoId: string) =>
  `skills-changelog-newsletter-preview-${videoId}`;
const NL_COPY_KEY = (videoId: string) =>
  `skills-changelog-newsletter-copy-${videoId}`;

export const SLUG_STORAGE_KEY = (videoId: string) =>
  `skills-changelog-slug-${videoId}`;

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export const stripPrefix = (slug: string): string => {
  return slug.startsWith(SLUG_PREFIX) ? slug.slice(SLUG_PREFIX.length) : slug;
};

export { SLUG_PREFIX };

export const NEWSLETTER_HEADER = `Hey {{ subscriber.first_name | strip | default: "there" }},`;

export const buildNewsletterFooter = (fullSlug: string): string =>
  `\n\n[Watch the video →](https://www.aihero.dev/skills/${fullSlug})\n\nMatt\n`;

export const buildFullNewsletter = (copy: string, fullSlug: string): string =>
  `${NEWSLETTER_HEADER}\n\n${copy.trimStart().trimEnd()}` +
  buildNewsletterFooter(fullSlug);

export const buildSkillsChangelogPayload = (args: {
  title: string;
  fullSlug: string;
  body: string;
  description: string;
  newsletterSubject: string;
  newsletterPreviewText: string;
  newsletterCopy: string;
}): string =>
  [
    "<article>",
    `  <title>${args.title}</title>`,
    `  <slug>${args.fullSlug}</slug>`,
    "  <body>",
    args.body,
    "  </body>",
    `  <seo-description>${args.description}</seo-description>`,
    "</article>",
    "",
    "<newsletter>",
    `  <subject>${args.newsletterSubject}</subject>`,
    `  <preview-text>${args.newsletterPreviewText}</preview-text>`,
    "  <copy>",
    buildFullNewsletter(args.newsletterCopy, args.fullSlug),
    "  </copy>",
    "</newsletter>",
  ].join("\n");

export function useSkillsChangelogForm(videoId: string) {
  const [title, setTitle] = useLocalStorage(TITLE_KEY(videoId));
  const [body, setBody] = useLocalStorage(BODY_KEY(videoId));
  const [description, setDescription] = useLocalStorage(
    DESCRIPTION_KEY(videoId)
  );
  const [slugSuffix, setSlugSuffix] = useLocalStorage(FORM_SLUG_KEY(videoId));
  const [newsletterSubject, setNewsletterSubject] = useLocalStorage(
    NL_SUBJECT_KEY(videoId)
  );
  const [newsletterPreviewText, setNewsletterPreviewText] = useLocalStorage(
    NL_PREVIEW_KEY(videoId)
  );
  const [newsletterCopy, setNewsletterCopy] = useLocalStorage(
    NL_COPY_KEY(videoId)
  );

  // A stored slug is one the author typed; an empty one still tracks the title.
  const slugInputTouched = useRef(slugSuffix !== "");

  useEffect(() => {
    if (!slugInputTouched.current) {
      setSlugSuffix(slugify(title));
    }
  }, [title, setSlugSuffix]);

  const setSlugSuffixTouched = (value: string) => {
    slugInputTouched.current = true;
    setSlugSuffix(value);
  };

  return {
    title,
    setTitle,
    body,
    setBody,
    description,
    setDescription,
    slugSuffix,
    setSlugSuffix: setSlugSuffixTouched,
    newsletterSubject,
    setNewsletterSubject,
    newsletterPreviewText,
    setNewsletterPreviewText,
    newsletterCopy,
    setNewsletterCopy,
  };
}
