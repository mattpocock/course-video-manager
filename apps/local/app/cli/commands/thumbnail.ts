import { Command } from "@effect/cli";
import { Effect } from "effect";
import { existsSync } from "node:fs";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { locateStoredVideoFile } from "@/services/video-files";
import { NEEDS_THUMBNAIL_FILES, requireLocalMachine } from "@/cli/local-only";
import { detail, emitNdjson } from "@/cli/helpers";
import { draftIdOption } from "../entity-id";
import { withSidecarDatabase } from "./sidecar-database";

const HELP = `Read a Video's THUMBNAILS: the images made on its Thumbnail page in the CVM
(layered face, text and Thumbnail Diagram, rendered to a PNG). A YouTube
upload sends one of these and nothing else ('cvm video post-youtube
--thumbnail <id>').

LOCAL-ONLY: it reads Thumbnail rows through this machine's own database
connection and checks each file on this machine's disk. Anywhere else it is
refused: exit 7, _tag "LocalOnlyCommandError".

VERBS
  list --video <id>   the Video's Thumbnails, newest first`;

const LIST_HELP = `List a Video's Thumbnails newest first, as NDJSON. Deleted (archived)
Thumbnails are never listed: they are never uploaded.

OUTPUT (one line each)
  { id, selectedForUpload, createdAt, filePath, exists }
  'selectedForUpload' is the one picked on the Post page. 'filePath' is where
  the rendered PNG is on disk (resolved across the Storage Roots), null when
  the Thumbnail was never rendered; 'exists' is whether that file is there.
  Only a Thumbnail with exists: true can be uploaded.

EXAMPLE
  cvm thumbnail list --video <videoId>`;

const listCmd = Command.make(
  "list",
  { video: draftIdOption("video", "video") },
  ({ video }) =>
    Effect.gen(function* () {
      yield* requireLocalMachine("cvm thumbnail list", NEEDS_THUMBNAIL_FILES);
      const videoId = yield* video;
      const thumbnails = yield* withSidecarDatabase(
        Effect.flatMap(ThumbnailOperationsService, (ops) =>
          ops.getThumbnailsByVideoId(videoId)
        )
      );
      yield* emitNdjson(
        thumbnails.map((t) => {
          const located = t.filePath ? locateStoredVideoFile(t.filePath) : null;
          return {
            id: t.id,
            selectedForUpload: t.selectedForUpload,
            createdAt: t.createdAt.toISOString(),
            filePath: located ?? t.filePath,
            exists: located !== null && existsSync(located),
          };
        })
      );
    })
).pipe(Command.withDescription(detail(LIST_HELP)));

export const thumbnailCommand = Command.make("thumbnail").pipe(
  Command.withDescription(detail(HELP)),
  Command.withSubcommands([listCmd])
);
