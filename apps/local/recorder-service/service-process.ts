import { runRecorderService } from "./run-recorder-service";

/**
 * The recorder service's own process, spawned on demand by the app server
 * (ADR 0053). The only place the service calls process.exit.
 */
try {
  await runRecorderService();
  process.exit(0);
} catch (error) {
  console.error("recorder service failed:", error);
  process.exit(1);
}
