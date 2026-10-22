/** Types for bundle.mjs, which stays plain JS so bin.mjs can run it on Node. */
export declare const DEFAULT_CACHE_DIR: string;
export declare const isBundleFresh: (cacheDir?: string) => Promise<boolean>;
export declare const buildBundle: (cacheDir?: string) => Promise<void>;
export declare const loadCli: (
  cacheDir?: string
) => Promise<typeof import("./main")>;
