import { useEffect, useRef, useState } from "react";

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
  const [title, setTitle] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(TITLE_KEY(videoId)) ?? "";
    }
    return "";
  });

  const [body, setBody] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(BODY_KEY(videoId)) ?? "";
    }
    return "";
  });

  const [description, setDescription] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(DESCRIPTION_KEY(videoId)) ?? "";
    }
    return "";
  });

  const slugInputTouched = useRef(false);
  const [slugSuffix, setSlugSuffix] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(FORM_SLUG_KEY(videoId));
      if (stored) {
        slugInputTouched.current = true;
        return stored;
      }
    }
    return slugify(title);
  });

  const [newsletterSubject, setNewsletterSubject] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(NL_SUBJECT_KEY(videoId)) ?? "";
    }
    return "";
  });

  const [newsletterPreviewText, setNewsletterPreviewText] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(NL_PREVIEW_KEY(videoId)) ?? "";
    }
    return "";
  });

  const [newsletterCopy, setNewsletterCopy] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(NL_COPY_KEY(videoId)) ?? "";
    }
    return "";
  });

  useEffect(() => {
    if (!slugInputTouched.current) {
      setSlugSuffix(slugify(title));
    }
  }, [title]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TITLE_KEY(videoId), title);
    }
  }, [title, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BODY_KEY(videoId), body);
    }
  }, [body, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DESCRIPTION_KEY(videoId), description);
    }
  }, [description, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FORM_SLUG_KEY(videoId), slugSuffix);
    }
  }, [slugSuffix, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(NL_SUBJECT_KEY(videoId), newsletterSubject);
    }
  }, [newsletterSubject, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(NL_PREVIEW_KEY(videoId), newsletterPreviewText);
    }
  }, [newsletterPreviewText, videoId]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(NL_COPY_KEY(videoId), newsletterCopy);
    }
  }, [newsletterCopy, videoId]);

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
