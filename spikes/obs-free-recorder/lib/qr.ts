// A minimal QR code encoder for the wizard's start screen (the phone video's
// LAN URL): byte mode, error correction L, versions 1-5 (up to 106 bytes,
// one Reed-Solomon block each). No dependency; ./rig qr <text> prints one.

const EC_L: Record<number, { total: number; ec: number; align: number[] }> = {
  1: { total: 26, ec: 7, align: [] },
  2: { total: 44, ec: 10, align: [6, 18] },
  3: { total: 70, ec: 15, align: [6, 22] },
  4: { total: 100, ec: 20, align: [6, 26] },
  5: { total: 134, ec: 26, align: [6, 30] },
};

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j]!, root);
      if (j + 1 < r.length) r[j] = r[j]! ^ r[j + 1]!;
    }
    root = mul(root, 0x02);
  }
  return r;
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((c, i) => (r[i] = r[i]! ^ mul(c, f)));
  }
  return r;
}
function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The module matrix (true = dark), `mask` 0-7 or the lowest-penalty one. */
export function qrMatrix(text: string, mask?: number): boolean[][] {
  const bytes = [...Buffer.from(text, "utf8")];
  const version = [1, 2, 3, 4, 5].find(
    (v) => (EC_L[v]!.total - EC_L[v]!.ec) * 8 >= 4 + 8 + bytes.length * 8
  );
  if (!version) throw new Error(`QR: "${text}" is too long (max 106 bytes)`);
  const { total, ec, align } = EC_L[version]!;
  const dataLen = total - ec;
  // Bit stream: mode 0100, 8-bit count, bytes, terminator, pad.
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataLen * 8; pad ^= 0xec ^ 0x11)
    put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const codewords = [...data, ...rsRemainder(data, rsDivisor(ec))];

  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );
  const fn = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );
  const set = (x: number, y: number, dark: boolean) => {
    m[y]![x] = dark;
    fn[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size)
          set(x, y, d !== 2 && d !== 4);
      }
  if (align.length) {
    const c = align[1]!;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mk: number) => {
    const d = (1 << 3) | mk; // EC level L = 01
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserve the format area before placing data
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y]![x] && i < codewords.length * 8) {
          m[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }
  const MASKS = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const masked = (mk: number) => {
    const out = m.map((row, y) =>
      row.map((v, x) => (fn[y]![x] ? v : v !== MASKS[mk]!(x, y)))
    );
    const save = m.map((r) => [...r]);
    for (let y = 0; y < size; y++) m[y] = out[y]!;
    drawFormat(mk);
    const res = m.map((r) => [...r]);
    for (let y = 0; y < size; y++) m[y] = save[y]!;
    return res;
  };
  if (mask !== undefined) return masked(mask);
  let best: boolean[][] = [];
  let bestScore = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const c = masked(mk);
    const s = penalty(c);
    if (s < bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

/** QR penalty rules 1, 2 and 4 (runs, 2x2 blocks, dark balance): enough to avoid a bad mask. */
function penalty(m: boolean[][]): number {
  const n = m.length;
  let s = 0;
  for (let a = 0; a < n; a++)
    for (const line of [m[a]!, m.map((r) => r[a]!)]) {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) s += run - 2;
          run = 1;
        }
      }
    }
  let dark = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (m[y]![x]) dark++;
      if (x < n - 1 && y < n - 1) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1])
          s += 3;
      }
    }
  s += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return s;
}

/** The code for a terminal: half-block characters, black on white, with a 4-module quiet zone. */
export function qrTerminal(text: string, indent = "  "): string {
  const q = qrMatrix(text);
  const n = q.length + 8;
  const at = (x: number, y: number) =>
    x >= 4 && y >= 4 && x < n - 4 && y < n - 4 ? q[y - 4]![x - 4]! : false;
  const lines: string[] = [];
  for (let y = 0; y < n; y += 2) {
    let l = "";
    for (let x = 0; x < n; x++) {
      const top = at(x, y);
      const bottom = y + 1 < n && at(x, y + 1);
      l += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(`${indent}\x1b[30;47m${l}\x1b[0m`);
  }
  return lines.join("\n");
}
