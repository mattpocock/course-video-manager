export const getScriptSection = (script: string): string => {
  if (!script.trim()) return "";

  return `\n\n## Script\n\nHere is the script for the video:

<script>
${script}
</script>

The script is the base the presenter improvised from, not a record of what was said. Treat it as authoritative for spelling and naming only — technical terms, identifiers, file paths, commands, product names — because the transcript is a machine transcription and will garble them. Where the video states a definition loosely, the script's phrasing is a reference for tightening it. Anything present in the script but absent from the transcript was cut while filming: drop it.

`;
};
