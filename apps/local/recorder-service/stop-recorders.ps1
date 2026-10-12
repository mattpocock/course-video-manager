# Stops any ffmpeg.exe still recording for a Recording Session the recorder
# service lost (it died while recording), so crash recovery can repair the
# files those processes held open. Found by the Recording Session's tag in
# the command line (recording-session.ts recorderTag), so an ffmpeg.exe
# started by anything else is never touched. Prints how many it stopped.
param([string]$Tags)
$ErrorActionPreference = "Stop"
$wanted = $Tags -split "," | Where-Object { $_ }
$stopped = 0
Get-CimInstance Win32_Process -Filter "Name = 'ffmpeg.exe'" | ForEach-Object {
  $line = $_.CommandLine
  foreach ($tag in $wanted) {
    if ($line -and $line.Contains($tag)) {
      Stop-Process -Id $_.ProcessId -Force
      $stopped += 1
      break
    }
  }
}
Write-Output $stopped
