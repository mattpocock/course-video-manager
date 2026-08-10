import { describe, it, expect } from "vitest";
import { canonicalize, hashScene } from "./scene-hash";

describe("canonicalize", () => {
  it("produces identical output regardless of key insertion order", () => {
    const sceneA = {
      store: { "shape:abc": { id: "abc", x: 10 } },
      schema: { schemaVersion: 2 },
    };
    const sceneB = {
      schema: { schemaVersion: 2 },
      store: { "shape:abc": { x: 10, id: "abc" } },
    };

    expect(canonicalize(sceneA)).toBe(canonicalize(sceneB));
  });

  it("produces different output for semantically different scenes", () => {
    const sceneA = {
      store: { "shape:abc": { id: "abc", x: 10 } },
      schema: { schemaVersion: 2 },
    };
    const sceneB = {
      store: { "shape:abc": { id: "abc", x: 20 } },
      schema: { schemaVersion: 2 },
    };

    expect(canonicalize(sceneA)).not.toBe(canonicalize(sceneB));
  });

  it("includes schema field in output — different schema versions produce different results", () => {
    const store = { "shape:abc": { id: "abc", x: 10 } };
    const sceneV2 = { store, schema: { schemaVersion: 2 } };
    const sceneV3 = { store, schema: { schemaVersion: 3 } };

    expect(canonicalize(sceneV2)).not.toBe(canonicalize(sceneV3));
  });

  it("handles nested objects and arrays deterministically", () => {
    const sceneA = {
      store: {
        "shape:a": { props: { color: "red", size: 5 }, children: [1, 2, 3] },
      },
      schema: { schemaVersion: 1 },
    };
    const sceneB = {
      schema: { schemaVersion: 1 },
      store: {
        "shape:a": { children: [1, 2, 3], props: { size: 5, color: "red" } },
      },
    };

    expect(canonicalize(sceneA)).toBe(canonicalize(sceneB));
  });

  it("preserves array element order — different order produces different output", () => {
    const sceneA = {
      store: { "shape:a": { points: [1, 2, 3] } },
      schema: { schemaVersion: 1 },
    };
    const sceneB = {
      store: { "shape:a": { points: [3, 2, 1] } },
      schema: { schemaVersion: 1 },
    };

    expect(canonicalize(sceneA)).not.toBe(canonicalize(sceneB));
  });

  it("distinguishes null values from missing keys", () => {
    const sceneA = {
      store: { "shape:a": { color: null } },
      schema: { schemaVersion: 1 },
    };
    const sceneB = {
      store: { "shape:a": {} },
      schema: { schemaVersion: 1 },
    };

    expect(canonicalize(sceneA)).not.toBe(canonicalize(sceneB));
  });
});

describe("hashScene", () => {
  it("produces identical hashes for scenes with different key order", () => {
    const sceneA = {
      store: { "shape:abc": { id: "abc", x: 10 } },
      schema: { schemaVersion: 2 },
    };
    const sceneB = {
      schema: { schemaVersion: 2 },
      store: { "shape:abc": { x: 10, id: "abc" } },
    };

    expect(hashScene(sceneA)).toBe(hashScene(sceneB));
  });

  it("produces different hashes for semantically different scenes", () => {
    const sceneA = {
      store: { "shape:abc": { id: "abc", x: 10 } },
      schema: { schemaVersion: 2 },
    };
    const sceneB = {
      store: { "shape:abc": { id: "abc", x: 20 } },
      schema: { schemaVersion: 2 },
    };

    expect(hashScene(sceneA)).not.toBe(hashScene(sceneB));
  });

  it("produces different hashes when schema version differs (contract)", () => {
    const store = { "shape:abc": { id: "abc", x: 10 } };
    const sceneV2 = { store, schema: { schemaVersion: 2 } };
    const sceneV3 = { store, schema: { schemaVersion: 3 } };

    expect(hashScene(sceneV2)).not.toBe(hashScene(sceneV3));
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashScene({ store: {}, schema: { schemaVersion: 1 } });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
