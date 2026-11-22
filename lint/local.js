/**
 * The repo's own Oxlint plugin, `local`. One rule per file in `rules/`, each
 * with a RuleTester suite beside it and a planted violation in `canary/`.
 */
import allowedDirectives from "./rules/allowed-directives.js";
import clipInserts from "./rules/clip-inserts.js";
import dbClients from "./rules/db-clients.js";
import fsWrites from "./rules/fs-writes.js";
import noCjsPaths from "./rules/no-cjs-paths.js";
import noOverloads from "./rules/no-overloads.js";
import noUnsafeAs from "./rules/no-unsafe-as.js";
import responseBody from "./rules/response-body.js";
import routesFolder from "./rules/routes-folder.js";
import scriptDbUrl from "./rules/script-db-url.js";

export default {
  meta: { name: "local" },
  rules: {
    "allowed-directives": allowedDirectives,
    "clip-inserts": clipInserts,
    "db-clients": dbClients,
    "fs-writes": fsWrites,
    "no-cjs-paths": noCjsPaths,
    "no-overloads": noOverloads,
    "no-unsafe-as": noUnsafeAs,
    "response-body": responseBody,
    "routes-folder": routesFolder,
    "script-db-url": scriptDbUrl,
  },
};
