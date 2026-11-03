/**
 * UK wall-clock time (Europe/London), turned into instants and back, across
 * the clock changes. The zone is stated rather than taken from the machine:
 * the deployed API runs in UTC.
 */
export const LONDON_TIME_ZONE = "Europe/London";

/** How far `zone` is ahead of UTC at the instant `utcMs`, in ms. */
const zoneOffsetMs = (utcMs: number, zone: string): number => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (type: string) =>
    Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour"),
    n("minute"),
    n("second")
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
};

/** A wall-clock reading `[y, mo, d, h, mi, s]` in `zone` → epoch ms. */
export const zonedToEpochMs = (
  fields: ReadonlyArray<number>,
  zone: string
): number => {
  const [y, mo, d, h = 0, mi = 0, s = 0] = fields as number[];
  const naive = Date.UTC(y!, mo! - 1, d!, h, mi, s);
  const first = naive - zoneOffsetMs(naive, zone);
  // Recheck at the result: the offset differs across a clock change.
  return naive - zoneOffsetMs(first, zone);
};

/** A UK calendar date, `YYYY-MM-DD`. */
export type LondonDate = string;

/** The UK calendar date the instant `ms` falls on. */
export const londonDateOf = (ms: number): LondonDate => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const p = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${p("year")}-${p("month")}-${p("day")}`;
};

/** The UK wall-clock `HH:MM` the instant `ms` reads as. */
export const londonTimeOf = (ms: number): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));

const dateFields = (date: LondonDate): [number, number, number] => {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
};

/** The instant UK wall clock reads `hhmm` (`HH:MM`) on `date`. */
export const londonInstant = (date: LondonDate, hhmm: string): number => {
  const [h, mi] = hhmm.split(":").map(Number);
  return zonedToEpochMs([...dateFields(date), h!, mi!, 0], LONDON_TIME_ZONE);
};

/** The instant `date` begins: 00:00 UK time. */
export const londonMidnight = (date: LondonDate): number =>
  londonInstant(date, "00:00");

/** The UK date `days` after `date` (negative goes back). */
export const addLondonDays = (date: LondonDate, days: number): LondonDate => {
  const [y, m, d] = dateFields(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** 0 = Sunday … 6 = Saturday, as `Date#getDay`. */
export const londonWeekday = (date: LondonDate): number => {
  const [y, m, d] = dateFields(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The instant `ms` as UK wall-clock time, e.g. `Tue 2026-11-03 13:00`. */
export const formatLondon = (ms: number): string => {
  const date = londonDateOf(ms);
  return `${WEEKDAYS[londonWeekday(date)]} ${date} ${londonTimeOf(ms)}`;
};
