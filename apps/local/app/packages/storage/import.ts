// Entry point (server) for the storage package: Imported Footage on disk.
//
// `cvm footage import` names the file a copy goes to
// (`chooseImportDestination`: the source's own name, else the next free
// `-2`, `-3`), and its `import-footage` Sidecar Job copies it in
// (`copyIntoImportedFootage`): read-only on the source, written under a
// partial name, renamed into place once size and checksum match, never
// overwriting. `findImportedFootage` is the walk over every Storage Root's
// `raw-footage/imported/` that the listing and the search share;
// `searchImportedFootage` is that search (the CLI's and the page's).
export {
  FootageImportError,
  asFootageImportError,
  chooseImportDestination,
  copyIntoImportedFootage,
  findImportedFootage,
  removeImportPartial,
  type ImportedFootageFile,
} from "./lib/import.server";
export {
  searchImportedFootage,
  type ImportedFootageHit,
  type ImportedFootageSearchResult,
} from "./lib/search.server";
