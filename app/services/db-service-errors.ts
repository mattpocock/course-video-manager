import { Data } from "effect";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  type: string;
  params: object;
  message?: string;
}> {}

export class UnknownDBServiceError extends Data.TaggedError(
  "UnknownDBServiceError"
)<{
  cause: unknown;
}> {}

export class NotLatestVersionError extends Data.TaggedError(
  "NotLatestVersionError"
)<{
  sourceVersionId: string;
  latestVersionId: string;
}> {}

export class CannotUpdatePublishedVersionError extends Data.TaggedError(
  "CannotUpdatePublishedVersionError"
)<{
  versionId: string;
}> {}

export class AmbiguousCourseUpdateError extends Data.TaggedError(
  "AmbiguousCourseUpdateError"
)<{
  filePath: string;
  repoCount: number;
}> {}

export class CannotArchiveLessonVideoError extends Data.TaggedError(
  "CannotArchiveLessonVideoError"
)<{
  videoId: string;
  lessonId: string;
}> {}

export class CourseNameTakenError extends Data.TaggedError(
  "CourseNameTakenError"
)<{
  name: string;
  slug: string;
  message: string;
}> {}

export class SectionPathTakenError extends Data.TaggedError(
  "SectionPathTakenError"
)<{
  path: string;
  message: string;
}> {}

export class LessonPathTakenError extends Data.TaggedError(
  "LessonPathTakenError"
)<{
  path: string;
  message: string;
}> {}

export class VideoPathTakenError extends Data.TaggedError(
  "VideoPathTakenError"
)<{
  path: string;
  message: string;
}> {}
