import {
  ArrowLeft,
  CopyX,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Loader2,
} from "lucide-react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActionMenuContent } from "@/features/action-menu/action-menu";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import {
  allTicked,
  bucketFiles,
  bucketRootChips,
  bucketTotals,
  fileActions,
  fileCanBeTicked,
  type FileAction,
  originalsOffers,
  selectedBytes,
  type bucketPageReducer,
} from "@/features/storage/bucket-page-reducer";
import {
  StorageActionDialog,
  StorageActionFailure,
} from "@/features/storage/storage-action-dialog";
import { storageActionIsBusy } from "@/features/storage/storage-action";
import { RootFilterChips } from "@/features/storage/root-filter-chips";
import { withRootFilter } from "@/features/storage/root-filter";
import { StorageJobsPanel } from "@/features/storage/storage-jobs-panel";
import { shownStorageJobs } from "@/features/storage/storage-jobs";
import { useBucketPage } from "@/features/storage/use-bucket-page";
import { useStorageJobs } from "@/features/storage/use-storage-jobs";
import type {
  StorageBucketFile,
  StorageFileRole,
} from "@/packages/storage/client";
import type { Route } from "./+types/_app.storage_.$bucketId";
import { toDate } from "@/packages/clock";

export const meta: Route.MetaFunction = () => [
  { title: "CVM - Storage Bucket" },
];

/** Gigabytes as Windows counts them (GiB); small files in MB. */
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const ROLE_LABELS: Record<StorageFileRole, string> = {
  footage: "Footage",
  "recording-session": "Footage (Recording Session)",
  "footage-companion": "Transcript / Whisper piece",
  "exported-video": "Exported Video",
  "export-companion": "Exported Video companion",
  "clip-mockup": "Clip Mockup",
  "overlay-render": "Overlay render",
  "export-scratch": "Export scratch",
  "move-partial": "Unfinished move copy",
};

/**
 * The per-bucket page (#2108): one Storage Bucket's files, largest first,
 * with the drive(s) each is on first. Each file has an action menu with what
 * its bucket allows (#2157): Delete, Move to another drive, Delete original
 * and Show in Explorer. Every file with a Delete can be ticked (shift-click
 * for a range, the header for all) and deleted together (#2423); "Delete
 * originals on D:" deletes the bucket's files on D: with an identical copy
 * elsewhere (#2110). Every move and delete runs as a Sidecar Job, followed
 * live here. The listing streams in and is kept in memory for five minutes
 * (#2423): Refresh lists again at once. Toggle chips filter by Storage Root
 * (#2431): ticking and deleting act only on the files shown.
 */
export default function StorageBucketPage({ params }: Route.ComponentProps) {
  // A new bucket is a new listing: remount rather than reuse the state.
  return <BucketPage key={params.bucketId} bucketId={params.bucketId} />;
}

function BucketPage({ bucketId }: { bucketId: string }) {
  const [state, dispatch] = useBucketPage(bucketId);
  const files = bucketFiles(state);
  const canTick = files.some((f) => fileCanBeTicked(state, f.path));
  const totals = bucketTotals(state);
  const busy = storageActionIsBusy(state.action);
  const labelOf = (location: string) => {
    const label =
      state.roots?.find((r) => r.root === location)?.label ?? location;
    return label.startsWith("/") ? `…/${label.split("/").pop()}` : label;
  };
  const jobs = useStorageJobs(bucketId, labelOf, dispatch);

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-6xl space-y-6">
        <div>
          <Link
            to={withRootFilter("/storage", state.hiddenRoots)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
            data-testid="back-to-storage"
          >
            <ArrowLeft className="w-4 h-4" /> Storage
          </Link>
          <div className="flex items-center justify-between gap-4 mb-2">
            <h1 className="text-3xl font-bold">
              {state.bucket?.name ?? "Storage Bucket"}
            </h1>
            <Button
              variant="outline"
              size="sm"
              disabled={state.status === "listing" || busy}
              onClick={() => dispatch({ type: "refresh-clicked" })}
              data-testid="bucket-refresh"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
          </div>
          {state.bucket?.sharedBy && state.bucket.sharedBy.length > 0 && (
            <p className="text-muted-foreground" data-testid="shared-by">
              Used by {state.bucket.sharedBy.join(", ")}
            </p>
          )}
          <ListingStatus state={state} fileCount={files.length} />
        </div>

        <StorageActionFailure
          action={state.action}
          labelOf={labelOf}
          onDismiss={() => dispatch({ type: "storage-action-dismissed" })}
        />
        <StorageActionDialog
          action={state.action}
          labelOf={labelOf}
          onConfirm={() => dispatch({ type: "storage-action-confirmed" })}
          onCancel={() => dispatch({ type: "storage-action-cancelled" })}
        />
        {state.notice !== null && (
          <div
            className="flex items-start justify-between gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
            data-testid="bucket-notice"
          >
            <span>{state.notice}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: "notice-dismissed" })}
            >
              Dismiss
            </Button>
          </div>
        )}
        <StorageJobsPanel
          jobs={shownStorageJobs(jobs.views, state.watchedJobs)}
          onCancel={jobs.cancelJob}
        />

        <RootFilterChips
          chips={bucketRootChips(state)}
          labelOf={labelOf}
          isOffline={(location) =>
            state.roots?.some((r) => r.root === location && !r.online) ?? false
          }
        />

        <BucketToolbar
          state={state}
          canTick={canTick}
          labelOf={labelOf}
          dispatch={dispatch}
        />

        <div className="flex flex-wrap gap-4 text-sm">
          {totals.map((t) => (
            <div
              key={t.location}
              className="rounded-lg border px-4 py-2"
              title={t.location}
              data-testid="bucket-total"
            >
              <span className="font-semibold">{labelOf(t.location)}</span>{" "}
              {size(t.bytes)}{" "}
              <span className="text-muted-foreground">
                ({t.files} {t.files === 1 ? "file" : "files"})
              </span>
              {state.roots?.some(
                (r) =>
                  r.root === t.location && r.online && r.dirtyBit === "dirty"
              ) && (
                <Badge variant="destructive" className="ml-2">
                  Dirty
                </Badge>
              )}
              {t.location in state.unreadableRoots && (
                <Badge variant="destructive" className="ml-2">
                  Unreadable
                </Badge>
              )}
            </div>
          ))}
          {(state.roots ?? [])
            .filter((r) => !r.online)
            .map((r) => (
              <div key={r.root} className="rounded-lg border px-4 py-2">
                <span className="font-semibold">{r.label}</span>{" "}
                <Badge variant="destructive">Offline</Badge>
              </div>
            ))}
        </div>

        <table className="w-full text-sm" data-testid="bucket-files">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">On</th>
              {canTick && (
                <th className="py-2 pr-2 w-6">
                  <input
                    type="checkbox"
                    aria-label="Tick every file that can be deleted"
                    checked={allTicked(state)}
                    disabled={busy}
                    onChange={() => dispatch({ type: "tick-all-clicked" })}
                    data-testid="bucket-tick-all"
                  />
                </th>
              )}
              <th className="py-2 pr-4 font-medium">File</th>
              <th className="py-2 pr-4 font-medium">Kind</th>
              <th className="py-2 pr-4 font-medium text-right">Size</th>
              <th className="py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <FileRow
                key={file.path}
                state={state}
                file={file}
                canTick={canTick}
                busy={busy}
                labelOf={labelOf}
                dispatch={dispatch}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Above the list: "Delete originals on D:" for each drive that has copies
 * elsewhere, and "Delete N items" for the ticked files (#2423).
 */
function BucketToolbar({
  state,
  canTick,
  labelOf,
  dispatch,
}: {
  state: bucketPageReducer.State;
  canTick: boolean;
  labelOf: (location: string) => string;
  dispatch: (action: bucketPageReducer.Action) => void;
}) {
  const offers = originalsOffers(state);
  const busy = storageActionIsBusy(state.action);
  if (offers.length === 0 && !canTick) return null;
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      {offers.map((o) => (
        <Button
          key={o.location}
          variant="outline"
          size="sm"
          disabled={busy}
          title="Delete the files here that have an identical copy (size and checksum) on another drive. A file with no copy elsewhere is never deleted."
          onClick={() =>
            dispatch({
              type: "delete-originals-clicked",
              from: o.location,
            })
          }
          data-testid="delete-originals"
        >
          <CopyX className="w-4 h-4" /> Delete originals on{" "}
          {labelOf(o.location)} ({o.files} {o.files === 1 ? "file" : "files"},{" "}
          {size(o.bytes)})
        </Button>
      ))}
      {canTick && (
        <>
          <Button
            variant="destructive"
            size="sm"
            disabled={
              state.status !== "complete" || state.selected.length === 0 || busy
            }
            title={
              state.status !== "complete"
                ? "Wait for the listing to finish"
                : "Delete the ticked files for good, after a confirmation"
            }
            onClick={() => dispatch({ type: "delete-selected-clicked" })}
            data-testid="bucket-delete-selected"
          >
            <Trash2 className="w-4 h-4" /> Delete {state.selected.length}{" "}
            {state.selected.length === 1 ? "item" : "items"}
          </Button>
          <span className="text-muted-foreground">
            {size(selectedBytes(state))} ticked. Shift-click ticks a range.
          </span>
        </>
      )}
    </div>
  );
}

/**
 * A file's menu (#2157): Reveal in File System, its moves, then its deletes
 * last. Each move and delete confirms first.
 */
const fileMenuGroups = (
  actions: readonly FileAction[],
  onChoose: (choice: bucketPageReducer.FileChoice) => void
): ActionMenuGroups => {
  const leaf = (a: FileAction, icon: typeof Trash2, opensDialog: boolean) => ({
    label: a.label,
    icon,
    opensDialog,
    disabled: a.refusal !== null,
    ...(a.refusal !== null
      ? { description: a.refusal }
      : a.description !== undefined
        ? { description: a.description }
        : {}),
    onSelect: () => onChoose(a.choice),
  });
  return {
    open: actions
      .filter((a) => a.choice.type === "reveal")
      .map((a) => leaf(a, STANDARD_ACTIONS.revealInFileSystem.icon, false)),
    move: actions
      .filter((a) => a.choice.type === "move")
      .map((a) => leaf(a, STANDARD_ACTIONS.moveTo.icon, true)),
    danger: actions
      .filter(
        (a) => a.choice.type === "delete" || a.choice.type === "delete-original"
      )
      .map((a) => leaf(a, a.choice.type === "delete" ? Trash2 : CopyX, true)),
  };
};

function FileRow({
  state,
  file,
  canTick,
  busy,
  labelOf,
  dispatch,
}: {
  state: bucketPageReducer.State;
  file: StorageBucketFile;
  canTick: boolean;
  busy: boolean;
  labelOf: (location: string) => string;
  dispatch: (action: bucketPageReducer.Action) => void;
}) {
  // The menu is the whole file's; the row shows only its shown copies.
  const actions = fileActions(state, state.files[file.path] ?? file);
  return (
    <tr className="border-b align-top" data-testid="bucket-file">
      <td className="py-2 pr-4 whitespace-nowrap space-x-1">
        {Object.keys(file.copies).map((location) => (
          <Badge key={location} variant="secondary" title={location}>
            {labelOf(location)}
          </Badge>
        ))}
      </td>
      {canTick && (
        <td className="py-2 pr-2">
          {fileCanBeTicked(state, file.path) && (
            <input
              type="checkbox"
              aria-label={`Tick ${file.path}`}
              checked={state.selected.includes(file.path)}
              disabled={busy}
              readOnly
              onClick={(event) =>
                dispatch({
                  type: "file-ticked",
                  path: file.path,
                  shift: event.shiftKey,
                })
              }
              data-testid="bucket-file-tick"
            />
          )}
        </td>
      )}
      <td className="py-2 pr-4 break-all">
        <div>{file.path}</div>
        {file.companionOf && (
          <div className="text-xs text-muted-foreground">
            beside {file.companionOf}
          </div>
        )}
      </td>
      <td className="py-2 pr-4 whitespace-nowrap">{ROLE_LABELS[file.role]}</td>
      <td className="py-2 pr-4 text-right tabular-nums whitespace-nowrap">
        {size(file.bytes)}
      </td>
      <td className="py-2 text-right">
        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={state.status !== "complete" || busy}
                aria-label={`Actions for ${file.path}`}
                data-testid="bucket-file-actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <ActionMenuContent
              menu="dropdown"
              align="end"
              groups={fileMenuGroups(actions, (choice) =>
                dispatch({
                  type: "file-action-clicked",
                  path: file.path,
                  choice,
                })
              )}
            />
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}

function ListingStatus({
  state,
  fileCount,
}: {
  state: bucketPageReducer.State;
  fileCount: number;
}) {
  if (state.status === "listing") {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Listing… {fileCount} files
        so far
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="mt-2 text-sm text-destructive">
        Listing failed: {state.failure}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      {fileCount} {fileCount === 1 ? "file" : "files"}, listed at{" "}
      {state.fetchedAt === null
        ? "—"
        : toDate(state.fetchedAt).toLocaleTimeString()}
      .
    </p>
  );
}
