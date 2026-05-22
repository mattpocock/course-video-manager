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
import { withDatabaseDump } from "@/services/dump-service";
import { runtimeLive } from "@/services/layer.server";
import { toSlug } from "@/services/lesson-path-service";
import { CourseRepoWriteService } from "@/services/course-repo-write-service";
import { parseSectionPath } from "@/services/section-path-service";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { FileSystem } from "@effect/platform";
import { Console, Effect, Schema } from "effect";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import path from "node:path";
import { useState } from "react";
import { data, redirect, Form, useNavigation } from "react-router";
import type { Route } from "./+types/_app.videos.$videoId.move-to-course";
import { buildMoveToCourseRedirectUrl } from "@/lib/move-to-course-redirect";

export const meta: Route.MetaFunction = () => {
  return [{ title: "CVM - Move Video to Course" }];
};

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const courseOps = yield* CourseOperationsService;

    const video = yield* videoOps.getVideoWithLessonById(videoId);
    const courses = yield* courseOps.getCourses();

    const coursesWithSections = yield* Effect.all(
      courses.map((course) => courseOps.getCourseStructureById(course.id))
    );

    return { video, courses: coursesWithSections };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

const moveToCourseSchema = Schema.Struct({
  sectionId: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Section ID is required" })
  ),
  lessonId: Schema.optional(Schema.String),
  newLessonName: Schema.optional(Schema.String),
});

/**
 * Returns a filename that does not conflict with existing files in destDir.
 * If filename already exists, appends " copy" before the extension,
 * then " copy 2", " copy 3", etc.
 */
const resolveFilename = (
  fs: FileSystem.FileSystem,
  destDir: string,
  filename: string
): Effect.Effect<string, never> => {
  return Effect.gen(function* () {
    const destPath = path.join(destDir, filename);
    const exists = yield* fs
      .exists(destPath)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!exists) return filename;

    const ext = path.extname(filename);
    const base = path.basename(filename, ext);

    const copyCandidate = `${base} copy${ext}`;
    const copyPath = path.join(destDir, copyCandidate);
    const copyExists = yield* fs
      .exists(copyPath)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (!copyExists) return copyCandidate;

    let n = 2;
    while (true) {
      const candidate = `${base} copy ${n}${ext}`;
      const candidatePath = path.join(destDir, candidate);
      const candidateExists = yield* fs
        .exists(candidatePath)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (!candidateExists) return candidate;
      n++;
    }
  });
};

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const formData = await args.request.formData();
  const formDataObject = Object.fromEntries(formData);

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const lessonSectionOps = yield* LessonSectionOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const repoWrite = yield* CourseRepoWriteService;

    const { sectionId, lessonId, newLessonName } =
      yield* Schema.decodeUnknown(moveToCourseSchema)(formDataObject);

    let targetLessonId: string;
    let targetCourseId: string;
    let lessonDirPath: string;

    if (lessonId && lessonId !== "new") {
      // Use existing lesson
      const lesson =
        yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);
      const repo = lesson.section.repoVersion.repo;
      const section = lesson.section;
      targetLessonId = lesson.id;
      targetCourseId = section.repoVersion.repoId;
      lessonDirPath = path.join(repo.filePath!, section.path, lesson.path);
    } else {
      // Create a new real lesson at end of section
      const section =
        yield* lessonSectionOps.getSectionWithHierarchyById(sectionId);
      const repo = section.repoVersion.repo;
      const parsed = parseSectionPath(section.path);
      const sectionNumber = parsed?.sectionNumber ?? 1;
      const slug = toSlug(newLessonName || "new-lesson") || "new-lesson";

      const { lessonDirName, lessonNumber } = yield* repoWrite.addLesson({
        repoPath: repo.filePath!,
        sectionPath: section.path,
        sectionNumber,
        slug,
      });

      const [newLesson] = yield* lessonSectionOps.createLessons(sectionId, [
        { lessonPathWithNumber: lessonDirName, lessonNumber },
      ]);

      if (!newLesson) {
        return yield* Effect.die(
          data("Failed to create lesson", { status: 500 })
        );
      }

      targetLessonId = newLesson.id;
      targetCourseId = section.repoVersion.repoId;
      lessonDirPath = path.join(repo.filePath!, section.path, lessonDirName);
    }

    // Merge files from standalone video dir into lesson dir
    const sourceDir = getStandaloneVideoFilePath(videoId);
    const sourceDirExists = yield* fs
      .exists(sourceDir)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));

    if (sourceDirExists) {
      const entries = yield* fs
        .readDirectory(sourceDir)
        .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

      if (entries.length > 0) {
        // Ensure destination directory exists
        yield* fs
          .makeDirectory(lessonDirPath, { recursive: true })
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)));

        for (const filename of entries) {
          const srcPath = path.join(sourceDir, filename);
          const stat = yield* fs
            .stat(srcPath)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (stat && stat.type === "File") {
            const destFilename = yield* resolveFilename(
              fs,
              lessonDirPath,
              filename
            );
            const destPath = path.join(lessonDirPath, destFilename);
            const content = yield* fs.readFile(srcPath);
            yield* fs.writeFile(destPath, content);
          }
        }
      }

      // Remove the original standalone video directory
      yield* fs
        .remove(sourceDir, { recursive: true })
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
            <p className="font-medium">{video.path}</p>
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
                      {section.path}
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
                  {lessons
                    .filter((l) => l.fsStatus !== "ghost")
                    .map((lesson) => (
                      <SelectItem key={lesson.id} value={lesson.id}>
                        {lesson.path}
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
