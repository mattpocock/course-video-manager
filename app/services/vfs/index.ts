export { normalizePath } from "./vfs-path";

export {
  CourseLeafSchema,
  SectionLeafSchema,
  LessonLeafSchema,
  VideoLeafSchema,
  SegmentLeafSchema,
  ClipLeafSchema,
  ChapterLeafSchema,
  SectionMemberSchema,
  LessonMemberSchema,
  VideoMemberSchema,
  SegmentMemberSchema,
  TimelineMemberSchema,
  type CourseLeaf,
  type SectionLeaf,
  type LessonLeaf,
  type VideoLeaf,
  type SegmentLeaf,
  type ClipLeaf,
  type ChapterLeaf,
  type SectionMember,
  type LessonMember,
  type VideoMember,
  type SegmentMember,
  type TimelineMember,
  type MembersLeaf,
} from "./vfs-schemas";

export {
  generateCourseLeaf,
  generateSectionLeaf,
  generateLessonLeaf,
  generateVideoLeaf,
  generateSortedSegments,
  generateSortedTimelineItems,
  type CourseInput,
  type VersionInput,
  type SectionInput,
  type LessonInput,
  type VideoInput,
  type SegmentInput,
  type ClipInput,
  type ChapterInput,
} from "./vfs-leaves";

export {
  buildVfsTree,
  lookupPath,
  type VfsNode,
  type VfsLeafNode,
  type VfsDirNode,
  type VfsLookupResult,
  type CourseEntry,
  type SectionEntry,
  type LessonEntry,
  type VideoEntry,
} from "./vfs-tree";

export { vfsLs } from "./vfs-ls";

export { vfsTree } from "./vfs-tree-tool";

export { vfsCat, applyFilter } from "./vfs-cat";

export { vfsGrep } from "./vfs-grep";

export {
  deriveDiff,
  computeContentHash,
  resolveFileType,
  CAPABILITY_MATRIX,
  type DiffInput,
  type WriteInput,
  type EditInput,
  type DiffResult,
  type DiffContext,
  type DiffMessage,
  type CatStamp,
  type ArchivedEntity,
  type Op,
  type AddOp,
  type DeleteOp,
  type EditFieldOp,
  type ReorderOp,
  type Rejection,
  type RejectionKind,
  type EntityType,
  type FileType,
} from "./derive-diff";
