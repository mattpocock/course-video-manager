import type { EnvName } from "./env-names";

export const readEnv = (name: EnvName): string | undefined => process.env[name];
