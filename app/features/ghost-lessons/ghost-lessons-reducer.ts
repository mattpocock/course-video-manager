// ─── Types ──────────────────────────────────────────────────────────────────

export type FsStatus = "ghost" | "real";
export type LessonIcon = "watch" | "code" | "discussion";
export type LessonPriority = 1 | 2 | 3;

export interface Lesson {
  id: string;
  title: string;
  order: number;
  fsStatus: FsStatus;
  description: string;
  icon: LessonIcon;
  priority: LessonPriority;
  dependencies: string[];
  // Only present for real lessons
  videos?: { id: string; title: string; durationSeconds: number }[];
}

export interface Section {
  id: string;
  title: string;
  order: number;
  lessons: Lesson[];
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

export const INITIAL_SECTIONS: Section[] = [
  {
    id: "s1",
    title: "01-fundamentals",
    order: 1,
    lessons: [
      {
        id: "l1",
        title: "What is TypeScript?",
        order: 1,
        fsStatus: "real",
        description: "An introduction to TypeScript and why it exists.",
        icon: "watch",
        priority: 1,
        dependencies: [],
        videos: [
          { id: "v1", title: "problem", durationSeconds: 142 },
          { id: "v2", title: "solution", durationSeconds: 318 },
        ],
      },
      {
        id: "l2",
        title: "Setting Up Your Environment",
        order: 2,
        fsStatus: "real",
        description: "",
        icon: "code",
        priority: 1,
        dependencies: ["l1"],
        videos: [
          { id: "v3", title: "problem", durationSeconds: 95 },
          { id: "v4", title: "solution", durationSeconds: 247 },
          { id: "v5", title: "explainer", durationSeconds: 186 },
        ],
      },
      {
        id: "l3",
        title: "Type Annotations Basics",
        order: 3,
        fsStatus: "ghost",
        description:
          "Cover the basic type annotations: string, number, boolean, arrays, and objects.",
        icon: "code",
        priority: 1,
        dependencies: ["l2"],
      },
      {
        id: "l4",
        title: "Your First Type Error",
        order: 4,
        fsStatus: "ghost",
        description: "",
        icon: "watch",
        priority: 2,
        dependencies: ["l3"],
      },
    ],
  },
  {
    id: "s2",
    title: "02-intermediate",
    order: 2,
    lessons: [
      {
        id: "l5",
        title: "Union Types",
        order: 1,
        fsStatus: "real",
        description: "",
        icon: "code",
        priority: 1,
        dependencies: ["l3"],
        videos: [
          { id: "v6", title: "problem", durationSeconds: 78 },
          { id: "v7", title: "solution", durationSeconds: 203 },
        ],
      },
      {
        id: "l6",
        title: "Intersection Types",
        order: 2,
        fsStatus: "ghost",
        description: "How to combine types with the & operator.",
        icon: "code",
        priority: 2,
        dependencies: ["l5"],
      },
      {
        id: "l7",
        title: "Discriminated Unions",
        order: 3,
        fsStatus: "ghost",
        description: "",
        icon: "watch",
        priority: 2,
        dependencies: ["l5"],
      },
      {
        id: "l8",
        title: "Type Narrowing Deep Dive",
        order: 4,
        fsStatus: "ghost",
        description:
          "typeof, instanceof, in operator, discriminated unions, and custom type guards.",
        icon: "discussion",
        priority: 3,
        dependencies: ["l6", "l7"],
      },
    ],
  },
  {
    id: "s3",
    title: "03-advanced-patterns",
    order: 3,
    lessons: [
      {
        id: "l9",
        title: "Generic Functions",
        order: 1,
        fsStatus: "ghost",
        description: "",
        icon: "code",
        priority: 2,
        dependencies: ["l5"],
      },
      {
        id: "l10",
        title: "Conditional Types",
        order: 2,
        fsStatus: "ghost",
        description: "",
        icon: "watch",
        priority: 3,
        dependencies: ["l9"],
      },
    ],
  },
];

// ─── Reducer ────────────────────────────────────────────────────────────────

export type Action =
  | { type: "add-ghost-lesson"; sectionId: string; title: string }
  | { type: "delete-lesson"; sectionId: string; lessonId: string }
  | { type: "realize-lesson"; sectionId: string; lessonId: string }
  | {
      type: "reorder-lessons";
      sectionId: string;
      lessonIds: string[];
    }
  | {
      type: "toggle-icon";
      sectionId: string;
      lessonId: string;
    }
  | {
      type: "toggle-priority";
      sectionId: string;
      lessonId: string;
    }
  | {
      type: "update-description";
      sectionId: string;
      lessonId: string;
      description: string;
    }
  | {
      type: "update-dependencies";
      sectionId: string;
      lessonId: string;
      dependencies: string[];
    }
  | {
      type: "update-title";
      sectionId: string;
      lessonId: string;
      title: string;
    }
  | { type: "add-ghost-section"; title: string };

export function sectionsReducer(
  sections: Section[],
  action: Action
): Section[] {
  switch (action.type) {
    case "add-ghost-lesson": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        const maxOrder = Math.max(0, ...s.lessons.map((l) => l.order));
        const newLesson: Lesson = {
          id: `l${Date.now()}`,
          title: action.title,
          order: maxOrder + 1,
          fsStatus: "ghost",
          description: "",
          icon: "watch",
          priority: 2,
          dependencies: [],
        };
        return { ...s, lessons: [...s.lessons, newLesson] };
      });
    }
    case "delete-lesson": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.filter((l) => l.id !== action.lessonId),
        };
      });
    }
    case "realize-lesson": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== action.lessonId) return l;
            return {
              ...l,
              fsStatus: "real" as const,
              videos: [],
            };
          }),
        };
      });
    }
    case "reorder-lessons": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        const lessonMap = new Map(s.lessons.map((l) => [l.id, l]));
        const reordered = action.lessonIds
          .map((id) => lessonMap.get(id))
          .filter(Boolean) as Lesson[];
        return {
          ...s,
          lessons: reordered.map((l, i) => ({ ...l, order: i + 1 })),
        };
      });
    }
    case "toggle-icon": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== action.lessonId) return l;
            const next: LessonIcon =
              l.icon === "watch"
                ? "code"
                : l.icon === "code"
                  ? "discussion"
                  : "watch";
            return { ...l, icon: next };
          }),
        };
      });
    }
    case "toggle-priority": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== action.lessonId) return l;
            const next: LessonPriority =
              l.priority === 1 ? 2 : l.priority === 2 ? 3 : 1;
            return { ...l, priority: next };
          }),
        };
      });
    }
    case "update-description": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) =>
            l.id === action.lessonId
              ? { ...l, description: action.description }
              : l
          ),
        };
      });
    }
    case "update-dependencies": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) =>
            l.id === action.lessonId
              ? { ...l, dependencies: action.dependencies }
              : l
          ),
        };
      });
    }
    case "update-title": {
      return sections.map((s) => {
        if (s.id !== action.sectionId) return s;
        return {
          ...s,
          lessons: s.lessons.map((l) =>
            l.id === action.lessonId ? { ...l, title: action.title } : l
          ),
        };
      });
    }
    case "add-ghost-section": {
      const maxOrder = Math.max(0, ...sections.map((s) => s.order));
      return [
        ...sections,
        {
          id: `s${Date.now()}`,
          title: action.title,
          order: maxOrder + 1,
          lessons: [],
        },
      ];
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export interface FlatLesson {
  id: string;
  number: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  sectionNumber: number;
  priority: LessonPriority;
}

export function flattenLessons(sections: Section[]): FlatLesson[] {
  const result: FlatLesson[] = [];
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  sorted.forEach((section, si) => {
    const sortedLessons = [...section.lessons].sort(
      (a, b) => a.order - b.order
    );
    sortedLessons.forEach((lesson, li) => {
      result.push({
        id: lesson.id,
        number: `${si + 1}.${li + 1}`,
        title: lesson.title,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionNumber: si + 1,
        priority: lesson.priority,
      });
    });
  });
  return result;
}

export function checkDependencyViolation(
  lesson: Lesson,
  allLessons: FlatLesson[]
): FlatLesson[] {
  const violations: FlatLesson[] = [];
  const lessonIndex = allLessons.findIndex((l) => l.id === lesson.id);
  for (const depId of lesson.dependencies) {
    const depIndex = allLessons.findIndex((l) => l.id === depId);
    if (depIndex > lessonIndex) {
      const dep = allLessons[depIndex];
      if (dep) violations.push(dep);
    }
  }
  return violations;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function sectionIsGhost(section: Section): boolean {
  return (
    section.lessons.length === 0 ||
    section.lessons.every((l) => l.fsStatus === "ghost")
  );
}
