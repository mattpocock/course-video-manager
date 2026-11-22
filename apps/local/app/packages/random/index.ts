/**
 * The random package: the one owner of `Math.random` in plain TypeScript in
 * apps/local. `randomFraction` draws from [0, 1); `randomInt(bound)` draws a
 * whole number from [0, bound). Effect code uses `Random` instead.
 */
export { randomFraction, randomInt } from "./lib/random";
