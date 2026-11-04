import { Layer } from "effect";
import { GpuGate } from "@/services/gpu-gate";

/**
 * The GPU gate of a recorder that never records, for suites whose GPU work
 * (a stand-in ffmpeg, a faked Kokoro) is not about the gate. The gate itself
 * is tested in `gpu-gate.test.ts`.
 */
export const idleGpuGate = Layer.succeed(GpuGate, { run: (work) => work });
