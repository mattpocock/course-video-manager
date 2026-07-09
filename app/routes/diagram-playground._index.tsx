import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { sendToParent } from "@/lib/diagram-protocol";
// PROTOTYPE — wayfinder #135: search-box UI variants, gated by ?variant=.
import { VariantA } from "@/features/diagrams/search-prototype/variant-a";
import { VariantB } from "@/features/diagrams/search-prototype/variant-b";
import { VariantC } from "@/features/diagrams/search-prototype/variant-c";
import { PrototypeSwitcher } from "@/features/diagrams/search-prototype/prototype-switcher";
import { Effect } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { filteredNewestSnapshot } from "@/lib/filtered-newest-snapshot";
import { data } from "react-router";
import type { Route } from "./+types/diagram-playground._index";

export const meta: Route.MetaFunction = () => {
  return [{ title: "Diagram Playground" }];
};

export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const [diagrams, allSnapshots] = yield* Effect.all(
        [diagramOps.listDiagrams(), diagramOps.listAllSnapshotsWithClips()],
        { concurrency: "unbounded" }
      );

      const snapshotsByDiagram = new Map<
        string,
        {
          id: string;
          contentHash: string;
          preserved: boolean;
          createdAt: Date;
          clips: { archived: boolean }[];
        }[]
      >();
      for (const s of allSnapshots) {
        let arr = snapshotsByDiagram.get(s.diagramId);
        if (!arr) {
          arr = [];
          snapshotsByDiagram.set(s.diagramId, arr);
        }
        arr.push(s);
      }

      const tiles = diagrams.map((d) => {
        const snapshots = snapshotsByDiagram.get(d.id) ?? [];
        const newestId = filteredNewestSnapshot(snapshots);
        const newestSnapshot = newestId
          ? snapshots.find((s) => s.id === newestId)
          : null;
        return {
          id: d.id,
          name: d.name,
          updatedAt: d.updatedAt.toISOString(),
          thumbnailContentHash: newestSnapshot?.contentHash ?? null,
        };
      });

      return data({ tiles });
    }),
});

export default function DiagramPlaygroundHome({
  loaderData,
}: Route.ComponentProps) {
  const { tiles } = loaderData;
  const [params] = useSearchParams();
  const variant = params.get("variant") ?? "A";

  useEffect(() => {
    sendToParent({ type: "activeDiagramChanged", diagramId: null });
  }, []);

  useEffect(() => {
    function onFocus() {
      sendToParent({ type: "focus" });
    }
    function onBlur() {
      sendToParent({ type: "blur" });
    }
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    if (document.hasFocus()) sendToParent({ type: "focus" });
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-900 text-zinc-100">
      <div className="flex-1 overflow-y-auto p-6">
        {variant === "B" ? (
          <VariantB tiles={tiles} />
        ) : variant === "C" ? (
          <VariantC tiles={tiles} />
        ) : (
          <VariantA tiles={tiles} />
        )}
      </div>
      <PrototypeSwitcher />
    </div>
  );
}
