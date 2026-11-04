import path from "node:path";
import { Effect } from "effect";
import { Download, MoreHorizontal, Search } from "lucide-react";
import {
  Form,
  Link,
  useSearchParams,
  type ShouldRevalidateFunction,
} from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ActionMenuContent } from "@/features/action-menu/action-menu";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import {
  transcriptionStateOf,
  type TranscriptionState,
  type importedFootageReducer,
} from "@/features/imported-footage/imported-footage-reducer";
import {
  PLAY_PARAM,
  TIME_PARAM,
  onlyPlayerChanged,
  withPlayer,
} from "@/features/imported-footage/player-url";
import { useImportedFootage } from "@/features/imported-footage/use-imported-footage";
import {
  SEARCH_PARAM,
  isSearching,
  searchQueryOf,
} from "@/features/list-search/list-search";
import { formatDuration } from "@/lib/format-duration";
import { rootLabel } from "@/packages/storage";
import {
  USED_IMPORTED_FOOTAGE_ID,
  classifyStorageFile,
} from "@/packages/storage/buckets";
import {
  asFootageImportError,
  findImportedFootage,
  searchImportedFootage,
} from "@/packages/storage/import";
import { loadStorageOwnership } from "@/packages/storage/scan";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { readYoutubeSource } from "@/services/youtube-footage-import.server";
import type { Route } from "./+types/_app.imported-footage";

export const meta: Route.MetaFunction = () => [
  { title: "CVM - Imported Footage" },
];

/** `D:`, or the last folder of a root that is not a drive. */
const shortRootLabel = (root: string) => {
  const label = rootLabel(root);
  return label.startsWith("/") ? `…/${path.posix.basename(label)}` : label;
};

/**
 * Every Imported Footage file, with whether its transcript is fresh and
 * which Videos use it (the Storage page's ownership), where a YouTube import
 * came from (#2545), and the shared search over the transcripts when `?q=` is
 * set (#2537). Read-only: the URL box posts to `api.footage.import-youtube`.
 */
export const loader = makeLoader({
  effect: ({ request }) =>
    Effect.gen(function* () {
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const query = searchQueryOf(new URL(request.url).searchParams);
      const [files, search, ownership] = yield* Effect.all(
        [
          Effect.tryPromise({
            try: () => findImportedFootage(roots),
            catch: asFootageImportError,
          }),
          searchImportedFootage(roots, query),
          loadStorageOwnership(db, roots),
        ],
        { concurrency: "unbounded" }
      );
      const usersOf = (relative: string) => [
        ...(ownership.videosByFootage.get(relative) ?? []),
      ];
      const videoOps = yield* VideoOperationsService;
      const titles = yield* videoOps.getVideoTitlesByIds([
        ...new Set(files.flatMap((f) => usersOf(f.path))),
      ]);
      const sources = yield* Effect.forEach(
        files,
        (file) => readYoutubeSource(path.posix.join(file.location, file.path)),
        { concurrency: 8 }
      );
      const notTranscribed = new Set(search.notTranscribed);
      return {
        query,
        searched: isSearching(query),
        files: files.map((file, i) => ({
          path: file.path,
          name: path.posix.basename(file.path),
          location: file.location,
          rootLabel: shortRootLabel(file.location),
          absolute: path.posix.join(file.location, file.path),
          bytes: file.size,
          transcribed: !notTranscribed.has(file.path),
          youtube: sources[i] ?? null,
          used:
            classifyStorageFile(ownership, file.path)?.bucketId ===
            USED_IMPORTED_FOOTAGE_ID,
          videos: usersOf(file.path).map((id) => ({
            id,
            title: titles.get(id) ?? id,
          })),
        })),
        hits: search.hits,
      };
    }),
});

/**
 * Picking a hit only changes what plays: no reload. A new search (`?q=`)
 * runs this page's loader, and only it (the app layout skips it).
 */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) =>
  formMethod === undefined && onlyPlayerChanged(currentUrl, nextUrl)
    ? false
    : defaultShouldRevalidate;

type FootageRow = Route.ComponentProps["loaderData"]["files"][number];

const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const STATE_LABELS: Record<TranscriptionState, string> = {
  transcribed: "Transcribed",
  transcribing: "Transcribing",
  "not-transcribed": "Not transcribed",
};

/**
 * The Imported Footage page (#2537): every file `cvm footage import` copied
 * in, a search over what was said in them, and a player for the hit picked.
 * It finds and plays only: Clips and B-roll are cut with `cvm`.
 */
export default function ImportedFootagePage({
  loaderData,
}: Route.ComponentProps) {
  const { files, hits, query, searched } = loaderData;
  const [state, dispatch] = useImportedFootage(files.map((f) => f.absolute));
  const [searchParams] = useSearchParams();
  const playing = searchParams.get(PLAY_PARAM);
  const from = Number(searchParams.get(TIME_PARAM) ?? 0);
  const stateOf = (file: FootageRow) => transcriptionStateOf(state, file);
  const unsearched = files.filter((f) => stateOf(f) !== "transcribed");

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Imported Footage</h1>
          <p className="text-sm text-muted-foreground">
            Footage CVM did not film, copied in with{" "}
            <code>cvm footage import</code> or downloaded from a YouTube URL.
            Cut Clips and B-roll from it with <code>cvm</code>.
          </p>
        </div>

        <YoutubeImportBox
          key={state.urlBoxGeneration}
          starting={state.startingUrl !== null}
          downloads={Object.entries(state.downloads)}
          dispatch={dispatch}
        />

        {/* A new search keeps the hit playing: only `q` changes. */}
        <Form method="get" className="flex gap-2 max-w-xl" key={query}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              name={SEARCH_PARAM}
              aria-label="Search transcripts"
              placeholder="Search what was said"
              defaultValue={query}
              className="pl-9"
            />
          </div>
          {playing !== null && (
            <>
              <input type="hidden" name={PLAY_PARAM} value={playing} />
              <input type="hidden" name={TIME_PARAM} value={String(from)} />
            </>
          )}
          <Button type="submit" variant="outline">
            Search
          </Button>
        </Form>

        {playing !== null && (
          <div className="space-y-2" data-testid="imported-footage-player">
            <div className="text-sm text-muted-foreground">
              {playing} from {formatDuration(from)}
            </div>
            <video
              key={`${playing}@${from}`}
              className="w-full max-w-3xl rounded border bg-black"
              src={`/view-video?videoPath=${encodeURIComponent(playing)}#t=${from}`}
              controls
              autoPlay
            />
          </div>
        )}

        {searched && (
          <SearchResults
            hits={hits}
            unsearched={unsearched.map((f) => ({
              path: f.path,
              state: stateOf(f),
            }))}
            searchParams={searchParams}
          />
        )}

        <div>
          <h2 className="text-xl font-semibold mb-2">
            {files.length} {files.length === 1 ? "file" : "files"}
          </h2>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing imported yet. Run{" "}
              <code>cvm footage import &lt;file&gt;</code>, or paste a YouTube
              URL above.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Storage Root</th>
                  <th className="py-2 pr-4 font-medium text-right">Size</th>
                  <th className="py-2 pr-4 font-medium">Transcript</th>
                  <th className="py-2 pr-4 font-medium">Used by</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <FootageFileRow
                    key={file.path}
                    file={file}
                    state={stateOf(file)}
                    dispatch={dispatch}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function YoutubeImportBox({
  starting,
  downloads,
  dispatch,
}: {
  starting: boolean;
  downloads: [string, importedFootageReducer.Download][];
  dispatch: (action: importedFootageReducer.Action) => void;
}) {
  return (
    <div className="space-y-2 max-w-xl">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const url = new FormData(event.currentTarget).get("url");
          dispatch({ type: "youtube-url-submitted", url: String(url ?? "") });
        }}
      >
        <Input
          type="url"
          name="url"
          aria-label="YouTube URL"
          placeholder="Paste a YouTube URL to import it"
          disabled={starting}
          className="flex-1"
        />
        <Button type="submit" variant="outline" disabled={starting}>
          <Download className="size-4" />
          Import
        </Button>
      </form>
      {downloads.length > 0 && (
        <ul className="text-sm space-y-1" data-testid="youtube-downloads">
          {downloads.map(([jobId, download]) => (
            <li key={jobId} className="flex gap-2 text-muted-foreground">
              <span>YouTube {download.videoId}:</span>
              <span>
                {download.stage ?? "waiting"}
                {download.percent !== null ? ` ${download.percent}%` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchResults({
  hits,
  unsearched,
  searchParams,
}: {
  hits: Route.ComponentProps["loaderData"]["hits"];
  unsearched: { path: string; state: TranscriptionState }[];
  searchParams: URLSearchParams;
}) {
  return (
    <div className="space-y-2" data-testid="imported-footage-hits">
      <h2 className="text-xl font-semibold">
        {hits.length} {hits.length === 1 ? "match" : "matches"}
      </h2>
      {hits.length === 0 && unsearched.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches.</p>
      )}
      <ul className="divide-y rounded border">
        {hits.map((hit) => (
          <li key={`${hit.path}@${hit.start}`}>
            <Link
              to={withPlayer(searchParams, hit.path, hit.start)}
              preventScrollReset
              className="flex gap-4 px-3 py-2 hover:bg-muted"
              data-testid="imported-footage-hit"
            >
              <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                {formatDuration(hit.start)}
              </span>
              <span className="flex-1">{hit.text}</span>
              <span className="text-muted-foreground break-all">
                {hit.path}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {unsearched.length > 0 && (
        <p
          className="text-sm text-amber-600"
          data-testid="imported-footage-unsearched"
        >
          Not searched, no transcript yet:{" "}
          {unsearched
            .map((f) => `${f.path} (${STATE_LABELS[f.state].toLowerCase()})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

/** A file's menu, the same from a right-click and from its `…` button. */
const fileMenuGroups = (
  file: FootageRow,
  dispatch: (action: importedFootageReducer.Action) => void
): ActionMenuGroups => ({
  open: [
    {
      ...STANDARD_ACTIONS.revealInFileSystem,
      onSelect: () =>
        dispatch({
          type: "reveal-clicked",
          location: file.location,
          path: file.path,
        }),
    },
  ],
  copy: [
    {
      ...STANDARD_ACTIONS.copy,
      label: "Copy Path",
      onSelect: () => dispatch({ type: "copy-path-clicked", path: file.path }),
    },
  ],
});

function FootageFileRow({
  file,
  state,
  dispatch,
}: {
  file: FootageRow;
  state: TranscriptionState;
  dispatch: (action: importedFootageReducer.Action) => void;
}) {
  const groups = fileMenuGroups(file, dispatch);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr className="border-b align-top" data-testid="imported-footage-file">
          <td className="py-2 pr-4 break-all">
            <div>{file.name}</div>
            <div className="text-xs text-muted-foreground">{file.path}</div>
            {file.youtube && (
              <a
                href={file.youtube.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline-offset-2 hover:underline"
              >
                From YouTube: {file.youtube.title}
              </a>
            )}
          </td>
          <td className="py-2 pr-4 whitespace-nowrap">
            <Badge variant="secondary" title={file.location}>
              {file.rootLabel}
            </Badge>
          </td>
          <td className="py-2 pr-4 text-right tabular-nums whitespace-nowrap">
            {size(file.bytes)}
          </td>
          <td className="py-2 pr-4 whitespace-nowrap">
            <Badge variant={state === "transcribed" ? "default" : "outline"}>
              {STATE_LABELS[state]}
            </Badge>
          </td>
          <td className="py-2 pr-4">
            {file.used ? (
              <ul>
                {file.videos.map((video) => (
                  <li key={video.id}>
                    <Link
                      to={`/videos/${video.id}/edit`}
                      className="underline-offset-2 hover:underline"
                    >
                      {video.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">Unused</span>
            )}
          </td>
          <td className="py-2 text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Actions for ${file.path}`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <ActionMenuContent menu="dropdown" align="end" groups={groups} />
            </DropdownMenu>
          </td>
        </tr>
      </ContextMenuTrigger>
      <ActionMenuContent menu="context" groups={groups} />
    </ContextMenu>
  );
}
