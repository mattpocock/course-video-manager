import zlib from "node:zlib";

/**
 * A PNG's pixels as straight RGBA, 8 bits a channel: what the card server's
 * `renderStill` writes (Chromium's screenshot: truecolour with alpha, 8-bit,
 * not interlaced). Anything else is refused rather than drawn wrong.
 */
export const decodePngRgba = (
  png: Buffer
): { width: number; height: number; rgba: Buffer } => {
  const { width, height, data } = chunksOf(png);
  const raw = zlib.inflateSync(data);
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? -1;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[out + x - 4]! : 0;
      const b = y > 0 ? rgba[out - stride + x]! : 0;
      const c = x >= 4 && y > 0 ? rgba[out - stride + x - 4]! : 0;
      rgba[out + x] = (row[x]! + unfilter(filter, a, b, c)) & 0xff;
    }
  }
  return { width, height, rgba };
};

/** Its size (checked 8-bit RGBA, not interlaced) and its compressed pixels. */
const chunksOf = (png: Buffer) => {
  if (png.readUInt32BE(0) !== 0x89504e47)
    throw new Error("The card still is not a PNG.");
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || colour !== 6 || interlace !== 0)
        throw new Error(
          `The card still is not 8-bit RGBA (depth ${depth}, colour type ${colour}, interlace ${interlace}).`
        );
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  return { width, height, data: Buffer.concat(data) };
};

/** What a scanline's filter added to each byte: left `a`, up `b`, up-left `c`. */
const unfilter = (filter: number, a: number, b: number, c: number) => {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4: {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    default:
      throw new Error(`The card still has an unknown PNG filter ${filter}.`);
  }
};
