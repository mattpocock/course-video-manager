import nodeFs from "node:fs";
import path from "node:path";

/**
 * Matt's real drives (`/mnt/d`, `/mnt/e`). A server an agent runs never reads
 * them: decoding Footage there while the recorder records drops frames, and
 * agents never touch Matt's drives at all. An agent's verify-cvm run once
 * opened a Video whose Clips still stored absolute `/mnt/d/raw-footage/…`
 * paths; under the run's `scratch/` root those were "under no root", so they
 * were used as stored and ffmpeg decoded stills from the real Footage.
 */
const REAL_DRIVES = "/mnt";

/**
 * Set by verify-cvm on every process of a run: that run's own directory. Its
 * Storage Roots must resolve inside it (`services/storage-roots.ts`), and it
 * marks the process as an agent's.
 */
export const VERIFY_RUN_DIR_ENV_KEY = "CVM_VERIFY_RUN_DIR";

/** `1` marks any other process as an agent's: no real-drive reads. */
export const NO_REAL_DRIVES_ENV_KEY = "CVM_NO_REAL_DRIVES";

/** verify-cvm's databases: the template and every per-run clone. */
const VERIFY_DATABASE_PREFIX = "cvm_verify_";

const databaseName = (url: string | undefined): string | undefined => {
  if (url === undefined || url === "") return undefined;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  } catch {
    return undefined;
  }
};

/**
 * Whether this process is an agent's, and so must never read a real drive:
 * a verify-cvm run (`CVM_VERIFY_RUN_DIR`), a server on one of verify-cvm's
 * databases (`cvm_verify_*`), or `CVM_NO_REAL_DRIVES=1`. Matt's own
 * `pnpm dev` has none of these.
 */
export const realDrivesForbidden = (
  env: Readonly<Record<string, string | undefined>>
): boolean =>
  (env[VERIFY_RUN_DIR_ENV_KEY] ?? "").trim() !== "" ||
  env[NO_REAL_DRIVES_ENV_KEY] === "1" ||
  (databaseName(env.DATABASE_URL)?.startsWith(VERIFY_DATABASE_PREFIX) ?? false);

const onRealDrive = (p: string) =>
  p === REAL_DRIVES || p.startsWith(`${REAL_DRIVES}/`);

export interface LinkReader {
  readonly lstat: (p: string) => { isSymbolicLink(): boolean };
  readonly readlink: (p: string) => string;
}

const nodeLinks: LinkReader = {
  lstat: (p) => nodeFs.lstatSync(p),
  readlink: (p) => nodeFs.readlinkSync(p),
};

/**
 * The real-drive path `p` is on or reaches through symlinks, or `undefined`.
 *
 * `realpath` would stat the far side of a link, so this walks the path one
 * component at a time instead and stops the moment a component, or a link's
 * target, is under `/mnt`: nothing under `/mnt` is ever touched, not even
 * stat'ed. A component that does not exist ends the walk; the rest is judged
 * by name. A link loop counts as a real drive (refused, never followed).
 */
export const realDriveReached = (
  p: string,
  links: LinkReader = nodeLinks
): string | undefined => {
  let pending = path.posix.resolve(p).split("/").filter(Boolean);
  let current = "/";
  let hops = 0;
  while (pending.length > 0) {
    const next = path.posix.join(current, pending.shift()!);
    if (onRealDrive(next)) return path.posix.join(next, ...pending);
    let isLink: boolean;
    try {
      isLink = links.lstat(next).isSymbolicLink();
    } catch {
      const rest = path.posix.join(next, ...pending);
      return onRealDrive(rest) ? rest : undefined;
    }
    if (!isLink) {
      current = next;
      continue;
    }
    if (++hops > 40) return next;
    const target = path.posix.resolve(current, links.readlink(next));
    pending = [...target.split("/").filter(Boolean), ...pending];
    current = "/";
  }
  return undefined;
};

/**
 * Why this process may not read `p`, or `undefined` when it may: only an
 * agent's process (see {@link realDrivesForbidden}) is ever refused, and only
 * a path on, or resolving to, a real drive.
 */
export const realDriveRefusal = (
  p: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  links: LinkReader = nodeLinks
): string | undefined => {
  if (!realDrivesForbidden(env)) return undefined;
  const reached = realDriveReached(p, links);
  if (reached === undefined) return undefined;
  return `${p} is on a real drive (${reached}). This is an agent's server (verify-cvm: ${VERIFY_RUN_DIR_ENV_KEY}, a ${VERIFY_DATABASE_PREFIX}* database or ${NO_REAL_DRIVES_ENV_KEY}=1), and an agent never reads Matt's drives — it drops frames while he records. Use the Tiny Course's generated footage (verify.sh tiny-course) or a Video with no Clips.`;
};
