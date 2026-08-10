// Internal. Reach it through `../tldraw`.
//
// SVG path `d` parser. Produces a flat list of ABSOLUTE segments in the
// vocabulary tldraw's PathBuilder actually speaks: M / L / C / A / Z.
//
// Everything else in the SVG path grammar is folded in on the way through:
//   relative commands   -> absolutised
//   H / V               -> L
//   S (smooth cubic)    -> C (reflect the previous control point)
//   Q (quadratic)       -> C (exact degree elevation, not an approximation)
//   T (smooth quadratic)-> C (reflect, then elevate)
//
// Q/S/T are real in this data: 53 icons, 80 occurrences, and `t` appears in
// 1.27.0 though not in 0.525.0.
//
// Arc flags are read as single characters, so SVGO-style "glued" flags
// (`a5 5 0 015 5`) parse correctly even though lucide does not currently emit
// them.

export type Seg =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | {
      c: "C";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | {
      c: "A";
      rx: number;
      ry: number;
      rot: number;
      laf: boolean;
      sf: boolean;
      x: number;
      y: number;
    }
  | { c: "Z" };

const NUMBER = /^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/;

class Scanner {
  i = 0;
  constructor(readonly s: string) {}
  private skipSep() {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i]!)) this.i++;
  }
  atEnd() {
    this.skipSep();
    return this.i >= this.s.length;
  }
  peekCommand(): string | null {
    this.skipSep();
    const ch = this.s[this.i];
    return ch && /[A-Za-z]/.test(ch) ? ch : null;
  }
  takeCommand(): string {
    const c = this.peekCommand();
    if (!c) throw new Error(`expected command at ${this.i} of "${this.s}"`);
    this.i++;
    return c;
  }
  num(): number {
    this.skipSep();
    const m = NUMBER.exec(this.s.slice(this.i));
    if (!m) throw new Error(`expected number at ${this.i} of "${this.s}"`);
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
  /** Arc flags are single characters — never part of the number that follows. */
  flag(): boolean {
    this.skipSep();
    const ch = this.s[this.i];
    if (ch !== "0" && ch !== "1")
      throw new Error(`expected arc flag at ${this.i} of "${this.s}"`);
    this.i++;
    return ch === "1";
  }
}

/**
 * Quadratic (P0, Q, P2) -> cubic. EXACT: degree elevation, not an
 * approximation. C1 = P0 + ⅔(Q − P0), C2 = P2 + ⅔(Q − P2).
 */
function quadToCubic(
  x0: number,
  y0: number,
  qx: number,
  qy: number,
  x: number,
  y: number
): Extract<Seg, { c: "C" }> {
  return {
    c: "C",
    x1: x0 + (2 / 3) * (qx - x0),
    y1: y0 + (2 / 3) * (qy - y0),
    x2: x + (2 / 3) * (qx - x),
    y2: y + (2 / 3) * (qy - y),
    x,
    y,
  };
}

export function parsePathD(d: string): Seg[] {
  const sc = new Scanner(d);
  const out: Seg[] = [];

  let x = 0;
  let y = 0;
  // start of the current subpath, for Z
  let sx = 0;
  let sy = 0;
  // last cubic control point (for S) and last quadratic control point (for T)
  let lastCubicCp: { x: number; y: number } | null = null;
  let lastQuadCp: { x: number; y: number } | null = null;
  let cmd = "";

  while (!sc.atEnd()) {
    if (sc.peekCommand()) {
      cmd = sc.takeCommand();
    } else if (!cmd) {
      throw new Error(`path does not start with a command: "${d}"`);
    } else if (cmd === "M") {
      cmd = "L"; // implicit repeats of M are L, per spec
    } else if (cmd === "m") {
      cmd = "l";
    }

    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;

    switch (cmd.toUpperCase()) {
      case "M": {
        x = sc.num() + ox;
        y = sc.num() + oy;
        sx = x;
        sy = y;
        out.push({ c: "M", x, y });
        lastCubicCp = lastQuadCp = null;
        break;
      }
      case "L": {
        x = sc.num() + ox;
        y = sc.num() + oy;
        out.push({ c: "L", x, y });
        lastCubicCp = lastQuadCp = null;
        break;
      }
      case "H": {
        x = sc.num() + ox;
        out.push({ c: "L", x, y });
        lastCubicCp = lastQuadCp = null;
        break;
      }
      case "V": {
        y = sc.num() + oy;
        out.push({ c: "L", x, y });
        lastCubicCp = lastQuadCp = null;
        break;
      }
      case "C": {
        const x1 = sc.num() + ox;
        const y1 = sc.num() + oy;
        const x2 = sc.num() + ox;
        const y2 = sc.num() + oy;
        x = sc.num() + ox;
        y = sc.num() + oy;
        out.push({ c: "C", x1, y1, x2, y2, x, y });
        lastCubicCp = { x: x2, y: y2 };
        lastQuadCp = null;
        break;
      }
      case "S": {
        // The first control point is the reflection of the previous cubic's
        // second control point about the current point — or the current point
        // itself when there is no previous cubic.
        const x1 = lastCubicCp ? 2 * x - lastCubicCp.x : x;
        const y1 = lastCubicCp ? 2 * y - lastCubicCp.y : y;
        const x2 = sc.num() + ox;
        const y2 = sc.num() + oy;
        x = sc.num() + ox;
        y = sc.num() + oy;
        out.push({ c: "C", x1, y1, x2, y2, x, y });
        lastCubicCp = { x: x2, y: y2 };
        lastQuadCp = null;
        break;
      }
      case "Q": {
        const qx = sc.num() + ox;
        const qy = sc.num() + oy;
        const nx = sc.num() + ox;
        const ny = sc.num() + oy;
        out.push(quadToCubic(x, y, qx, qy, nx, ny));
        x = nx;
        y = ny;
        lastQuadCp = { x: qx, y: qy };
        lastCubicCp = null;
        break;
      }
      case "T": {
        const qx: number = lastQuadCp ? 2 * x - lastQuadCp.x : x;
        const qy: number = lastQuadCp ? 2 * y - lastQuadCp.y : y;
        const nx = sc.num() + ox;
        const ny = sc.num() + oy;
        out.push(quadToCubic(x, y, qx, qy, nx, ny));
        x = nx;
        y = ny;
        lastQuadCp = { x: qx, y: qy };
        lastCubicCp = null;
        break;
      }
      case "A": {
        const rx = sc.num();
        const ry = sc.num();
        const rot = sc.num();
        const laf = sc.flag();
        const sf = sc.flag();
        x = sc.num() + ox;
        y = sc.num() + oy;
        out.push({ c: "A", rx, ry, rot, laf, sf, x, y });
        lastCubicCp = lastQuadCp = null;
        break;
      }
      case "Z": {
        out.push({ c: "Z" });
        x = sx;
        y = sy;
        lastCubicCp = lastQuadCp = null;
        break;
      }
      default:
        throw new Error(`unknown path command "${cmd}" in "${d}"`);
    }
  }

  return out;
}
