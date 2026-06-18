import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { createTestDb, truncateAllTables, type TestDb } from "./pglite";
import { DrizzleService } from "@/services/drizzle-service.server";

export interface EffectTestContext<R> {
  readonly testLayer: Layer.Layer<R>;
  run: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  readonly db: TestDb;
}

interface SetupOptions {
  readonly services: ReadonlyArray<Layer.Layer<any, any, DrizzleService>>;
  readonly extraProvide?: ReadonlyArray<Layer.Layer<any, never, never>>;
}

export function setupEffectTest(options: SetupOptions): EffectTestContext<any>;
export function setupEffectTest(
  ...serviceLayers: Layer.Layer<any, any, DrizzleService>[]
): EffectTestContext<any>;
export function setupEffectTest(
  ...args: [SetupOptions] | Layer.Layer<any, any, DrizzleService>[]
): EffectTestContext<any> {
  const isOptions = (v: unknown): v is SetupOptions =>
    v !== null &&
    typeof v === "object" &&
    "services" in (v as Record<string, unknown>);

  const { services, extraProvide } =
    args.length === 1 && isOptions(args[0])
      ? args[0]
      : {
          services: args as Layer.Layer<any, any, DrizzleService>[],
          extraProvide: undefined,
        };

  const ctx: { testLayer: Layer.Layer<any>; db: TestDb } = {} as any;

  beforeAll(async () => {
    const { testDb } = await createTestDb();
    (ctx as any).db = testDb;

    const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);

    let composed: Layer.Layer<any, any, never>;
    if (services.length === 0) {
      composed = drizzleLayer;
    } else if (services.length === 1) {
      composed = services[0]!.pipe(Layer.provide(drizzleLayer));
    } else {
      composed = Layer.mergeAll(
        ...(services as [
          Layer.Layer<any, any, DrizzleService>,
          ...Layer.Layer<any, any, DrizzleService>[],
        ])
      ).pipe(Layer.provide(drizzleLayer));
    }

    if (extraProvide && extraProvide.length > 0) {
      for (const extra of extraProvide) {
        composed = composed.pipe(Layer.provide(extra));
      }
    }

    (ctx as any).testLayer = composed;
  });

  beforeEach(async () => {
    await truncateAllTables(ctx.db);
  });

  return {
    get testLayer() {
      return ctx.testLayer;
    },
    get db() {
      return ctx.db;
    },
    run: <A, E>(effect: Effect.Effect<A, E, any>) =>
      Effect.runPromise(effect.pipe(Effect.provide(ctx.testLayer))),
  };
}
