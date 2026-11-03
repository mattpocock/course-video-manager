/** How often the Sidecar renews, heartbeats, polls and recovers. */
export interface SidecarTiming {
  /** How long the sidecar lease lasts without a renewal. */
  readonly leaseMs: number;
  readonly leaseRenewMs: number;
  /** How long a running Job's lease lasts without a heartbeat. */
  readonly jobLeaseMs: number;
  readonly jobHeartbeatMs: number;
  /** How often an idle lane looks for work when nothing nudges it. */
  readonly pollMs: number;
  /** How often expired Jobs are swept up. */
  readonly recoverEveryMs: number;
  /** How long to wait for a live lease held by another sidecar to lapse. */
  readonly lapseWaitMs: number;
  /** How long one look for an interrupted post at its service may take. */
  readonly postCheckTimeoutMs: number;
}

export const SIDECAR_TIMING: SidecarTiming = {
  leaseMs: 15_000,
  leaseRenewMs: 5_000,
  jobLeaseMs: 30_000,
  jobHeartbeatMs: 10_000,
  pollMs: 1_000,
  recoverEveryMs: 15_000,
  lapseWaitMs: 20_000,
  postCheckTimeoutMs: 30_000,
};
