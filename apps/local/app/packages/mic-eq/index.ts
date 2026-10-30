// Entry point for the mic-eq package: the saved Mic EQ as ffmpeg filters, one
// definition for every ffmpeg command line that plays Matt's mic — the
// export's Clip segments today, the recorder service's Live Stream next.
//
// `micEqFilters` is OBS's 3-Band Equaliser sample for sample, at 48 kHz; a
// flat Mic EQ adds no filters. `micEqCoefficients` is its transfer function.
export { micEqCoefficients, micEqFilters } from "./lib/mic-eq-filter";
