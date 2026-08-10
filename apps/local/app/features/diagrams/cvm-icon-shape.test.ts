import { describe, it, expect } from "vitest";
import {
  createShapeId,
  createTLStore,
  defaultShapeUtils,
  loadSnapshot,
  PageRecordType,
} from "tldraw";
import { CVM_SHAPE_UTILS } from "./cvm-shape-utils";
import { CvmIconShapeUtil } from "./cvm-icon-shape";

/**
 * The one way this feature can destroy access to a document: an unregistered
 * shape type fails schema validation with a throw that kills the ENTIRE
 * document load. These tests run the real store schema over a real
 * `cvm-icon` record, which is the same validation both render surfaces do.
 */
function makeStore(opts?: { withCvmUtils?: boolean }) {
  return createTLStore({
    shapeUtils: [
      ...defaultShapeUtils,
      ...(opts?.withCvmUtils === false ? [] : CVM_SHAPE_UTILS),
    ],
  });
}

function iconScene(props: Record<string, unknown>) {
  const store = makeStore();
  const page = PageRecordType.create({ name: "Page 1", index: "a1" as never });
  store.put([page]);

  store.put([
    {
      id: createShapeId("icon1"),
      typeName: "shape",
      type: "cvm-icon",
      x: 0,
      y: 0,
      rotation: 0,
      index: "a1",
      parentId: page.id,
      isLocked: false,
      opacity: 1,
      meta: {},
      props,
    } as never,
  ]);
  return store.getStoreSnapshot();
}

describe("registration", () => {
  it("uses the prefixed `cvm-icon` type, never bare `icon`", () => {
    // tldraw owns the unprefixed namespace; a future `icon` builtin would
    // collide irrecoverably inside already-persisted documents.
    expect(CvmIconShapeUtil.type).toBe("cvm-icon");
  });

  it("loads a document containing an icon once the util is registered", () => {
    const scene = iconScene({
      name: "database",
      w: 48,
      h: 48,
      color: "white",
      dash: "solid",
    });
    const target = makeStore();
    expect(() => loadSnapshot(target, { document: scene })).not.toThrow();
    expect(
      [...target.allRecords()].some(
        (r) => (r as { type?: string }).type === "cvm-icon"
      )
    ).toBe(true);
  });

  it("kills the whole document load when the util is NOT registered", () => {
    // The hazard this registration exists to close, demonstrated rather than
    // asserted in prose.
    const scene = iconScene({
      name: "database",
      w: 48,
      h: 48,
      color: "white",
      dash: "solid",
    });
    const bare = makeStore({ withCvmUtils: false });
    expect(() => loadSnapshot(bare, { document: scene })).toThrow();
  });
});

describe("props validation", () => {
  it("lets an UNKNOWN icon name survive validation and round-trip untouched", () => {
    // `name` is deliberately not an enum over the vendored names: an enum would
    // throw at load and take the whole document with it, turning a recoverable
    // rendering problem into a data-integrity one.
    const scene = iconScene({
      name: "an-icon-this-build-has-never-heard-of",
      w: 48,
      h: 48,
      color: "white",
      dash: "solid",
    });
    const target = makeStore();
    expect(() => loadSnapshot(target, { document: scene })).not.toThrow();

    const icon = [...target.allRecords()].find(
      (r) => (r as { type?: string }).type === "cvm-icon"
    ) as { props: { name: string } };
    expect(icon.props.name).toBe("an-icon-this-build-has-never-heard-of");
  });

  it("rejects an empty name", () => {
    expect(() =>
      iconScene({ name: "", w: 48, h: 48, color: "white", dash: "solid" })
    ).toThrow();
  });
});

describe("defaults", () => {
  it("defaults to white, solid, and a square box", () => {
    const util = new CvmIconShapeUtil({} as never);
    const props = util.getDefaultProps();
    expect(props.color).toBe("white");
    expect(props.dash).toBe("solid");
    expect(props.w).toBe(props.h);
  });
});

describe("geometry", () => {
  const util = new CvmIconShapeUtil({} as never);
  const shape = (name: string, w = 96, h = 96) =>
    ({
      id: createShapeId("g"),
      props: { name, w, h, color: "white", dash: "solid" },
    }) as never;

  it("traces the glyph rather than boxing it — strokes only, no filled rect", () => {
    const geometry = util.getGeometry(shape("database"));
    // A filled first child would make the whole bounding box clickable. This
    // shape is deliberately the only one in the document that does not do that.
    expect(geometry.isFilled).toBe(false);
  });

  it("falls back to the shape's bounds for an unknown name", () => {
    const geometry = util.getGeometry(shape("not-a-real-icon", 120, 120));
    expect(geometry.bounds.width).toBe(120);
    expect(geometry.bounds.height).toBe(120);
  });

  it("has no indicator path for an unknown name", () => {
    expect(util.getIndicatorPath(shape("not-a-real-icon"))).toBeUndefined();
  });
});
