import { Button } from "@/components/ui/button";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  FileTextIcon,
  ListChecksIcon,
  VideoIcon,
  MicIcon,
  CrosshairIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Mode } from "./types";
import { modeToLabel, loadRecentModes, saveRecentMode } from "./write-utils";

interface MenuGroup {
  label: string;
  icon: LucideIcon;
  items: { value: Mode; title: string; description: string }[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    label: "Writing",
    icon: FileTextIcon,
    items: [
      {
        value: "article",
        title: "Article",
        description: "Educational content and explanations",
      },
      {
        value: "article-plan",
        title: "Article Plan",
        description: "Plan structure with concise bullet points",
      },
      {
        value: "newsletter",
        title: "Newsletter",
        description: "Friendly preview for AI Hero audience",
      },
    ],
  },
  {
    label: "Exercise Steps",
    icon: ListChecksIcon,
    items: [
      {
        value: "project",
        title: "Project Steps",
        description: "Write steps for project",
      },
      {
        value: "skill-building",
        title: "Skill Building Steps",
        description: "Write steps for skill building problem",
      },
      {
        value: "style-guide-skill-building",
        title: "Style Guide - Skill Building",
        description: "Refine existing skill-building steps",
      },
      {
        value: "style-guide-project",
        title: "Style Guide - Project",
        description: "Refine existing project steps",
      },
    ],
  },
  {
    label: "YouTube & SEO",
    icon: VideoIcon,
    items: [
      {
        value: "youtube-title",
        title: "YouTube Title",
        description: "Generate engaging video title",
      },
      {
        value: "youtube-thumbnail",
        title: "YouTube Thumbnail",
        description: "Generate thumbnail description",
      },
      {
        value: "youtube-description",
        title: "YouTube Description",
        description: "Generate description with timestamps",
      },
      {
        value: "seo-description",
        title: "SEO Description",
        description: "Generate SEO description (max 160 chars)",
      },
      {
        value: "seo-description-document",
        title: "SEO Description (Document)",
        description: "Edit the SEO description as a document",
      },
    ],
  },
  {
    label: "Planning",
    icon: CrosshairIcon,
    items: [
      {
        value: "brainstorming",
        title: "Brainstorming",
        description: "Explore ideas with an AI facilitator",
      },
      {
        value: "scoping-discussion",
        title: "Scoping Discussion",
        description: "Open-ended discussion to scope a lesson",
      },
      {
        value: "scoping-document",
        title: "Scoping Document",
        description: "Generate concise scoping document",
      },
    ],
  },
  {
    label: "Interview",
    icon: MicIcon,
    items: [
      {
        value: "interview-prep",
        title: "Interview Me",
        description: "Pre-interview chat, then go live",
      },
    ],
  },
];

export function WriteModeDropdown(props: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  /** When set, only these modes are selectable; others are hidden. */
  allowedModes?: Mode[];
}) {
  const { mode, onModeChange, allowedModes } = props;
  const [recentModes, setRecentModes] = useState<Mode[]>(loadRecentModes);

  const canPick = (m: Mode) =>
    !allowedModes || allowedModes.length === 0 || allowedModes.includes(m);

  const handleModeChange = (newMode: Mode) => {
    if (!canPick(newMode)) return;
    saveRecentMode(newMode);
    setRecentModes(loadRecentModes());
    onModeChange(newMode);
  };

  const visibleRecent = recentModes.filter(canPick);
  const visibleGroups = MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canPick(item.value)),
  })).filter((group) => group.items.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="justify-between min-w-[180px]">
          {modeToLabel[mode]}
          <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {visibleRecent.length > 0 && (
          <>
            <DropdownMenuLabel>Recent</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => handleModeChange(value as Mode)}
            >
              {visibleRecent.map((recentMode) => (
                <DropdownMenuRadioItem key={recentMode} value={recentMode}>
                  {modeToLabel[recentMode]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}

        {visibleGroups.map((group) => {
          const Icon = group.icon;
          return (
            <DropdownMenuSub key={group.label}>
              <DropdownMenuSubTrigger>
                <Icon className="h-4 w-4 mr-2" />
                {group.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuRadioGroup
                  value={mode}
                  onValueChange={(value) => handleModeChange(value as Mode)}
                >
                  {group.items.map((item) => (
                    <DropdownMenuRadioItem key={item.value} value={item.value}>
                      <div>
                        <div>{item.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.description}
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
