# Samples the PC's load once a second for as long as the camera capture runs,
# so the next capture stall can be explained (camera.ts, load-sampler.ts). One
# tab-separated line a second:
#
#   machine CPU %  capture CPU % of the machine  capture CPU in cores  GPU %  encoder %  decoder %
#
# The GPU columns come from one nvidia-smi.exe that samples itself every
# second (-lms), started once: no process is started per sample. They are
# empty without nvidia-smi. The script ends when the capture does.
#
# Cheap by design: a performance counter read and a process refresh a second,
# below the capture (BelowNormal; nvidia-smi.exe inherits it). The capture is
# found as timer-resolution.ps1 finds it, for up to 10 s.
param([string]$Tag)
$ErrorActionPreference = "Stop"
(Get-Process -Id $PID).PriorityClass = "BelowNormal"
$deadline = (Get-Date).AddSeconds(10)
do {
  $p = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" |
    Where-Object { $_.CommandLine -like "*$Tag*" })
  if ($p.Count) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if ($p.Count -ne 1) { throw "expected one ffmpeg.exe matching $Tag, found $($p.Count)" }
$capture = Get-Process -Id $p[0].ProcessId
$cores = [Environment]::ProcessorCount
$cpu = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
[void]$cpu.NextValue()

$gpu = $null
$gpuLine = ""
$pending = $null
try {
  $si = New-Object System.Diagnostics.ProcessStartInfo
  $si.FileName = "$env:SystemRoot\System32\nvidia-smi.exe"
  $si.Arguments = "--query-gpu=utilization.gpu,utilization.encoder,utilization.decoder --format=csv,noheader,nounits -lms 1000"
  $si.UseShellExecute = $false
  $si.RedirectStandardOutput = $true
  $si.CreateNoWindow = $true
  $gpu = [System.Diagnostics.Process]::Start($si)
  $pending = $gpu.StandardOutput.ReadLineAsync()
} catch { $gpu = $null }

try {
  $wasCpu = $capture.TotalProcessorTime.TotalMilliseconds
  $wasAt = [Diagnostics.Stopwatch]::GetTimestamp()
  while ($true) {
    Start-Sleep -Milliseconds 1000
    $capture.Refresh()
    if ($capture.HasExited) { break }
    $nowCpu = $capture.TotalProcessorTime.TotalMilliseconds
    $nowAt = [Diagnostics.Stopwatch]::GetTimestamp()
    $wallMs = ($nowAt - $wasAt) * 1000.0 / [Diagnostics.Stopwatch]::Frequency
    $captureCores = ($nowCpu - $wasCpu) / [Math]::Max(1, $wallMs)
    $wasCpu = $nowCpu
    $wasAt = $nowAt
    while ($pending -and $pending.IsCompleted) {
      if ($pending.Result -eq $null) { $pending = $null; break }
      $gpuLine = $pending.Result
      $pending = $gpu.StandardOutput.ReadLineAsync()
    }
    $g = @(($gpuLine -split ",") | ForEach-Object { $_.Trim() })
    while ($g.Count -lt 3) { $g += "" }
    $line = [string]::Format([Globalization.CultureInfo]::InvariantCulture,
      "{0:F0}`t{1:F1}`t{2:F2}`t{3}`t{4}`t{5}",
      $cpu.NextValue(), ($captureCores * 100 / $cores), $captureCores, $g[0], $g[1], $g[2])
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
  }
} finally {
  if ($gpu -and -not $gpu.HasExited) { $gpu.Kill() }
}
