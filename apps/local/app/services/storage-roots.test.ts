import { describe, expect, it } from "vitest";
import { judgeStorageRoots } from "./storage-roots";

describe("judgeStorageRoots (the startup check)", () => {
  const online = (dirs: string[]) => (root: string) => dirs.includes(root);

  it("refuses to start without STORAGE_ROOTS, naming it", () => {
    const { refusal } = judgeStorageRoots({}, online([]));
    expect(refusal).toMatch(/^STORAGE_ROOTS is not set/);
  });

  it("refuses an invalid list", () => {
    expect(
      judgeStorageRoots({ STORAGE_ROOTS: "mnt/d" }, online([])).refusal
    ).toMatch(/not an absolute directory/);
  });

  it("starts, reporting each root that is not there as offline", () => {
    expect(
      judgeStorageRoots({ STORAGE_ROOTS: "/mnt/d,/mnt/e" }, online(["/mnt/d"]))
    ).toEqual({ refusal: undefined, offline: ["/mnt/e"] });
  });
});

describe("judgeStorageRoots on a verify run (CVM_VERIFY_RUN_DIR set)", () => {
  const RUN = "/home/m/wt/.verify/run-1";
  const allOnline = () => true;
  // A filesystem where the run's scratch/raw-footage is a symlink to the real
  // Footage folder — the shape that once let a verify run resize real takes.
  const linkedFootage = (path: string) =>
    path === `${RUN}/scratch/raw-footage` ? "/mnt/d/raw-footage" : path;

  it("starts when every root and Storage Folder resolves inside the run", () => {
    expect(
      judgeStorageRoots(
        { STORAGE_ROOTS: `${RUN}/scratch`, CVM_VERIFY_RUN_DIR: RUN },
        allOnline,
        (p) => p
      ).refusal
    ).toBeUndefined();
  });

  it("refuses a Storage Folder symlinked out to a real drive", () => {
    expect(
      judgeStorageRoots(
        { STORAGE_ROOTS: `${RUN}/scratch`, CVM_VERIFY_RUN_DIR: RUN },
        allOnline,
        linkedFootage
      ).refusal
    ).toMatch(
      /raw-footage resolves to \/mnt\/d\/raw-footage, outside this verify run/
    );
  });

  it("refuses a real Storage Root", () => {
    expect(
      judgeStorageRoots(
        { STORAGE_ROOTS: `${RUN}/scratch,/mnt/d`, CVM_VERIFY_RUN_DIR: RUN },
        allOnline,
        (p) => p
      ).refusal
    ).toMatch(/Storage Root \/mnt\/d is on a real drive/);
  });

  it("does not take a sibling directory with the same prefix as inside", () => {
    expect(
      judgeStorageRoots(
        { STORAGE_ROOTS: `${RUN}0/scratch`, CVM_VERIFY_RUN_DIR: RUN },
        allOnline,
        (p) => p
      ).refusal
    ).toMatch(/outside this verify run/);
  });

  it("checks nothing when this is not a verify run", () => {
    expect(
      judgeStorageRoots({ STORAGE_ROOTS: "/mnt/d" }, allOnline, linkedFootage)
        .refusal
    ).toBeUndefined();
  });
});

describe("judgeStorageRoots for any agent's server", () => {
  // Never consulted for a refused root: the drive is not even stat'ed.
  const neverOnline = (root: string): boolean => {
    throw new Error(`stat'ed ${root}`);
  };

  it("refuses a real Storage Root on a cvm_verify_* database, before any stat", () => {
    expect(
      judgeStorageRoots(
        {
          STORAGE_ROOTS: "/mnt/d",
          DATABASE_URL: "postgresql://postgres@localhost:5433/cvm_verify_1",
        },
        neverOnline
      ).refusal
    ).toMatch(/Storage Root \/mnt\/d is on a real drive/);
  });

  it("refuses a real Storage Root with CVM_NO_REAL_DRIVES=1", () => {
    expect(
      judgeStorageRoots(
        { STORAGE_ROOTS: "/mnt/e", CVM_NO_REAL_DRIVES: "1" },
        neverOnline
      ).refusal
    ).toMatch(/Storage Root \/mnt\/e is on a real drive/);
  });

  it("leaves Matt's own server on his own database alone", () => {
    expect(
      judgeStorageRoots(
        {
          STORAGE_ROOTS: "/mnt/d,/mnt/e",
          DATABASE_URL: "postgresql://postgres@localhost:5432/cvm",
        },
        () => true
      )
    ).toEqual({ refusal: undefined, offline: [] });
  });
});
