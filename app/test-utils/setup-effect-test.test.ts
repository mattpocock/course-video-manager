import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import * as schema from "@/db/schema";
import { setupEffectTest } from "./setup-effect-test";

describe("setupEffectTest", () => {
  describe("spread-args signature (single service)", () => {
    const ctx = setupEffectTest(PitchOperationsService.Default);

    it.effect("resolves the composed service via testLayer", () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;
        const pitch = yield* pitchOps.createPitch();
        expect(pitch.id).toEqual(expect.any(String));
      }).pipe(Effect.provide(ctx.testLayer))
    );

    it("exposes a usable db for direct queries", async () => {
      const pitches = await ctx.db.query.pitches.findMany();
      expect(pitches).toEqual([]);
    });

    it("run helper executes effects against the correct layer", async () => {
      const pitch = await ctx.run(
        Effect.gen(function* () {
          const pitchOps = yield* PitchOperationsService;
          return yield* pitchOps.createPitch();
        })
      );
      expect(pitch.id).toEqual(expect.any(String));
    });

    it("truncates DB between tests (this test sees an empty DB)", async () => {
      const pitches = await ctx.db.query.pitches.findMany();
      expect(pitches).toEqual([]);
    });
  });

  describe("spread-args signature (multiple services)", () => {
    const ctx = setupEffectTest(
      PitchOperationsService.Default,
      DiagramOperationsService.Default
    );

    it.effect("resolves multiple services from a single testLayer", () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;
        const diagramOps = yield* DiagramOperationsService;

        const pitch = yield* pitchOps.createPitch();
        const diagram = yield* diagramOps.createDiagram();

        expect(pitch.id).toEqual(expect.any(String));
        expect(diagram.id).toEqual(expect.any(String));
      }).pipe(Effect.provide(ctx.testLayer))
    );
  });

  describe("options-object signature", () => {
    const ctx = setupEffectTest({
      services: [
        PitchOperationsService.Default,
        DiagramOperationsService.Default,
      ],
    });

    it.effect("resolves services passed via options.services", () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;
        const pitch = yield* pitchOps.createPitch();
        expect(pitch.id).toEqual(expect.any(String));
      }).pipe(Effect.provide(ctx.testLayer))
    );
  });

  describe("zero-services (DB-only)", () => {
    const ctx = setupEffectTest();

    it("provides a usable db without any Effect service layers", async () => {
      const [inserted] = await ctx.db
        .insert(schema.pitches)
        .values({
          title: "direct-insert",
          description: "",
          contentPlan: "",
          youtubeTitle: "",
          youtubeThumbnailDescription: "",
          newsletterTitle: "",
          tweet: "",
        })
        .returning();

      expect(inserted!.title).toBe("direct-insert");
    });

    it("truncates between tests even in DB-only mode", async () => {
      const pitches = await ctx.db.query.pitches.findMany();
      expect(pitches).toEqual([]);
    });
  });

  describe("per-test truncation verification", () => {
    const ctx = setupEffectTest(PitchOperationsService.Default);

    it("test A: inserts data", async () => {
      await ctx.run(
        Effect.gen(function* () {
          const pitchOps = yield* PitchOperationsService;
          yield* pitchOps.createPitch();
          yield* pitchOps.createPitch();
        })
      );
      const pitches = await ctx.db.query.pitches.findMany();
      expect(pitches).toHaveLength(2);
    });

    it("test B: sees empty DB (proves truncation between A and B)", async () => {
      const pitches = await ctx.db.query.pitches.findMany();
      expect(pitches).toEqual([]);
    });
  });
});
