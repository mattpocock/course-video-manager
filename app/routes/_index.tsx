"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { Effect } from "effect";
import { Play, Plus, Trash2, VideoIcon } from "lucide-react";
import { homedir } from "node:os";
import path from "node:path";
import { useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/_index";

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const selectedRepoId = url.searchParams.get("repoId");

  return Effect.gen(function* () {
    const db = yield* DBService;
    const [repos, selectedRepo] = yield* Effect.all(
      [
        db.getRepos().pipe(
          Effect.map((repos) => {
            return repos.map((repo) => {
              return {
                ...repo,
                name: path.relative(
                  path.join(homedir(), "repos"),
                  repo.filePath
                ),
              };
            });
          })
        ),
        !selectedRepoId
          ? Effect.succeed(undefined)
          : db.getRepoWithSectionsById(selectedRepoId).pipe(
              Effect.map((repo) => {
                if (!repo) {
                  return undefined;
                }

                return {
                  ...repo,
                  name: path.relative(
                    path.join(homedir(), "repos"),
                    repo.filePath
                  ),
                };
              })
            ),
      ],
      {
        concurrency: "unbounded",
      }
    );
    return { repos, selectedRepo };
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

export default function Component(props: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRepoId = searchParams.get("repoId");
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState("");

  const latestObsVideoFetcher = useFetcher();

  const repos = props.loaderData.repos;

  const handleAddRepo = () => {
    if (newRepoPath.trim()) {
      // Here you would typically add the repo to your repositories array
      console.log("Adding repo from path:", newRepoPath);
      setNewRepoPath("");
      setIsAddRepoModalOpen(false);
    }
  };

  const currentRepo = props.loaderData.selectedRepo;

  // Function to determine the path based on video count
  const getVideoPath = (lesson: { videos: unknown[] }) => {
    const videoCount = lesson.videos.length;

    if (videoCount === 0) {
      return "problem";
    } else if (videoCount === 1) {
      return "solution";
    } else {
      return `solution ${videoCount}`;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Left Sidebar - Repos */}
      <div className="w-80 border-r bg-muted/30">
        <div className="p-4 pb-0">
          <h2 className="text-lg font-semibold mb-4">Repos</h2>
          <ScrollArea className="h-[calc(100vh-120px)]">
            <div className="space-y-2">
              {repos.map((repo) => (
                <Button
                  key={repo.id}
                  variant={selectedRepoId === repo.id ? "default" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => {
                    setSearchParams({ repoId: repo.id });
                  }}
                >
                  {repo.name}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <Separator className="mb-4 -mt-4" />
          <Dialog
            open={isAddRepoModalOpen}
            onOpenChange={setIsAddRepoModalOpen}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full bg-transparent">
                <Plus className="w-4 h-4 mr-2" />
                Add Repo
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add New Repository</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="repo-path">Repository File Path</Label>
                  <Input
                    id="repo-path"
                    placeholder="Enter local file path..."
                    value={newRepoPath}
                    onChange={(e) => setNewRepoPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleAddRepo();
                      }
                    }}
                  />
                </div>
                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsAddRepoModalOpen(false);
                      setNewRepoPath("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddRepo}
                    disabled={!newRepoPath.trim()}
                  >
                    Add Repository
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-6">{currentRepo?.name}</h1>

          <div className="space-y-8">
            {currentRepo?.sections.map((section) => (
              <Card key={section.id} className="border-0 shadow-none">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">{section.path}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {section.lessons.map((lesson) => (
                    <div key={lesson.id} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">{lesson.path}</h3>
                        <latestObsVideoFetcher.Form
                          method="post"
                          action="/api/videos/edit-latest-obs-video"
                          className="inline"
                        >
                          <input
                            type="hidden"
                            name="lessonId"
                            value={lesson.id}
                          />
                          <input
                            type="hidden"
                            name="path"
                            value={getVideoPath(lesson)}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            <Plus className="w-4 h-4 mr-2" />
                            Add from OBS
                          </Button>
                        </latestObsVideoFetcher.Form>
                      </div>

                      <div className="space-y-2 ml-4">
                        {lesson.videos.map((video) => (
                          <div
                            key={video.id}
                            className="flex items-center justify-between p-3 bg-muted/10 rounded-md"
                          >
                            <div className="flex items-center gap-2">
                              <VideoIcon />
                              <span className="font-medium">{video.path}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="sm">
                                <Play className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
