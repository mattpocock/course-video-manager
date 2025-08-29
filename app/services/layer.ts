import { Layer } from "effect";
import { DBService } from "./db-service";
import { DatabaseDumpService } from "./dump-service";
import { RepoParserService } from "./repo-parser";
import { NodeContext } from "@effect/platform-node";

export const layerLive = Layer.mergeAll(
  RepoParserService.Default,
  DatabaseDumpService.Default,
  DBService.Default,
  NodeContext.layer
);
