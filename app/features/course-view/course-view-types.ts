import type { Route } from "../../routes/+types/_app.courses.$courseId._index";

export type LoaderData = Route.ComponentProps["loaderData"];
export type Section = NonNullable<
  LoaderData["selectedCourse"]
>["sections"][number];
export type Lesson = Section["lessons"][number];
export type Video = Lesson["videos"][number];
export type Beat = Video["beats"][number];
