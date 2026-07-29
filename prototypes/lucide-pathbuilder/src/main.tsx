/**
 * PROTOTYPE — throwaway. Answers issue #206:
 * "Can an arbitrary lucide icon be rendered faithfully as a custom tldraw shape
 * via PathBuilder, and what does the transpiler contract look like?"
 *
 * Three tabs:
 *   canvas  — a real tldraw editor with the custom IconShapeUtil
 *   compare — source SVG vs transpiled path, side by side, at several sizes
 *   sweep   — pixel-diff every icon; run the hit-test sweep
 */

import { createRoot } from "react-dom/client";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { Tldraw, createShapeId, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import {
  ICON_NAMES,
  IconShapeUtil,
  setHitMode,
  setStrokeMode,
  type HitMode,
  type StrokeMode,
} from "./icon-shape-util";
import {
  runFidelitySweep,
  sourceSvgMarkup,
  transpiledSvgMarkup,
  type IconFidelity,
} from "./fidelity-sweep";
import { runHitTestSweep } from "./hit-test-sweep";
import { runGeometrySweep } from "./geometry-sweep";

const SHAPE_UTILS = [IconShapeUtil];
const SIZES = [16, 24, 32, 48, 96, 192, 384];

declare global {
  interface Window {
    __editor?: Editor;
    runFidelitySweep: typeof runFidelitySweep;
    runHitTestSweep: (opts?: {
      sample?: number;
      size?: number;
      zoom?: number;
    }) => Promise<unknown>;
    setHitMode: typeof setHitMode;
    setStrokeMode: typeof setStrokeMode;
    runGeometrySweep: typeof runGeometrySweep;
    buildGallery: (opts: {
      names?: string[];
      sizes?: number[];
      dash?: string;
      stroke?: StrokeMode;
    }) => void;
  }
}

function useHashTab() {
  const [tab, setTab] = useState(
    () => location.hash.replace("#", "") || "canvas",
  );
  useEffect(() => {
    const onHash = () => setTab(location.hash.replace("#", "") || "canvas");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return [tab, (t: string) => (location.hash = t)] as const;
}

function Canvas() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<StrokeMode>("proportional");
  const [dash, setDash] = useState("solid");
  const [hit, setHit] = useState<HitMode>("stroke");
  const [size, setSize] = useState(96);

  const matches = useMemo(
    () =>
      ICON_NAMES.filter((n) => n.includes(query.toLowerCase())).slice(0, 400),
    [query],
  );

  const insert = (name: string) => {
    if (!editor) return;
    const c = editor.getViewportPageBounds().center;
    const id = createShapeId();
    editor.createShape({
      id,
      type: "lucide-icon",
      x: c.x - size / 2,
      y: c.y - size / 2,
      props: { name, w: size, h: size, dash },
    });
    editor.select(id);
  };

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ width: 260, overflow: "auto", padding: 8, fontSize: 12 }}>
        <input
          placeholder="search icons"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <label>
          stroke:{" "}
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as StrokeMode;
              setMode(m);
              setStrokeMode(m);
              editor?.updateShapes(
                editor
                  .getCurrentPageShapes()
                  .map((s) => ({ id: s.id, type: s.type, props: {} })),
              );
              location.reload();
            }}
          >
            <option value="proportional">proportional (2 x size/24)</option>
            <option value="tldraw">tldraw DefaultSizeStyle</option>
          </select>
        </label>
        <br />
        <label>
          hit:{" "}
          <select
            value={hit}
            onChange={(e) => {
              const m = e.target.value as HitMode;
              setHit(m);
              setHitMode(m);
              editor?.getCurrentPageShapes().forEach((sh) => {
                editor.updateShape({ id: sh.id, type: sh.type, props: {} });
              });
            }}
          >
            <option value="stroke">stroke only (glyph geometry)</option>
            <option value="filled-box">filled bounding box</option>
          </select>
        </label>
        <br />
        <label>
          dash:{" "}
          <select value={dash} onChange={(e) => setDash(e.target.value)}>
            {["solid", "draw", "dashed", "dotted"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <br />
        <label>
          insert size:{" "}
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 4,
            marginTop: 8,
          }}
        >
          {matches.map((n) => (
            <button
              key={n}
              title={n}
              onClick={() => insert(n)}
              style={{ padding: 4, cursor: "pointer" }}
              dangerouslySetInnerHTML={{ __html: sourceSvgMarkup(n, 20) }}
            />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <Tldraw
          shapeUtils={SHAPE_UTILS}
          onMount={(ed) => {
            setEditor(ed);
            window.__editor = ed;
            window.runHitTestSweep = (opts) => runHitTestSweep(ed, opts);
            // Lays out a comparison grid: one row per icon, one column per size.
            window.buildGallery = ({
              names = ["house", "smile", "loader-circle", "at-sign", "database", "settings", "git-branch", "party-popper"],
              sizes = [24, 48, 96, 200, 400],
              dash = "solid",
              stroke = "proportional",
            }) => {
              setStrokeMode(stroke);
              ed.selectAll().deleteShapes(ed.getSelectedShapeIds());
              let y = 0;
              for (const name of names) {
                let x = 0;
                for (const size of sizes) {
                  ed.createShape({
                    type: "lucide-icon",
                    x,
                    y: y + (400 - size) / 2,
                    props: { name, w: size, h: size, dash },
                  });
                  x += 440;
                }
                y += 440;
              }
              ed.selectNone();
              ed.zoomToFit();
            };
          }}
        />
      </div>
    </div>
  );
}

function Compare() {
  const [name, setName] = useState("smile");
  const known = ICON_NAMES.includes(name);
  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <input
        list="icon-names"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <datalist id="icon-names">
        {ICON_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {!known ? (
        <p>unknown icon</p>
      ) : (
        <>
          {[
            ["source", sourceSvgMarkup],
            ["transpiled", transpiledSvgMarkup],
          ].map(([label, fn]) => (
            <div key={label as string}>
              <h3>{label}</h3>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
                {SIZES.map((s) => (
                  <span
                    key={s}
                    dangerouslySetInnerHTML={{
                      __html: (fn as typeof sourceSvgMarkup)(name, s),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <h3>overlay (source black, transpiled magenta at 50%)</h3>
          <div style={{ position: "relative", width: 384, height: 384 }}>
            <span
              style={{ position: "absolute", inset: 0 }}
              dangerouslySetInnerHTML={{ __html: sourceSvgMarkup(name, 384) }}
            />
            <span
              style={{ position: "absolute", inset: 0, opacity: 0.5 }}
              dangerouslySetInnerHTML={{
                __html: transpiledSvgMarkup(name, 384).replace(
                  /#000/g,
                  "magenta",
                ),
              }}
            />
          </div>
          <h3>emitted d</h3>
          <textarea
            readOnly
            style={{ width: "100%", height: 120 }}
            value={
              transpiledSvgMarkup(name, 24).match(/<path d="([^"]*)"/)?.[1] ?? ""
            }
          />
        </>
      )}
    </div>
  );
}

function Sweep() {
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState<{
    total: number;
    perfect: number;
    errors: IconFidelity[];
    results: IconFidelity[];
  } | null>(null);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", fontSize: 13 }}>
      <button
        onClick={async () => {
          setStatus("running…");
          const r = await runFidelitySweep({
            onProgress: (d, t) => setStatus(`${d}/${t}`),
          });
          setSummary(r);
          setStatus("done");
        }}
      >
        run fidelity sweep (all 1,611 icons)
      </button>{" "}
      <span>{status}</span>
      {summary && (
        <>
          <p>
            <strong>{summary.perfect}</strong> of {summary.total} icons are
            pixel-identical at 96px. {summary.errors.length} threw.
          </p>
          <table cellPadding={4}>
            <thead>
              <tr>
                <th>icon</th>
                <th>diff px</th>
                <th>source px</th>
                <th>ratio</th>
                <th>max Δα</th>
                <th>error</th>
              </tr>
            </thead>
            <tbody>
              {summary.results.slice(0, 40).map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.diffPixels}</td>
                  <td>{r.sourcePixels}</td>
                  <td>{(r.ratio * 100).toFixed(2)}%</td>
                  <td>{r.maxDelta}</td>
                  <td style={{ color: "crimson" }}>{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function App() {
  const [tab, setTab] = useHashTab();
  return (
    <div
      style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}
    >
      <div style={{ padding: 6, borderBottom: "1px solid #ddd", fontSize: 13 }}>
        {["canvas", "compare", "sweep"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ fontWeight: tab === t ? 700 : 400, marginRight: 8 }}
          >
            {t}
          </button>
        ))}
        <span style={{ color: "#888" }}>
          PROTOTYPE — lucide → PathBuilder fidelity spike (#206)
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "canvas" && <Canvas />}
        {tab === "compare" && <Compare />}
        {tab === "sweep" && <Sweep />}
      </div>
    </div>
  );
}

window.runFidelitySweep = runFidelitySweep;
window.setHitMode = setHitMode;
window.setStrokeMode = setStrokeMode;
window.runGeometrySweep = runGeometrySweep;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
