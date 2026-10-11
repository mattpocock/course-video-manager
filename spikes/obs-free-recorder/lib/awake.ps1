# Keeps Windows awake and unlocked for an unattended run, then puts every
# setting back.
#
#   -Hold -State <file> -StopFile <file> [-MaxMinutes 240]
#       Saves the current settings to <State> (only if it doesn't exist yet, so
#       a resumed run keeps the ORIGINAL values), turns off the screensaver,
#       Dynamic Lock and the AC sleep/hibernate/display-off timeouts, then holds
#       a display+system power request and nudges the idle timer every 30 s
#       (a zero-distance mouse move: an inactivity lock never fires) until
#       <StopFile> appears or MaxMinutes pass. Restores on the way out.
#   -Restore -State <file>
#       Puts back what <State> saved and deletes it. Idempotent.
#   -Show
#       Prints the current values (nothing is changed).
param([switch]$Hold, [switch]$Restore, [switch]$Show, [string]$State, [string]$StopFile, [int]$MaxMinutes = 240)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RigAwake {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint param, ref int value, uint ini);
  [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, IntPtr value, uint ini);
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static int GetScreenSaveActive() { int v = 0; SystemParametersInfo(0x10, 0, ref v, 0); return v; }
  // SPI_SETSCREENSAVEACTIVE, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
  public static void SetScreenSaveActive(int on) { SystemParametersInfo(0x11, (uint)on, IntPtr.Zero, 3); }
  public static void Nudge() {
    var i = new INPUT[1]; i[0].type = 0; i[0].mi.flags = 1; // MOUSEEVENTF_MOVE, 0,0
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

$winlogon = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
$power = @(
  @{ key = 'standby'; sub = 'SUB_SLEEP'; setting = 'STANDBYIDLE' },
  @{ key = 'hibernate'; sub = 'SUB_SLEEP'; setting = 'HIBERNATEIDLE' },
  @{ key = 'monitor'; sub = 'SUB_VIDEO'; setting = 'VIDEOIDLE' }
)
function Get-AcSeconds($p) {
  $out = powercfg /q SCHEME_CURRENT $p.sub $p.setting | Out-String
  if ($out -match 'Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)') { return [Convert]::ToInt32($Matches[1], 16) }
  return $null
}
function Set-AcSeconds($p, $sec) { powercfg /setacvalueindex SCHEME_CURRENT $p.sub $p.setting $sec | Out-Null }
function Current() {
  $v = [ordered]@{ screenSaveActive = [RigAwake]::GetScreenSaveActive() }
  $g = (Get-ItemProperty $winlogon -ErrorAction SilentlyContinue).EnableGoodbye
  $v.dynamicLock = if ($null -eq $g) { $null } else { [int]$g }
  foreach ($p in $power) { $v[$p.key] = Get-AcSeconds $p }
  return $v
}
function Do-Restore() {
  if (-not (Test-Path -LiteralPath $State)) { return }
  $s = Get-Content -LiteralPath $State -Raw | ConvertFrom-Json
  [RigAwake]::SetScreenSaveActive([int]$s.screenSaveActive)
  if ($null -ne $s.dynamicLock) { Set-ItemProperty $winlogon -Name EnableGoodbye -Value ([int]$s.dynamicLock) -Type DWord }
  foreach ($p in $power) { if ($null -ne $s.($p.key)) { Set-AcSeconds $p ([int]$s.($p.key)) } }
  powercfg /setactive SCHEME_CURRENT | Out-Null
  Remove-Item -LiteralPath $State -Force
  [Console]::Out.WriteLine("restored: " + ($s | ConvertTo-Json -Compress))
}

if ($Show) { [Console]::Out.WriteLine(((Current) | ConvertTo-Json -Compress)); exit 0 }
if ($Restore) { Do-Restore; exit 0 }
if (-not $Hold) { [Console]::Error.WriteLine("use -Hold, -Restore or -Show"); exit 1 }

if (-not (Test-Path -LiteralPath $State)) {
  (Current) | ConvertTo-Json -Compress | Set-Content -LiteralPath $State -Encoding UTF8
}
[RigAwake]::SetScreenSaveActive(0)
if ($null -ne (Get-ItemProperty $winlogon -ErrorAction SilentlyContinue).EnableGoodbye) { Set-ItemProperty $winlogon -Name EnableGoodbye -Value 0 -Type DWord }
foreach ($p in $power) { Set-AcSeconds $p 0 }
powercfg /setactive SCHEME_CURRENT | Out-Null
[Console]::Out.WriteLine("holding: " + ((Current) | ConvertTo-Json -Compress))

$until = (Get-Date).AddMinutes($MaxMinutes)
try {
  while ((Get-Date) -lt $until -and -not (Test-Path -LiteralPath $StopFile)) {
    # ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    [void][RigAwake]::SetThreadExecutionState([uint32]'0x80000003')
    [RigAwake]::Nudge()
    for ($i = 0; $i -lt 30 -and -not (Test-Path -LiteralPath $StopFile); $i++) { Start-Sleep -Seconds 1 }
  }
} finally {
  [void][RigAwake]::SetThreadExecutionState([uint32]'0x80000000')
  Do-Restore
}
