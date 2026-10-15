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
 * #1e1e1e is Y=42 in both. scale_d3d11 (ffmpeg 8.0.1) never sets the video
 * processor's colour spaces, and the GPU makes it BT.709 but FULL range:
 * #1e1e1e came out Y=30 in a file tagged limited, and every player showed it
 * as RGB 16, a darker black than OBS's. So the GPU still does the BGRA ->
 * NV12 conversion (the heavy part), and the CPU squeezes its full range into
 * limited: an NV12 read-back (3 MB a frame at 1080p, not BGRA's 8 MB) and
 * a per-sample table. Tagged BT.709 limited after, not before: the tags
 * describe the samples the encoder gets.
 */
export const SCREEN_TO_NV12 = [
  "scale_d3d11=format=nv12",
  "hwdownload",
  "format=nv12",
  "scale=in_range=pc:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709",
  "format=nv12",
  BT709,
].join(",");
