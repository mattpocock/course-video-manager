// OBS's per-source sync offsets, read from its scene collection JSON
// (%APPDATA%\obs-studio\basic\scenes\<collection>.json). Matt's mic source
// carries a deliberate +150 ms "Sync Offset" (Advanced Audio Properties), so
// OBS's file has the mic 150 ms later than the device delivered it, and the
// baseline's audio - camera median carries that. Lip sync vs OBS takes it off
// (judge-sync.ts lipSyncVsObs). obsMicSyncOffset is pure; rig-obs.ts saves a
// copy of the collection with each baseline, and baselineObsOffset reads it.
import fs from "node:fs";
import path from "node:path";

type ObsSource = {
  name?: string;
  id?: string;
  sync?: number;
  muted?: boolean;
  mixers?: number;
  settings?: { items?: { name?: string; visible?: boolean }[] };
};

export type ObsSyncOffset = {
  /** The mic's sync offset (ms) OBS applied in this scene; null if it can't be told. */
  audioOffsetMs: number | null;
  /** Each audible mic source in the scene and its offset (ms). */
  sources: { name: string; kind: string; syncMs: number }[];
  detail: string;
};

/** Audio inputs (microphones), not output captures and not a camera's own audio. */
const MIC_KIND = /_input_capture$/;
const nsToMs = (ns: number | undefined) =>
  Math.round(((ns ?? 0) / 1e6) * 10) / 10;

export function obsMicSyncOffset(
  collection: unknown,
  scene = "Code"
): ObsSyncOffset {
  const c = (collection ?? {}) as Record<string, unknown>;
  const all = (Array.isArray(c.sources) ? c.sources : []) as ObsSource[];
  const byName = new Map(all.map((s) => [s.name, s]));
  if (!byName.has(scene))
    return {
      audioOffsetMs: null,
      sources: [],
      detail: `no scene "${scene}" in the OBS scene collection`,
    };
  // The scene's visible items, through nested scenes and groups.
  const inScene: ObsSource[] = [];
  const seen = new Set<string>();
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const s = byName.get(name);
    if (!s) return;
    if (s.id === "scene" || s.id === "group") {
      for (const it of s.settings?.items ?? [])
        if (it.name && it.visible !== false) walk(it.name);
    } else inScene.push(s);
  };
  walk(scene);
  // OBS's global audio devices (Settings → Audio) are in every scene.
  for (const [k, v] of Object.entries(c))
    if (/^(DesktopAudioDevice|AuxAudioDevice)\d+$/.test(k) && v)
      inScene.push(v as ObsSource);
  const mics = inScene
    .filter((s) => MIC_KIND.test(s.id ?? ""))
    .filter((s) => !s.muted && (s.mixers ?? 0xff) !== 0)
    .map((s) => ({
      name: s.name ?? "?",
      kind: s.id ?? "?",
      syncMs: nsToMs(s.sync),
    }));
  if (!mics.length)
    return {
      audioOffsetMs: 0,
      sources: [],
      detail: `no audible mic source in scene "${scene}": 0 ms`,
    };
  const distinct = [...new Set(mics.map((m) => m.syncMs))];
  const list = mics.map((m) => `"${m.name}" ${m.syncMs} ms`).join(", ");
  if (distinct.length > 1)
    return {
      audioOffsetMs: null,
      sources: mics,
      detail: `mic sources in scene "${scene}" disagree (${list}): can't tell which one the markers came through`,
    };
  return {
    audioOffsetMs: distinct[0]!,
    sources: mics,
    detail: `OBS scene "${scene}": ${list}`,
  };
}

/** The copy of OBS's scene collection a baseline saves (rig-obs.ts). */
export const OBS_SCENES_FILE = "obs-scene-collection.json";

/** OBS's mic sync offset for the baseline: its saved collection, else `obsScenes`, else unknown. */
export function baselineObsOffset(
  baselineDir: string | undefined,
  obsScenes: string | undefined
): (ObsSyncOffset & { from: string }) | null {
  const saved = baselineDir && path.join(baselineDir, OBS_SCENES_FILE);
  const file =
    saved && fs.existsSync(saved)
      ? saved
      : obsScenes && fs.existsSync(obsScenes)
        ? obsScenes
        : null;
  if (!file) return null;
  return {
    ...obsMicSyncOffset(JSON.parse(fs.readFileSync(file, "utf8"))),
    from: file,
  };
}
