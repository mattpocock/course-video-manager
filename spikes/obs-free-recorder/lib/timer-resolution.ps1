# Raises the Windows timer resolution to 1 ms inside a running ffmpeg.exe.
#
# Why: ddagrab paces itself with Sleep() and waits for each desktop frame with
# AcquireNextFrame(timeout 8 ms). ffmpeg never calls timeBeginPeriod, and since
# Windows 10 2004 the timer resolution is per process, so both waits round up
# to the default 15.6 ms tick. A sleep can then wake 15.6 ms late and a timeout
# take 15.6 ms instead of 8; together that passes ddagrab's "more than one frame
# late" rule (lateness > 2 x 16.7 ms after the previous slot) and it skips the
# slot for good. Measured on the DELL at 60 Hz with NVENC: 14 frames short in
# 3 min at the default tick, 0 short at 1 ms. OBS gets 1 ms for free:
# libobs.dll calls timeBeginPeriod(1) in its DllMain.
#
# Measured the same way, two more things matter: Windows 11 power throttling
# (EcoQoS) silently ignores the request for a window-less background process,
# so the script opts ffmpeg.exe out of it first; and with the screen preview's
# second Desktop Duplication session running, the capture thread still missed
# ~5 slots a minute at Normal priority, 0 at High.
#
# How: a remote thread loads winmm.dll in the target, then a second remote
# thread runs timeBeginPeriod(Ms) there (it takes one argument, so it can be a
# thread start routine). Its exit code is the MMRESULT: 0 means it took.
#
# The target is the ffmpeg.exe whose command line contains -Tag and -Match.
# It is looked up for up to 10 s, since ffmpeg.exe was only just spawned.
param([string]$Tag, [string]$Match, [int]$Ms = 1, [string]$Priority = "High")
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class TimerRes {
  [DllImport("kernel32", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32", SetLastError=true)] static extern IntPtr CreateRemoteThread(IntPtr h, IntPtr attr, UIntPtr stack, IntPtr start, IntPtr param, uint flags, IntPtr tid);
  [DllImport("kernel32", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32", SetLastError=true)] static extern bool GetExitCodeThread(IntPtr h, out uint code);
  [DllImport("kernel32", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32", SetLastError=true)] static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr addr, UIntPtr size, uint type, uint protect);
  [DllImport("kernel32", SetLastError=true)] static extern bool VirtualFreeEx(IntPtr h, IntPtr addr, UIntPtr size, uint type);
  [DllImport("kernel32", SetLastError=true)] static extern bool WriteProcessMemory(IntPtr h, IntPtr addr, byte[] buf, UIntPtr size, out UIntPtr written);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryW(string name);
  [DllImport("kernel32", CharSet=CharSet.Ansi, SetLastError=true)] static extern IntPtr GetProcAddress(IntPtr mod, string name);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr GetModuleHandleW(string name);

  [DllImport("kernel32", SetLastError=true)] static extern bool SetProcessInformation(IntPtr h, int cls, uint[] info, uint size);

  // Opts the process out of power throttling (EcoQoS). Without this, Windows 11
  // may decide the window-less ffmpeg.exe is a background process and ignore
  // its timer resolution request (the 15.6 ms pattern came back mid-session).
  public static void NoThrottle(int pid) {
    IntPtr h = OpenProcess(0x0200, false, pid); // PROCESS_SET_INFORMATION
    if (h == IntPtr.Zero) throw new Exception("OpenProcess(set info) failed: " + Marshal.GetLastWin32Error());
    try {
      // ProcessPowerThrottling (4): Version 1, ControlMask EXECUTION_SPEED | IGNORE_TIMER_RESOLUTION, StateMask 0 (= off)
      if (!SetProcessInformation(h, 4, new uint[] { 1, 0x1 | 0x4, 0 }, 12))
        throw new Exception("SetProcessInformation failed: " + Marshal.GetLastWin32Error());
    } finally { CloseHandle(h); }
  }

  static uint Run(IntPtr h, IntPtr fn, IntPtr arg) {
    IntPtr t = CreateRemoteThread(h, IntPtr.Zero, UIntPtr.Zero, fn, arg, 0, IntPtr.Zero);
    if (t == IntPtr.Zero) throw new Exception("CreateRemoteThread failed: " + Marshal.GetLastWin32Error());
    WaitForSingleObject(t, 5000);
    uint code; GetExitCodeThread(t, out code); CloseHandle(t);
    return code;
  }

  // Calls timeBeginPeriod(ms) inside process pid. Since Windows 10 2004 the
  // timer resolution is per process, so it has to be requested from inside.
  public static uint Raise(int pid, uint ms) {
    // PROCESS_CREATE_THREAD | QUERY_INFORMATION | VM_OPERATION | VM_WRITE | VM_READ
    IntPtr h = OpenProcess(0x0002 | 0x0400 | 0x0008 | 0x0020 | 0x0010, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());
    try {
      // Load winmm.dll in the target (LoadLibraryW lives in kernel32, mapped at the same address in every process).
      byte[] name = Encoding.Unicode.GetBytes("winmm.dll\0");
      IntPtr mem = VirtualAllocEx(h, IntPtr.Zero, (UIntPtr)name.Length, 0x3000, 0x04);
      UIntPtr w; WriteProcessMemory(h, mem, name, (UIntPtr)name.Length, out w);
      Run(h, GetProcAddress(GetModuleHandleW("kernel32.dll"), "LoadLibraryW"), mem);
      VirtualFreeEx(h, mem, UIntPtr.Zero, 0x8000);
      // timeBeginPeriod's offset in winmm.dll, rebased onto the target's copy.
      IntPtr local = LoadLibraryW("winmm.dll");
      long offset = GetProcAddress(local, "timeBeginPeriod").ToInt64() - local.ToInt64();
      IntPtr remote = IntPtr.Zero;
      foreach (ProcessModule m in Process.GetProcessById(pid).Modules)
        if (String.Equals(m.ModuleName, "winmm.dll", StringComparison.OrdinalIgnoreCase)) remote = m.BaseAddress;
      if (remote == IntPtr.Zero) throw new Exception("winmm.dll did not load in the target");
      return Run(h, new IntPtr(remote.ToInt64() + offset), new IntPtr(ms));
    } finally { CloseHandle(h); }
  }
}
"@
$deadline = (Get-Date).AddSeconds(10)
do {
  $p = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" |
    Where-Object { $_.CommandLine -like "*$Tag*" -and $_.CommandLine -like "*$Match*" })
  if ($p.Count) { break }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
if ($p.Count -ne 1) { throw "expected one ffmpeg.exe matching $Tag / $Match, found $($p.Count)" }
[TimerRes]::NoThrottle([int]$p[0].ProcessId)
$code = [TimerRes]::Raise([int]$p[0].ProcessId, [uint32]$Ms)
if ($code -ne 0) { throw "timeBeginPeriod($Ms) in ffmpeg.exe $($p[0].ProcessId) returned $code" }
if ($Priority) { (Get-Process -Id $p[0].ProcessId).PriorityClass = $Priority }
"timeBeginPeriod($Ms) in ffmpeg.exe $($p[0].ProcessId)$(if ($Priority) { ", priority $Priority" })"
