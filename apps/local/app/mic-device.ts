/**
 * The mic the CVM recorder captures: its dshow input is this Voicemeeter
 * output, and the AV Calibration page's browser detector opens it too, so
 * both hear the same audio.
 */
export const MIC_NAME = "Voicemeeter Out B1";

/** Whether a device's name or label is the mic, matched as the recorder service matches it (`findByName`). */
export const isMicDevice = (label: string): boolean =>
  label.toLowerCase().includes(MIC_NAME.toLowerCase());
