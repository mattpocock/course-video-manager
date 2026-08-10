import { Data } from "effect";

export class CourseWriteError extends Data.TaggedError("CourseWriteError")<{
  cause: unknown;
  message: string;
}> {}
