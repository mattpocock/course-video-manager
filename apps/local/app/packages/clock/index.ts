/**
 * The clock package: the one owner of `Date` and the timers in plain
 * TypeScript in apps/local. `now`, `nowMs` and `toDate` read and make dates;
 * `delay`, `after` and `every` schedule work, and `after` and `every` return
 * the function that cancels it. Effect code uses `Clock`, `DateTime`,
 * `Effect.sleep` and `Schedule` instead.
 */
export { now, nowMs, toDate } from "./lib/now";
export { after, delay, every } from "./lib/timers";
