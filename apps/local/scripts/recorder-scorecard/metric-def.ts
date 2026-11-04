/** One scorecard metric: its target, and OBS's value where there is evidence. */
export type MetricGroup = "speed" | "reliability" | "resources";

export type MetricDef = {
  id: string;
  label: string;
  group: MetricGroup;
  unit: string;
  better: "lower" | "higher";
  target: number;
  /** OBS's value, or null: no evidence. */
  obs: number | null;
  obsSource?: string;
  /** What one "unit of badness" is, to rank gaps of different units together. */
  scale: number;
  note?: string;
};
