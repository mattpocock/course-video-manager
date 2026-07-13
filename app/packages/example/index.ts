// Entry point (public). Import THIS from outside the package — never `./lib/*`.
// A deep module: the public surface is small (one function), while the actual
// behaviour is delegated to a hidden internal file.

import { shout } from "./lib/impl";

/** Turn a name into a greeting. Delegates the shouting to an internal helper. */
export function greet(name: string): string {
  return shout(`hello ${name}`);
}
