/**
 * The recorder's colour, as OBS's "Landscape Recording" profile writes it:
 * NV12, BT.709, limited ("Partial") range. Footage from either recorder
 * sits side by side in one Video, so the same pixel must hold the same
 * value in both.
 */

export const BT709 =
  "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709";

/**
 * ddagrab's D3D11 BGRA frame to NV12 as OBS writes it (ColorFormat NV12,
 * ColorSpace 709, ColorRange Partial): BT.709, LIMITED range, so VS Code's
 * #1e1e1e is Y=42 in both. All on the GPU: the D3D11 video processor does
 * the matrix and the range in one pass and the frame goes straight to NVENC,
 * with no read-back and no CPU pass per frame.
 *
 * Stock ffmpeg 8.0.1's scale_d3d11 never sets the video processor's colour
 * spaces, and the GPU wrote FULL range (#1e1e1e came out Y=30). The
 * `out_range` and `out_color_matrix` options are CVM's own patch
 * (apps/local/ffmpeg/patches), so this needs CVM's ffmpeg.exe, which the
 * service checks for at start-up. Tagged BT.709 limited after, as the
 * samples are.
 */
export const SCREEN_TO_NV12 = [
  "scale_d3d11=format=nv12:out_range=tv:out_color_matrix=bt709",
  BT709,
].join(",");
