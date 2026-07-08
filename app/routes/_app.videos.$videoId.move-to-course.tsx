export const handle = { fullscreen: true };

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { CourseWriteService } from "@/services/course-write-service";
import { withDatabaseDump } from "@/services/dump-service";
import { runtimeLive } from "@/services/layer.server";
import { makeLoader } from "@/services/route-action.server";
import { Console, Effect, Schema } from "effect";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { data, redirect, Form, useNavigation } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId.move-to-course";
import { buildMoveToCourseRedirectUrl } from "@/lib/move-to-course-redirect";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Move Video to Course" }];
};

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const courseOps = yield* CourseOperationsService;

      const video = yield* videoOps.getVideoWithLessonById(params.videoId!);
      const courses = yield* courseOps.getCourses();

      const coursesWithSections = yield* Effect.all(
        courses.map((course) => courseOps.getCourseStructureById(course.id))
      );

      return { video, courses: coursesWithSections };
    }),
});

const moveToCourseSchema = Schema.Struct({
  sectionId: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Section ID is required" })
  ),
  lessonId: Schema.optional(Schema.String),
  newLessonName: Schema.optional(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const lessonSectionOps = yield* LessonSectionOperationsService;
    const writes = yield* CourseWriteService;

    const { sectionId, lessonId, newLessonName } =
      yield* Schema.decodeUnknown(moveToCourseSchema)(formDataObject);

    let targetLessonId: string;
    let targetCourseId: string;

    if (lessonId && lessonId !== "new") {
      const lesson =
        yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);
      const section = lesson.section;
      targetLessonId = lesson.id;
      targetCourseId = section.repoVersion.repoId;
    } else {
      const section =
        yield* lessonSectionOps.getSectionWithHierarchyById(sectionId);
      const title = newLessonName || "New Lesson";

      const result = yield* writes.createLesson(sectionId, title);

      targetLessonId = result.lessonId;
      targetCourseId = section.repoVersion.repoId;
    }

    // Update video's lessonId in the database
    yield* videoOps.updateVideoLesson({ videoId, lessonId: targetLessonId });

    return redirect(
      buildMoveToCourseRedirectUrl({
        courseId: targetCourseId,
        lessonId: targetLessonId,
      })
    );
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const { video, courses } = props.loaderData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedLessonId, setSelectedLessonId] = useState<string>("");
  const [newLessonName, setNewLessonName] = useState<string>("");

  const selectedCourse = courses.find((r) => r.id === selectedCourseId);
  const selectedVersion = selectedCourse?.versions[0];
  const sections = selectedVersion?.sections ?? [];

  const selectedSection = sections.find((s) => s.id === selectedSectionId);
  const lessons = selectedSection?.lessons ?? [];

  const isNewLesson = selectedLessonId === "new";
  const canSubmit =
    selectedSectionId &&
    selectedLessonId &&
    (!isNewLesson || newLessonName.trim().length > 0);

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6">
          <div className="flex items-center gap-2 mb-8">
            <ArrowRightLeft className="w-6 h-6" />
            <h1 className="text-2xl font-bold">Move Video to Course</h1>
          </div>

          <div className="mb-6 p-4 border rounded-lg bg-muted/30">
            <p className="text-sm text-muted-foreground">Moving video:</p>
            <p className="font-medium">{video.title}</p>
          </div>

          <Form method="post" className="space-y-6">
            <input type="hidden" name="sectionId" value={selectedSectionId} />
            {selectedLessonId && selectedLessonId !== "new" && (
              <input type="hidden" name="lessonId" value={selectedLessonId} />
            )}
            {isNewLesson && <input type="hidden" name="lessonId" value="new" />}

            <div className="space-y-2">
              <Label>Course</Label>
              <Select
                value={selectedCourseId}
                onValueChange={(value) => {
                  setSelectedCourseId(value);
                  setSelectedSectionId("");
                  setSelectedLessonId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a course..." />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Section</Label>
              <Select
                value={selectedSectionId}
                onValueChange={(value) => {
                  setSelectedSectionId(value);
                  setSelectedLessonId("");
                }}
                disabled={!selectedCourseId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a section..." />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Lesson</Label>
              <Select
                value={selectedLessonId}
                onValueChange={setSelectedLessonId}
                disabled={!selectedSectionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a lesson..." />
                </SelectTrigger>
                <SelectContent>
                  {lessons.map((lesson) => (
                    <SelectItem key={lesson.id} value={lesson.id}>
                      {lesson.title}
                    </SelectItem>
                  ))}
                  <SelectItem value="new">+ Create new lesson</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isNewLesson && (
              <div className="space-y-2">
                <Label htmlFor="newLessonName">New Lesson Name</Label>
                <Input
                  id="newLessonName"
                  name="newLessonName"
                  placeholder="e.g. Introduction to Arrays"
                  value={newLessonName}
                  onChange={(e) => setNewLessonName(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Moving...
                  </>
                ) : (
                  "Move Video"
                )}
              </Button>
              <Button type="button" variant="outline" asChild>
                <a href="/videos">Cancel</a>
              </Button>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
