export function buildMoveToCourseRedirectUrl(opts: {
  courseId: string;
  lessonId: string;
}): string {
  return `/courses/${opts.courseId}#${opts.lessonId}`;
}
