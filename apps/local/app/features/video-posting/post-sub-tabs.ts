import {
  BookOpenIcon,
  HistoryIcon,
  MailIcon,
  NewspaperIcon,
  SendIcon,
  YoutubeIcon,
} from "lucide-react";

export type PostSubTabId =
  "lesson" | "post" | "social" | "ai-hero" | "skills-changelog" | "newsletter";

export type PostSubTab = {
  id: PostSubTabId;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

const commonPostSubTabs: PostSubTab[] = [
  { id: "post", label: "YouTube", path: "post", icon: YoutubeIcon },
  { id: "social", label: "X / LinkedIn", path: "social", icon: SendIcon },
  { id: "ai-hero", label: "AI Hero", path: "ai-hero", icon: NewspaperIcon },
  {
    id: "skills-changelog",
    label: "Skills Changelog",
    path: "skills-changelog",
    icon: HistoryIcon,
  },
  { id: "newsletter", label: "Newsletter", path: "newsletter", icon: MailIcon },
];

/**
 * The Post tab's sub-tabs. Every Video opens its **Body** on the first one: a
 * lesson-bound Video's Body is its Lesson's article, and a Standalone Video's
 * is an Article of its own (issue #2509).
 */
export const postSubTabs = (opts: { isStandalone: boolean }): PostSubTab[] => [
  {
    id: "lesson",
    label: opts.isStandalone ? "Article" : "Lesson",
    path: "lesson",
    icon: BookOpenIcon,
  },
  ...commonPostSubTabs,
];
