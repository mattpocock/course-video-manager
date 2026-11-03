import zlib from "node:zlib";

/**
 * How many of a PNG's pixels are vividly coloured: opaque, and far from
 * grey. The Chat Highlight card is greys on a dark panel plus its amber bar,
 * so colour emoji are what adds to the count. Reads only what Chromium's
 * screenshots are: 8-bit RGBA, not interlaced.
 */
export const colouredPixels = (png: Buffer): number => {
  const rgba = decodeRgba(png);
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!];
    if (a > 200 && Math.max(r, g, b) - Math.min(r, g, b) > 80) count++;
  }
  return count;
};

const decodeRgba = (png: Buffer): Buffer => {
  const { width, height, data } = chunksOf(png);
  const raw = zlib.inflateSync(data);
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      out[y * stride + x] =
        (raw[y * (stride + 1) + 1 + x]! + unfilter(filter, a, b, c)) & 0xff;
    }
  }
  return out;
};

const chunksOf = (png: Buffer) => {
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error("Not an 8-bit RGBA, non-interlaced PNG.");
    } else if (type === "IDAT") idat.push(body);
    at += 12 + length;
  }
  return { width, height, data: Buffer.concat(idat) };
};

/** What a scanline's filter added to a byte: left `a`, up `b`, up-left `c`. */
const unfilter = (filter: number, a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  const add = [0, a, b, (a + b) >> 1, paeth][filter];
  if (add === undefined) throw new Error(`Unknown PNG filter ${filter}.`);
  return add;
};
