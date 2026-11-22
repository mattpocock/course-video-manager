import {
  AlertTriangle,
  HardDrive,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";
import { RemountCommand } from "@/components/remount-command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActionMenuContent } from "@/features/action-menu/action-menu";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import {
  StorageActionDialog,
  StorageActionFailure,
} from "@/features/storage/storage-action-dialog";
import { storageActionIsBusy } from "@/features/storage/storage-action";
import { RootFilterChips } from "@/features/storage/root-filter-chips";
import { isShown, withRootFilter } from "@/features/storage/root-filter";
import { StorageJobsPanel } from "@/features/storage/storage-jobs-panel";
import { shownStorageJobs } from "@/features/storage/storage-jobs";
import { useStorageJobs } from "@/features/storage/use-storage-jobs";
import {
  driveWarnings,
  rowCanBePurged,
  rowMoveActions,
  storageCells,
  storageRootChips,
  storageRows,
  type StorageRow,
  type storagePageReducer,
} from "@/features/storage/storage-page-reducer";
import { useStoragePage } from "@/features/storage/use-storage-page";
import {
  bucketCanBeDeleted,
  STORAGE_MOVE_KIND_LABELS,
  type StorageFileKind,
} from "@/packages/storage/client";
import type { Route } from "./+types/_app.storage";
import { toDate } from "@/packages/clock";

export const meta: Route.MetaFunction = () => [{ title: "CVM - Storage" }];

/** Gigabytes as Windows counts them (GiB), to one decimal place. */
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const KINDS: { kind: StorageFileKind; heading: string }[] = [
  { kind: "footage", heading: "Footage" },
  { kind: "exported-videos", heading: "Exported Videos" },
  { kind: "other", heading: "Other files" },
];

/**
 * The Storage page (#2107): each Storage Root with its free space, then one
 * row per Storage Bucket, largest first, split into Footage and Exported
 * Videos per root. Each bucket's name opens its per-bucket page. A row moves
 * its Footage, Exported Videos or Clip Mockups to another drive as a Sidecar
 * Job (#2109). A Course's, Standalone Videos' or Shorts' Exported Videos can
 * be deleted (#2111); the Other buckets that are rebuilt on demand can be
 * deleted (#2112). Counted fresh on every visit and streamed in; leaving the
 * page stops the scan. Toggle chips filter by Storage Root (#2431).
 */
export default function StoragePage() {
  const [state, dispatch] = useStoragePage();
  const rows = storageRows(state);
  const warnings = driveWarnings(state);
  // A drive reads "D:"; any other folder by its last segment (the full path
  // is on the root's card).
  const labelOf = (location: string) => {
    const label =
      state.roots?.find((r) => r.root === location)?.label ?? location;
    return label.startsWith("/") ? `…/${label.split("/").pop()}` : label;
  };
  const jobs = useStorageJobs(null, labelOf, dispatch);

  return (
    <div className="flex-1 overflow-y-auto bg-background text-foreground">
      <div className="p-8 max-w-6xl space-y-8">
        <div>
          <div className="flex items-center justify-between gap-4 mb-2">
            <h1 className="text-3xl font-bold">Storage</h1>
            <Button
              variant="outline"
              size="sm"
              disabled={
                state.status === "scanning" || storageActionIsBusy(state.action)
              }
              onClick={() => dispatch({ type: "refresh-clicked" })}
              data-testid="storage-refresh"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
          </div>
          <p className="text-muted-foreground">Where the space is going.</p>
          <ScanStatus state={state} />
        </div>

        <RootFilterChips
          chips={storageRootChips(state)}
          labelOf={labelOf}
          isOffline={(location) =>
            state.roots?.some((r) => r.root === location && !r.online) ?? false
          }
        />

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
        <StorageJobsPanel
          jobs={shownStorageJobs(jobs.views, state.watchedJobs)}
          onCancel={jobs.cancelJob}
        />

        {(warnings.offline.length > 0 || warnings.dirty.length > 0) && (
          <section className="space-y-2" data-testid="drive-warnings">
            {warnings.offline.map((root) => (
              <div
                key={root.root}
                className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm"
                data-testid="drive-offline"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
                <div className="flex-1 space-y-2">
                  <p>
                    <strong>{labelOf(root.root)} is Offline.</strong> Its files
                    can't be counted, played or exported, and nothing can be
                    moved to it until it is plugged in.
                  </p>
                  {root.remountCommand !== null && (
                    <RemountCommand command={root.remountCommand} />
                  )}
                </div>
              </div>
            ))}
            {warnings.dirty.map((root) => (
              <div
                key={root.root}
                className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
                data-testid="drive-dirty"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                <span>
                  <strong>{labelOf(root.root)} is Dirty:</strong> run chkdsk,
                  keep originals.
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(state.roots ?? [])
            .filter((root) => isShown(state.hiddenRoots, root.root))
            .map((root) => (
              <div
                key={root.root}
                className="rounded-lg border p-4 space-y-1"
                data-testid="storage-root"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <HardDrive className="w-4 h-4 shrink-0" />
                  {labelOf(root.root)}
                  <span
                    className="text-xs text-muted-foreground font-normal truncate"
                    title={root.root}
                  >
                    {root.root}
                  </span>
                  {!root.online && <Badge variant="destructive">Offline</Badge>}
                  {root.online && root.dirtyBit === "dirty" && (
                    <Badge className="bg-amber-500 text-black">Dirty</Badge>
                  )}
                  {root.online && root.root in state.unreadableRoots && (
                    <Badge variant="destructive">Unreadable</Badge>
                  )}
                </div>
                {root.online ? (
                  <div className="text-sm text-muted-foreground">
                    {gb(root.freeBytes)} free of {gb(root.totalBytes)} (
                    {gb(root.totalBytes - root.freeBytes)} used)
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground break-all">
                    {root.reason}
                  </div>
                )}
              </div>
            ))}
        </section>

        <table className="w-full text-sm" data-testid="storage-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Storage Bucket</th>
              <th className="py-2 pr-4 font-medium text-right">Total</th>
              {KINDS.map(({ kind, heading }) => (
                <th key={kind} className="py-2 pr-4 font-medium">
                  {heading}
                </th>
              ))}
              <th className="py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <BucketRow
                key={row.bucket.id}
                state={state}
                row={row}
                labelOf={labelOf}
                onChoose={(choice) =>
                  dispatch({
                    type: "row-action-clicked",
                    bucketId: row.bucket.id,
                    choice,
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScanStatus({ state }: { state: storagePageReducer.State }) {
  if (state.status === "scanning") {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Scanning…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="mt-2 text-sm text-destructive">
        Scan failed: {state.failure}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Counted at{" "}
      {state.fetchedAt === null
        ? "—"
        : toDate(state.fetchedAt).toLocaleTimeString()}
      .
    </p>
  );
}

function BucketRow({
  state,
  row,
  labelOf,
  onChoose,
}: {
  state: storagePageReducer.State;
  row: StorageRow;
  labelOf: (location: string) => string;
  onChoose: (choice: storagePageReducer.RowChoice) => void;
}) {
  const busy = state.status !== "complete" || storageActionIsBusy(state.action);
  const moves = rowMoveActions(state, row);
  const canDelete = bucketCanBeDeleted(row.bucket);
  const canPurge = rowCanBePurged(row);
  const canDeleteUnused = row.bucket.kind === "unused-footage";
  const hasActions =
    moves.length > 0 || canDelete || canPurge || canDeleteUnused;
  return (
    <tr className="border-b align-top" data-testid="storage-row">
      <td className="py-2 pr-4">
        <Link
          to={withRootFilter(
            `/storage/${encodeURIComponent(row.bucket.id)}`,
            state.hiddenRoots
          )}
          className="font-medium hover:underline"
          data-testid="storage-bucket-link"
        >
          {row.bucket.name}
        </Link>
        {row.bucket.sharedBy && row.bucket.sharedBy.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Used by {row.bucket.sharedBy.join(", ")}
          </div>
        )}
      </td>
      <td className="py-2 pr-4 text-right font-medium tabular-nums whitespace-nowrap">
        {gb(row.totalBytes)}
      </td>
      {KINDS.map(({ kind }) => (
        <td key={kind} className="py-2 pr-4 tabular-nums whitespace-nowrap">
          {row.bytes[kind] === 0 &&
          !storageCells(state, row, kind).some((c) => c.type === "offline") ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            storageCells(state, row, kind).map((cell) => (
              <div key={cell.location}>
                <span className="text-muted-foreground">
                  {labelOf(cell.location)}
                </span>{" "}
                {cell.type === "offline" ? (
                  <span className="text-destructive">Offline</span>
                ) : (
                  gb(cell.bytes)
                )}
              </div>
            ))
          )}
        </td>
      ))}
      <td className="py-2 text-right">
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                title={
                  state.status !== "complete"
                    ? "Wait for the count to finish"
                    : `Actions for ${row.bucket.name}`
                }
                aria-label={`Actions for ${row.bucket.name}`}
                data-testid="storage-row-actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <ActionMenuContent
              menu="dropdown"
              align="end"
              groups={{
                move: moves.map(({ kind, target, refusal }) => ({
                  label: `Move ${STORAGE_MOVE_KIND_LABELS[kind]} to ${labelOf(target.root)}`,
                  icon: STANDARD_ACTIONS.moveTo.icon,
                  opensDialog: true,
                  disabled: refusal !== null,
                  ...(refusal === null ? {} : { description: refusal }),
                  onSelect: () =>
                    onChoose({ type: "move", kind, target: target.root }),
                })),
                danger: [
                  canPurge && {
                    label: "Delete Exported Videos",
                    icon: Trash2,
                    opensDialog: true,
                    onSelect: () => onChoose({ type: "purge" }),
                  },
                  canDelete && {
                    ...STANDARD_ACTIONS.delete,
                    opensDialog: true,
                    onSelect: () => onChoose({ type: "delete-bucket" }),
                  },
                  canDeleteUnused && {
                    label: "Delete All Unused Footage",
                    icon: Trash2,
                    opensDialog: true,
                    onSelect: () => onChoose({ type: "delete-unused" }),
                  },
                ],
              }}
            />
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}
