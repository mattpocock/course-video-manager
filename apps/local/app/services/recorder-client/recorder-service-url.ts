import { DEAD_DESK_URL } from "live-desk/live-desk";
import { RECORDER_SERVICE_PORT } from "recorder-service/protocol";
import { realDrivesForbidden } from "@/packages/storage/server";

/**
 * Where an app server's recorder client connects. Matt's recorder service is
 * ONE Windows-backed service on a fixed loopback port, reachable from every
 * process in WSL: a second app server connected to it fights his for the
 * recorder. Each reconciles "open it for my editor's Video", so the recorder
 * flips between their Videos, Matt's editor flashes between "Opening the
 * recorder…" and "Ready to record.", and every flip re-arms the Take writer
 * (#2291: an agent's verify-cvm clone did exactly that mid-filming).
 *
 * So:
 *
 * - An agent's process (`realDrivesForbidden`: a verify-cvm run, a
 *   `cvm_verify_*` database, `CVM_NO_REAL_DRIVES=1`) never gets the real
 *   service, whatever its checkout: a verify clone is a full `git clone`,
 *   which `isMainCheckout` cannot tell from Matt's. An explicit
 *   `RECORDER_SERVICE_URL` (a fake service a test starts) is honoured only
 *   when it is not the real port.
 * - Otherwise `RECORDER_SERVICE_URL` wins, then the main checkout gets the
 *   real service and every other checkout the dead address.
 */
export const recorderServiceUrl = (o: {
  env: Readonly<Record<string, string | undefined>>;
  mainCheckout: () => boolean;
}): string => {
  const explicit = o.env.RECORDER_SERVICE_URL?.trim() || undefined;
  if (realDrivesForbidden(o.env)) {
    return explicit && !isRealService(explicit) ? explicit : DEAD_DESK_URL;
  }
  if (explicit) return explicit;
  return o.mainCheckout() ? REAL_RECORDER_SERVICE_URL : DEAD_DESK_URL;
};

export const REAL_RECORDER_SERVICE_URL = `ws://127.0.0.1:${RECORDER_SERVICE_PORT}`;

/** Any loopback spelling of the real service's port. */
const isRealService = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return Number(parsed.port) === RECORDER_SERVICE_PORT;
  } catch {
    // Unparseable: treat as the real one, so an agent never gets it by typo.
    return true;
  }
};
