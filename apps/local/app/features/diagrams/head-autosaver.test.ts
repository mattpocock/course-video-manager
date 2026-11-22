import { afterEach, describe, expect, it } from "vitest";
import {
  createShapeId,
  createTLStore,
  defaultShapeUtils,
  GeoShapeUtil,
  PageRecordType,
  type IndexKey,
  type TLGeoShape,
  type TLStoreSnapshot,
} from "tldraw";
import {
  createHeadAutosaver,
  type HeadAutosaver,
  type HeadSaveResult,
} from "./head-autosaver";
import { delay } from "@/packages/clock";

const DEBOUNCE_MS = 10;
/** Past the store's next-frame listener flush and the debounce together. */
const settle = () => delay(100);

const PAGE_ID = PageRecordType.createId("page");

const newStore = () => {
  const store = createTLStore({ shapeUtils: defaultShapeUtils });
  store.put([
    PageRecordType.create({
      id: PAGE_ID,
      name: "Page",
      index: "a1" as IndexKey,
    }),
  ]);
  return store;
};

const box = (x: number): TLGeoShape => ({
  id: createShapeId(`box-${x}`),
  typeName: "shape",
  type: "geo",
  parentId: PAGE_ID,
  index: "a1" as IndexKey,
  x,
  y: 0,
  rotation: 0,
  isLocked: false,
  opacity: 1,
  meta: {},
  props: GeoShapeUtil.prototype.getDefaultProps.call({} as GeoShapeUtil),
});

/** A stored head holding one shape, as the server would hand it back. */
const storedHead = (): TLStoreSnapshot => {
  const source = newStore();
  source.put([box(0)]);
  return source.getStoreSnapshot("document");
};

let autosaver: HeadAutosaver | null = null;
afterEach(() => autosaver?.dispose());

/**
 * A Diagram page's autosaver, recording its saves. The server answers each
 * with `answer`, by default storing it as head `h<n>`.
 */
type Answer = (n: number) => HeadSaveResult | Promise<HeadSaveResult>;

const mount = (
  answer: Answer = (n) => ({
    outcome: "saved",
    headHash: `h${n}`,
  })
) => {
  const store = newStore();
  const saves: {
    diagramId: string;
    document: TLStoreSnapshot;
    expectedHash: string | null | undefined;
  }[] = [];
  autosaver = createHeadAutosaver({
    store,
    debounceMs: DEBOUNCE_MS,
    save: async (diagramId, document, expectedHash) => {
      saves.push({ diagramId, document, expectedHash });
      return answer(saves.length);
    },
  });
  return { store, saves, autosaver };
};

/** Opens `d1` the way the Diagram page does: detach, load, attach. */
const openDiagram = (answer?: Answer) => {
  const mounted = mount(answer);
  mounted.autosaver.detach();
  // What `loadSnapshot` does to the document, minus the session state that
  // only a mounted Editor has.
  mounted.store.loadStoreSnapshot(storedHead());
  mounted.autosaver.attach("d1", "h0");
  return mounted;
};

describe("createHeadAutosaver", () => {
  it("does not save a diagram that was only opened", async () => {
    const { saves, autosaver } = openDiagram();
    await settle();
    await autosaver.flush();
    expect(saves).toEqual([]);
  });

  it("saves an edit once after the debounce", async () => {
    const { store, saves } = openDiagram();
    await settle();
    store.put([box(100)]);
    store.put([box(200)]);
    await settle();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.diagramId).toBe("d1");
    expect(Object.keys(saves[0]!.document.store)).toContain(
      createShapeId("box-200")
    );
  });

  it("saves nothing while detached, then saves edits once a head is attached", async () => {
    const { store, saves, autosaver } = mount();
    autosaver.detach();
    store.put([box(100)]);
    await settle();
    await autosaver.flush();
    expect(saves).toEqual([]);

    store.loadStoreSnapshot(storedHead());
    autosaver.attach("d1", "h0");
    store.put([box(200)]);
    await settle();
    expect(saves.map((s) => s.diagramId)).toEqual(["d1"]);
  });

  it("names the stored head each save replaces: the one it loaded, then the one it saved", async () => {
    const { store, saves, autosaver } = openDiagram();
    store.put([box(100)]);
    await autosaver.flush();
    store.put([box(200)]);
    await autosaver.flush();
    expect(saves.map((s) => s.expectedHash)).toEqual(["h0", "h1"]);
  });

  it("runs saves one at a time, so a second save names the head the first left", async () => {
    let landFirst = () => {};
    const { store, saves, autosaver } = openDiagram(async (n) => {
      if (n === 1) await new Promise<void>((r) => (landFirst = r));
      return { outcome: "saved", headHash: `h${n}` };
    });
    store.put([box(100)]);
    const first = autosaver.flush();
    await settle();
    // An edit while the first save is still on its way.
    store.put([box(200)]);
    const second = autosaver.flush();
    await settle();
    expect(saves).toHaveLength(1);
    landFirst();
    await Promise.all([first, second]);
    expect(saves.map((s) => s.expectedHash)).toEqual(["h0", "h1"]);
  });

  it("once the server refuses a save, it saves nothing more until told to overwrite", async () => {
    const { store, saves, autosaver } = openDiagram((n) =>
      n === 1 ? { outcome: "refused" } : { outcome: "saved", headHash: "h9" }
    );
    store.put([box(100)]);
    await autosaver.flush();
    store.put([box(200)]);
    await settle();
    await autosaver.flush();
    expect(saves).toHaveLength(1);
    expect(autosaver.hasUnsavedEdits()).toBe(true);

    await autosaver.flush({ overwrite: true });
    expect(saves.map((s) => s.expectedHash)).toEqual(["h0", undefined]);
    expect(autosaver.hasUnsavedEdits()).toBe(false);
  });
});
